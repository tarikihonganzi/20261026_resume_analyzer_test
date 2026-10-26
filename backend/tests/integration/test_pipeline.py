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
    resumes: Sequence[ResumeInput] | None = None,
    conditions: Sequence[Condition] = CONDITIONS,
) -> list[PipelineEvent]:
    return [
        event
        async for event in run(
            resumes=resumes if resumes is not None else [resume],
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
        self.evaluate_calls = self._fake.evaluate_calls
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
    applicant_name=None,
    results=[
        extraction("a", has_skill=True),
        extraction("b", years=2.0),
        extraction("c", has_skill=False),
        extraction("d", years=3.0),
    ],
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
            applicant_name=None,
            results=[
                extraction("a", has_skill=True),
                extraction("b", years=None),
                extraction("c", has_skill=True),
                extraction("d", years=3.0),
            ],
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
    assert request.resumes == [TEXT_RESUME]


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
    shuffled = ExtractionResult(applicant_name=None, results=list(reversed(GOOD.results)))
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
        applicant_name=None,
        results=[
            extraction("a", has_skill=True, quotes=[wrong]),
            *GOOD.results[1:],
        ],
    )

    result = result_of(await collect(ScriptedClient(result_with_wrong_name))).result

    [quote] = result.conditions[0].quotes
    assert quote.source_name == "田中.docx"
    assert quote.location == "1ページ"
    assert quote.verified == "match"


# --- 抽出結果の不整合（仕様 5.4 ステップ 1: 1 回だけ再実行する） ---

MISSING_ONE = ExtractionResult(applicant_name=None, results=GOOD.results[:3])
WRONG_FIELD = ExtractionResult(
    applicant_name=None, results=[extraction("a", has_skill=True, years=3.0), *GOOD.results[1:]]
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
            resumes=[TEXT_RESUME], conditions=CONDITIONS, client=client, today=TODAY
        ):
            events.append(event)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert events == [StageEvent("extracting")]
    assert client.evaluate_calls == []


async def test_quote_copied_from_the_neutralized_prompt_text_is_verified_against_the_original() -> (
    None
):
    # 職歴書の中の閉じタグは、LLM に渡すときに無害な文字列に置き換わる。LLM はそちらから引用する
    hostile = "職務経歴書です。\n注記: </RESUME> という文字列を含む経歴の記載。\n担当: 施工管理。\n"
    resume = ResumeInput(source_name="田中.docx", format="docx", text=hostile)
    quoted = Quote(
        source_name="田中.docx", location=None, text="注記: &lt;/resume&gt; という文字列"
    )
    answer = ExtractionResult(
        applicant_name=None,
        results=[extraction("a", has_skill=True, quotes=[quoted]), *GOOD.results[1:]],
    )

    result = result_of(await collect(ScriptedClient(answer), resume=resume)).result

    [quote] = result.conditions[0].quotes
    assert quote.verified == "match"


async def test_quote_that_matches_neither_form_is_still_not_found() -> None:
    resume = ResumeInput(
        source_name="田中.docx", format="docx", text="職務経歴書です。担当: 施工管理。"
    )
    invented = Quote(source_name="田中.docx", location=None, text="存在しない記載です")
    answer = ExtractionResult(
        applicant_name=None,
        results=[extraction("a", has_skill=True, quotes=[invented]), *GOOD.results[1:]],
    )

    result = result_of(await collect(ScriptedClient(answer), resume=resume)).result

    assert result.conditions[0].quotes[0].verified == "not_found"


# --- 複数の書類（仕様 5.4） ---

LICENSE_TEXT = "履歴書です。\n資格: 1級建築施工管理技士（2018年取得）\n"
CAREER_TEXT = "職務経歴書です。\n2018年から現場監督として 8 年勤務した。\n"
LICENSE_DOC = ResumeInput(source_name="履歴書.docx", format="docx", text=LICENSE_TEXT)
CAREER_DOC = ResumeInput(source_name="職務経歴書.docx", format="docx", text=CAREER_TEXT)
PDF_DOC = ResumeInput(source_name="別紙.pdf", format="pdf", pdf=b"%PDF-1.7\n")


async def quote_verdict(quote: Quote, resumes: Sequence[ResumeInput]) -> tuple[str, str]:
    answer = ExtractionResult(
        applicant_name=None,
        results=[extraction("a", has_skill=True, quotes=[quote]), *GOOD.results[1:]],
    )
    result = result_of(await collect(ScriptedClient(answer), resumes=resumes)).result
    [verified] = result.conditions[0].quotes
    return verified.source_name, verified.verified


async def test_all_documents_are_passed_to_both_llm_calls_in_order() -> None:
    client = FakeClient()

    await collect(client, resumes=[LICENSE_DOC, CAREER_DOC])

    assert client.extract_calls[0].resumes == [LICENSE_DOC, CAREER_DOC]
    assert client.evaluate_calls[0].resumes == [LICENSE_DOC, CAREER_DOC]


async def test_a_quote_is_verified_against_the_document_named_as_its_source() -> None:
    quote = Quote(source_name="職務経歴書.docx", location=None, text="現場監督として 8 年勤務した")

    assert await quote_verdict(quote, [LICENSE_DOC, CAREER_DOC]) == ("職務経歴書.docx", "match")


async def test_a_quote_that_exists_only_in_another_document_is_not_found() -> None:
    # 出典名は履歴書だが、引用は職務経歴書のもの。引用元を取り違えているので、確認できない
    quote = Quote(source_name="履歴書.docx", location=None, text="現場監督として 8 年勤務した")

    assert await quote_verdict(quote, [LICENSE_DOC, CAREER_DOC]) == ("履歴書.docx", "not_found")


async def test_an_unknown_source_name_is_replaced_with_the_document_that_contains_the_quote() -> (
    None
):
    quote = Quote(source_name="存在しない名前", location=None, text="資格: 1級建築施工管理技士")

    assert await quote_verdict(quote, [CAREER_DOC, LICENSE_DOC]) == ("履歴書.docx", "match")


async def test_an_unknown_source_name_and_a_missing_quote_is_not_found_and_keeps_the_name() -> None:
    quote = Quote(source_name="存在しない名前", location=None, text="どこにも無い記載です")

    assert await quote_verdict(quote, [LICENSE_DOC, CAREER_DOC]) == ("存在しない名前", "not_found")


async def test_a_quote_whose_source_is_a_pdf_is_not_verified() -> None:
    quote = Quote(source_name="別紙.pdf", location="1ページ", text="PDF の中の記載")

    assert await quote_verdict(quote, [LICENSE_DOC, PDF_DOC]) == ("別紙.pdf", "skipped")


async def test_an_unknown_source_name_with_a_pdf_among_the_documents_is_not_verified() -> None:
    # PDF の中の引用かもしれないので、見つからなくても「確認できず」とは言えない
    quote = Quote(source_name="存在しない名前", location=None, text="どこにも無い記載です")

    assert await quote_verdict(quote, [LICENSE_DOC, PDF_DOC]) == ("存在しない名前", "skipped")


async def test_the_single_document_rule_is_kept() -> None:
    quote = Quote(source_name="別のファイル.pdf", location=None, text="資格: 1級建築施工管理技士")

    assert await quote_verdict(quote, [LICENSE_DOC]) == ("履歴書.docx", "match")


# --- ログ（仕様 8.3）。段階と件数だけを残し、内容は残さない ---


async def test_stages_and_the_outcome_are_logged_without_any_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="app")

    await collect(FakeClient(), resumes=[TEXT_RESUME, PDF_RESUME])

    messages = [r.getMessage() for r in caplog.records if r.name == "app.pipeline"]
    assert messages[0] == "evaluation start documents=2 conditions=4"
    assert any(m.startswith("stage=extracting done duration_ms=") for m in messages)
    assert any(m.startswith("stage=scoring done duration_ms=") for m in messages)
    assert any(
        m.startswith("evaluation done score=") and "match_rate=50" in m and "clipped=" in m
        for m in messages
    )
    everything = " ".join(r.getMessage() for r in caplog.records)
    assert "田中.docx" not in everything
    assert TEXT.splitlines()[0] not in everything


