"""パイプライン（抽出 → 検証 → 判定 → 最終評価 → 補正 → 引用の照合）を、偽のクライアントで通す。"""

import asyncio
from collections.abc import Sequence
from datetime import date

import pytest

from app.domain.errors import LlmUnavailableError, NoConditionsError
from app.domain.models import Condition
from app.ingest.resume import ResumeInput
from app.llm.fake_client import UNVERIFIABLE_QUOTE, FakeClient
from app.llm.requests import EvaluateRequest, ExtractRequest
from app.llm.schemas import ConditionExtraction, ExtractionResult, FinalEvaluation, Quote
from app.pipeline import ErrorEvent, PipelineEvent, ResultEvent, StageEvent, run

TODAY = date(2026, 10, 25)
TEXT = (
    "職務経歴書（架空のサンプル）\n1級建築施工管理技士（2018年取得）\n現場監督として 8 年勤務。\n"
)
TEXT_RESUME = ResumeInput(source_name="田中.docx", format="docx", text=TEXT)
PDF_RESUME = ResumeInput(source_name="田中.pdf", format="pdf", pdf=b"%PDF-1.7\n")


def condition(
    id: str, kind: str = "boolean", *, required: bool = False, min_value: float | None = None
) -> Condition:
    return Condition.model_validate(
        {
            "id": id,
            "label": f"条件 {id}",
            "kind": kind,
            "required": required,
            "min_value": min_value,
            "unit": None,
            "source": "custom",
            "category": None,
        }
    )


# FakeClient は、a 達成・b 未達・c 未達・d 達成 の順に返す
CONDITIONS = [
    condition("a", required=True),
    condition("b", "number", required=True, min_value=5),
    condition("c", required=True),
    condition("d", "number", min_value=2),
]


async def collect(
    client: object,
    *,
    resume: ResumeInput = TEXT_RESUME,
    conditions: Sequence[Condition] = CONDITIONS,
) -> list[PipelineEvent]:
    return [
        event
        async for event in run(
            resume=resume,
            conditions=conditions,
            client=client,  # pyright: ignore[reportArgumentType]
            today=TODAY,
        )
    ]


def result_of(events: list[PipelineEvent]) -> ResultEvent:
    assert isinstance(events[-1], ResultEvent), events
    return events[-1]


class ScriptedClient:
    """決まった抽出結果を順に返し、最終評価は FakeClient に任せるクライアント。"""

    def __init__(self, *extractions: ExtractionResult) -> None:
        self._extractions = list(extractions)
        self._fake = FakeClient()
        self.extract_calls = 0

    async def extract(self, request: ExtractRequest) -> ExtractionResult:
        self.extract_calls += 1
        return self._extractions.pop(0) if len(self._extractions) > 1 else self._extractions[0]

    async def evaluate(self, request: EvaluateRequest) -> FinalEvaluation:
        return await self._fake.evaluate(request)


def extraction(condition_id: str, **values: object) -> ConditionExtraction:
    fields: dict[str, object] = {"has_skill": None, "years": None, "reason": "r", "quotes": []}
    return ConditionExtraction.model_validate({"condition_id": condition_id} | fields | values)


GOOD = ExtractionResult(
    results=[
        extraction("a", has_skill=True),
        extraction("b", years=2.0),
        extraction("c", has_skill=False),
        extraction("d", years=3.0),
    ]
)


# --- 正常系 ---


async def test_events_are_two_stages_and_then_the_result() -> None:
    events = await collect(FakeClient())

    assert events[:2] == [StageEvent("extracting"), StageEvent("scoring")]
    assert isinstance(events[2], ResultEvent)
    assert len(events) == 3


async def test_result_has_the_judgements_and_the_match_rate_from_code() -> None:
    result = result_of(await collect(FakeClient())).result

    assert [(j.condition.id, j.status) for j in result.conditions] == [
        ("a", "achieved"),
        ("b", "unmet"),
        ("c", "unmet"),
        ("d", "achieved"),
    ]
    assert result.match_rate == 50


async def test_missing_required_conditions_are_listed_with_their_status() -> None:
    result = result_of(await collect(FakeClient())).result

    assert [(m.condition_id, m.status) for m in result.missing_required] == [
        ("b", "unmet"),
        ("c", "unmet"),
    ]


async def test_unknown_required_condition_is_listed_as_unknown() -> None:
    client = ScriptedClient(
        ExtractionResult(
            results=[
                extraction("a", has_skill=True),
                extraction("b", years=None),
                extraction("c", has_skill=True),
                extraction("d", years=3.0),
            ]
        )
    )

    result = result_of(await collect(client)).result

    assert [(m.condition_id, m.status) for m in result.missing_required] == [("b", "unknown")]


async def test_the_evaluation_request_carries_the_values_computed_by_code() -> None:
    client = FakeClient()

    await collect(client)

    [request] = client.evaluate_calls
    assert request.match_rate == 50
    assert [c.id for c in request.missing_required] == ["b", "c"]
    assert [j.status for j in request.judgements] == ["achieved", "unmet", "unmet", "achieved"]
    assert request.today == TODAY
    assert request.resume == TEXT_RESUME


async def test_score_within_the_range_is_kept() -> None:
    result = result_of(await collect(FakeClient(score=65))).result

    assert (result.score, result.original_score, result.clipped) == (65, 65, False)


@pytest.mark.parametrize(("llm_score", "expected"), [(100, 70), (0, 30)])
async def test_score_is_clipped_to_within_20_points_of_the_match_rate(
    llm_score: int, expected: int
) -> None:
    result = result_of(await collect(FakeClient(score=llm_score))).result

    assert (result.score, result.original_score, result.clipped) == (expected, llm_score, True)


