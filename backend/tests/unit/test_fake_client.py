import asyncio
from datetime import date

import pytest

from app.domain.errors import LlmUnavailableError
from app.domain.models import Condition, Judgement
from app.domain.quotes import verify
from app.ingest.resume import ResumeInput
from app.llm.client import LlmClient
from app.llm.fake_client import FakeClient
from app.llm.requests import EvaluateRequest, ExtractRequest

TEXT = (
    "職務経歴書（架空のサンプル）\n1級建築施工管理技士（2018年取得）\n現場監督として 8 年勤務。\n"
)
TEXT_RESUME = ResumeInput(source_name="田中.docx", format="docx", text=TEXT)
PDF_RESUME = ResumeInput(source_name="田中.pdf", format="pdf", pdf=b"%PDF-1.7\n")


def condition(id: str, kind: str, *, min_value: float | None = None) -> Condition:
    return Condition.model_validate(
        {
            "id": id,
            "label": f"条件 {id}",
            "kind": kind,
            "required": False,
            "min_value": min_value,
            "unit": None,
            "source": "custom",
            "category": None,
        }
    )


CONDITIONS = [
    condition("a", "boolean"),
    condition("b", "number", min_value=5),
    condition("c", "boolean"),
    condition("d", "number", min_value=0.5),
]


def extract_request(resume: ResumeInput = TEXT_RESUME) -> ExtractRequest:
    return ExtractRequest(resumes=[resume], today=date(2026, 10, 25), conditions=CONDITIONS)


async def evaluate_request(
    client: FakeClient, resume: ResumeInput = TEXT_RESUME, *, match_rate: int = 50
) -> EvaluateRequest:
    extraction = await client.extract(extract_request(resume))
    return EvaluateRequest(
        resumes=[resume],
        today=date(2026, 10, 25),
        conditions=CONDITIONS,
        extractions=extraction.results,
        judgements=[Judgement(condition_id=c.id, status="achieved") for c in CONDITIONS],
        match_rate=match_rate,
        missing_required=[],
    )


def test_fake_client_satisfies_the_llm_client_protocol() -> None:
    client: LlmClient = FakeClient()

    assert client is not None


async def test_extract_returns_one_result_per_condition_in_order() -> None:
    result = await FakeClient().extract(extract_request())

    assert [r.condition_id for r in result.results] == ["a", "b", "c", "d"]


async def test_extract_fills_the_field_that_matches_the_kind() -> None:
    result = await FakeClient().extract(extract_request())

    for extraction, cond in zip(result.results, CONDITIONS, strict=True):
        if cond.kind == "boolean":
            assert extraction.has_skill is not None
            assert extraction.years is None
        else:
            assert extraction.has_skill is None
            assert extraction.years is not None


async def test_extract_is_deterministic_and_mixes_achieved_and_unmet() -> None:
    first = await FakeClient().extract(extract_request())
    second = await FakeClient().extract(extract_request())

    assert first == second
    flags = [r.has_skill for r in first.results if r.has_skill is not None]
    years = [r.years for r in first.results if r.years is not None]
    assert True in flags
    assert False in flags
    assert any(
        y >= c.min_value for y, c in zip(years, CONDITIONS[1::2], strict=True) if c.min_value
    )
    assert any(y < c.min_value for y, c in zip(years, CONDITIONS[1::2], strict=True) if c.min_value)


async def test_unmet_number_condition_with_a_zero_minimum_is_unknown_not_zero_years() -> None:
    # years=0 は、最低値 0 に対して「達成」になってしまう。記載がないときは null（不明）にする
    zero_minimum = [condition("z0", "number", min_value=0), condition("z1", "number", min_value=0)]
    request = ExtractRequest(
        resumes=[TEXT_RESUME], today=date(2026, 10, 25), conditions=zero_minimum
    )

    result = await FakeClient().extract(request)

    unmet = [r for r in result.results if not r.quotes]
    assert unmet
    assert all(r.years is None for r in unmet)


async def test_every_extraction_names_the_source_and_quotes_it_as_given() -> None:
    result = await FakeClient().extract(extract_request())

    for extraction in result.results:
        assert extraction.reason.startswith('"田中.docx"')
        assert all(q.source_name == "田中.docx" for q in extraction.quotes)
    # 記載が見つかった条件には引用があり、見つからなかった条件は、引用が空（仕様 5.4）
    achieved = [r for r in result.results if r.has_skill or (r.years or 0) >= 5]
    assert achieved
    assert all(r.quotes for r in achieved)
    assert any(not r.quotes for r in result.results)


async def test_quotes_of_a_text_resume_can_be_found_in_the_text() -> None:
    result = await FakeClient().extract(extract_request())

    for extraction in result.results:
        for quote in extraction.quotes:
            assert verify(quote.text, TEXT) == "match"


async def test_pdf_resume_is_handled_without_text() -> None:
    result = await FakeClient().extract(extract_request(PDF_RESUME))

    assert all(q.source_name == "田中.pdf" for e in result.results for q in e.quotes)


async def test_evaluate_returns_a_schema_valid_evaluation() -> None:
    client = FakeClient()

    result = await client.evaluate(await evaluate_request(client))

    assert 0 <= result.score <= 100
    assert 1 <= len(result.strengths) <= 5
    assert len(result.weaknesses) <= 5
    assert result.summary.reason.startswith('"田中.docx"')


async def test_evaluate_score_follows_the_match_rate_by_default() -> None:
    client = FakeClient()

    result = await client.evaluate(await evaluate_request(client, match_rate=63))

    assert result.score == 63


async def test_evaluate_score_can_be_forced_to_exercise_clipping() -> None:
    client = FakeClient(score=100)

    result = await client.evaluate(await evaluate_request(client, match_rate=40))

    assert result.score == 100


async def test_evaluate_includes_one_quote_that_cannot_be_found_in_the_text() -> None:
    # 「原文で確認できず」の表示（受け入れ基準 15）を、画面で確かめられるように
    client = FakeClient()

    result = await client.evaluate(await evaluate_request(client))

    quotes = [q for p in [result.summary, *result.strengths, *result.weaknesses] for q in p.quotes]
    verdicts = {verify(q.text, TEXT) for q in quotes}
    assert verdicts == {"match", "not_found"}


async def test_calls_are_recorded() -> None:
    client = FakeClient()
    request = extract_request()

    await client.extract(request)

    assert client.extract_calls == [request]
    assert client.evaluate_calls == []


async def test_delay_is_applied_to_each_call() -> None:
    client = FakeClient(delay_sec=0.05)
    started = asyncio.get_running_loop().time()

    await client.extract(extract_request())

    assert asyncio.get_running_loop().time() - started >= 0.045


async def test_delayed_call_can_be_cancelled() -> None:
    client = FakeClient(delay_sec=60)
    task = asyncio.create_task(client.extract(extract_request()))
    await asyncio.sleep(0.01)

    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


async def test_configured_error_is_raised() -> None:
    client = FakeClient(fail_with=LlmUnavailableError("rate_limit"))

    with pytest.raises(LlmUnavailableError):
        await client.extract(extract_request())
    with pytest.raises(LlmUnavailableError):
        await client.evaluate(await evaluate_request(FakeClient()))


async def test_extract_returns_a_fixed_fictional_applicant_name() -> None:
    result = await FakeClient().extract(
        ExtractRequest(
            resumes=[TEXT_RESUME],
            today=date(2026, 10, 25),
            conditions=[condition("a", "boolean")],
        )
    )

    assert result.applicant_name == "架空 太郎"