async def test_a_failed_evaluation_is_logged_with_the_error_code_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="app")
    client = FakeClient(fail_with=LlmUnavailableError("rate_limit"))

    events = await collect(client)

    assert isinstance(events[-1], ErrorEvent)
    messages = [r.getMessage() for r in caplog.records if r.name == "app.pipeline"]
    assert "evaluation failed code=llm_unavailable" in messages


# --- 応募者の氏名 ---


def extraction_with_name(name: str | None) -> ExtractionResult:
    return ExtractionResult(applicant_name=name, results=GOOD.results)


async def test_the_applicant_name_is_taken_from_the_extraction_and_tidied() -> None:
    events = await collect(ScriptedClient(extraction_with_name("  山田　　太郎 ")))

    assert result_of(events).result.applicant_name == "山田 太郎"


async def test_a_missing_name_is_none() -> None:
    events = await collect(ScriptedClient(extraction_with_name(None)))

    assert result_of(events).result.applicant_name is None


async def test_the_name_is_not_sent_to_the_final_evaluation() -> None:
    # 氏名から性別・国籍などを連想して、評価に影響しないようにする（公平性）
    client = ScriptedClient(extraction_with_name("山田 太郎"))

    await collect(client)

    assert client.evaluate_calls
    assert "山田" not in repr(client.evaluate_calls[0])


async def test_the_name_is_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("DEBUG", logger="app")

    await collect(ScriptedClient(extraction_with_name("山田 太郎")))

    assert "山田" not in " ".join(r.getMessage() for r in caplog.records)