async def test_extraction_values_and_reasons_are_carried_into_the_result() -> None:
    result = result_of(await collect(FakeClient())).result

    first = result.conditions[0]
    assert first.has_skill is True
    assert first.reason.startswith('"田中.docx"')
    assert result.conditions[1].years is not None


async def test_extraction_in_another_order_is_accepted_and_reordered() -> None:
    shuffled = ExtractionResult(results=list(reversed(GOOD.results)))
    client = ScriptedClient(shuffled)

    result = result_of(await collect(client)).result

    assert [j.condition.id for j in result.conditions] == ["a", "b", "c", "d"]
    assert client.extract_calls == 1


# --- 引用の照合 ---


async def test_quotes_of_a_text_resume_are_verified_against_the_text() -> None:
    result = result_of(await collect(FakeClient())).result

    extracted = [q for j in result.conditions for q in j.quotes]
    assert extracted
    assert {q.verified for q in extracted} == {"match"}
    evaluated = [
        q for p in [result.summary, *result.strengths, *result.weaknesses] for q in p.quotes
    ]
    assert {q.verified for q in evaluated} == {"match", "not_found"}
    assert any(q.text == UNVERIFIABLE_QUOTE and q.verified == "not_found" for q in evaluated)


async def test_quotes_of_a_pdf_are_not_verified() -> None:
    result = result_of(await collect(FakeClient(), resume=PDF_RESUME)).result

    quotes = [q for j in result.conditions for q in j.quotes]
    quotes += [q for p in [result.summary, *result.strengths, *result.weaknesses] for q in p.quotes]
    assert quotes
    assert {q.verified for q in quotes} == {"skipped"}


async def test_quote_source_name_is_replaced_with_the_given_name() -> None:
    wrong = Quote(source_name="別のファイル.pdf", location="1ページ", text="1級建築施工管理技士")
    result_with_wrong_name = ExtractionResult(
        results=[
            extraction("a", has_skill=True, quotes=[wrong]),
            *GOOD.results[1:],
        ]
    )

    result = result_of(await collect(ScriptedClient(result_with_wrong_name))).result

    [quote] = result.conditions[0].quotes
    assert quote.source_name == "田中.docx"
    assert quote.location == "1ページ"
    assert quote.verified == "match"


# --- 抽出結果の不整合（仕様 5.4 ステップ 1: 1 回だけ再実行する） ---

MISSING_ONE = ExtractionResult(results=GOOD.results[:3])
WRONG_FIELD = ExtractionResult(
    results=[extraction("a", has_skill=True, years=3.0), *GOOD.results[1:]]
)


@pytest.mark.parametrize("bad", [MISSING_ONE, WRONG_FIELD], ids=["missing", "wrong-field"])
async def test_inconsistent_extraction_is_retried_once_and_then_succeeds(
    bad: ExtractionResult,
) -> None:
    client = ScriptedClient(bad, GOOD)

    events = await collect(client)

    assert client.extract_calls == 2
    assert isinstance(events[-1], ResultEvent)
    # 画面の進捗は「抽出中」のまま。再実行で段階を増やさない
    assert events.count(StageEvent("extracting")) == 1


async def test_extraction_that_stays_inconsistent_ends_with_an_error() -> None:
    client = ScriptedClient(MISSING_ONE)

    events = await collect(client)

    assert client.extract_calls == 2
    assert events == [
        StageEvent("extracting"),
        ErrorEvent(
            code="extraction_inconsistent",
            message="AI の抽出結果に不整合がありました。もう一度実行してください。",
        ),
    ]


async def test_evaluation_is_not_called_after_an_inconsistent_extraction() -> None:
    client = ScriptedClient(MISSING_ONE)
    client._fake = FakeClient()  # pyright: ignore[reportPrivateUsage]

    await collect(client)

    assert client._fake.evaluate_calls == []  # pyright: ignore[reportPrivateUsage]


# --- エラー ---


async def test_llm_error_in_extraction_becomes_an_error_event() -> None:
    client = FakeClient(fail_with=LlmUnavailableError("rate_limit"))

    events = await collect(client)

    assert events == [
        StageEvent("extracting"),
        ErrorEvent(code="llm_unavailable", message=str(LlmUnavailableError("rate_limit"))),
    ]


async def test_llm_error_in_evaluation_becomes_an_error_event_after_the_scoring_stage() -> None:
    class FailingEvaluation(FakeClient):
        async def evaluate(self, request: EvaluateRequest) -> FinalEvaluation:
            raise LlmUnavailableError("timeout")

    events = await collect(FailingEvaluation())

    assert [type(e) for e in events] == [StageEvent, StageEvent, ErrorEvent]
    assert events[-1] == ErrorEvent(
        code="llm_unavailable", message=str(LlmUnavailableError("timeout"))
    )


async def test_no_conditions_is_an_error_before_any_event() -> None:
    with pytest.raises(NoConditionsError):
        await collect(FakeClient(), conditions=[])


async def test_unexpected_exceptions_are_not_swallowed() -> None:
    client = FakeClient(fail_with=RuntimeError("バグ"))

    with pytest.raises(RuntimeError):
        await collect(client)


async def test_cancellation_stops_the_pipeline_without_a_result() -> None:
    client = FakeClient(delay_sec=60)
    events: list[PipelineEvent] = []

    async def consume() -> None:
        async for event in run(
            resume=TEXT_RESUME, conditions=CONDITIONS, client=client, today=TODAY
        ):
            events.append(event)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert events == [StageEvent("extracting")]
    assert client.evaluate_calls == []
