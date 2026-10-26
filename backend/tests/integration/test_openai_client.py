"""OpenAIClient の、リクエストの形とエラー処理の統合テスト。

HTTP を `httpx2.MockTransport` に差し替えるので、ネットワークも API 費用も使わない。
"""

import asyncio
import json
import logging
import time
from collections.abc import Callable, Coroutine
from datetime import date
from typing import Any
from unittest.mock import MagicMock

import httpx2
import openai
import pytest

from app.domain.errors import (
    LlmAuthError,
    LlmRequestError,
    LlmResponseError,
    LlmUnavailableError,
)
from app.domain.models import Condition, Config, Judgement
from app.ingest.resume import ResumeInput
from app.llm import prompts
from app.llm.openai_client import MAX_OUTPUT_TOKENS, OpenAIClient
from app.llm.requests import EvaluateRequest, ExtractRequest
from app.llm.schemas import ConditionExtraction, ExtractionResult, FinalEvaluation
from fixtures.openai_api import api_response

API_KEY = "sk-test-0123456789abcdefghijklmnopqrstuv"
BASE_URL = "https://llm.example.internal/v1"
RESUME_TEXT = "職務経歴書の本文。秘密の経歴: SECRET-RESUME-BODY。" * 3

Handler = (
    Callable[[httpx2.Request], httpx2.Response]
    | Callable[[httpx2.Request], Coroutine[Any, Any, httpx2.Response]]
)

CONDITIONS = [
    Condition(
        id="c1",
        label="1級建築施工管理技士",
        kind="boolean",
        required=True,
        min_value=None,
        unit=None,
        source="preset",
        category=None,
    ),
    Condition(
        id="c2",
        label="現場監督の経験",
        kind="number",
        required=False,
        min_value=5,
        unit="年",
        source="preset",
        category=None,
    ),
]
TEXT_RESUME = ResumeInput(source_name="田中.docx", format="docx", text=RESUME_TEXT)
PDF_RESUME = ResumeInput(source_name="田中.pdf", format="pdf", pdf=b"%PDF-1.7\nbody")


def extract_request(resume: ResumeInput = TEXT_RESUME) -> ExtractRequest:
    return ExtractRequest(resumes=[resume], today=date(2026, 10, 25), conditions=CONDITIONS)


def extraction(condition_id: str, **values: Any) -> ConditionExtraction:
    fields: dict[str, Any] = {"has_skill": None, "years": None, "reason": "r", "quotes": []}
    return ConditionExtraction(condition_id=condition_id, **(fields | values))


EXTRACTIONS = [extraction("c1", has_skill=True), extraction("c2", years=6.0)]
EXTRACTION_RESULT = ExtractionResult(applicant_name=None, results=EXTRACTIONS)


def evaluate_request(resume: ResumeInput = TEXT_RESUME) -> EvaluateRequest:
    return EvaluateRequest(
        resumes=[resume],
        today=date(2026, 10, 25),
        conditions=CONDITIONS,
        extractions=EXTRACTIONS,
        judgements=[
            Judgement(condition_id="c1", status="achieved"),
            Judgement(condition_id="c2", status="achieved"),
        ],
        match_rate=100,
        missing_required=[],
    )


FINAL_EVALUATION = FinalEvaluation.model_validate(
    {
        "score": 88,
        "summary": {"text": "**概要**", "reason": "r", "quotes": []},
        "strengths": [{"text": "良い点", "reason": "r", "quotes": []}],
        "weaknesses": [],
    }
)


def ok(model: ExtractionResult | FinalEvaluation) -> httpx2.Response:
    return httpx2.Response(
        200, json=api_response(model.model_dump_json()), headers={"x-request-id": "req_abc123"}
    )


def make_client(
    handler: Handler,
    *,
    config: Config | None = None,
    max_retries: int = 0,
) -> OpenAIClient:
    config = config or Config(openai_api_key=API_KEY, openai_base_url=BASE_URL)
    transport = httpx2.MockTransport(handler)
    return OpenAIClient(
        config, http_client=httpx2.AsyncClient(transport=transport), max_retries=max_retries
    )


class Recorder:
    """リクエストを記録して、決まった応答を返すハンドラー。"""

    def __init__(self, *responses: httpx2.Response) -> None:
        self.requests: list[httpx2.Request] = []
        self._responses = list(responses)

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]

    @property
    def body(self) -> dict[str, Any]:
        return json.loads(self.requests[-1].content)


# --- リクエストの形 ---


async def test_extract_sends_a_responses_api_request_with_the_documented_shape() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))
    client = make_client(recorder)

    result = await client.extract(extract_request())

    assert result == EXTRACTION_RESULT
    [request] = recorder.requests
    assert request.method == "POST"
    assert str(request.url) == f"{BASE_URL}/responses"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    body = recorder.body
    assert body["model"] == "response-standard"
    assert body["instructions"] == prompts.EXTRACT_SYSTEM_PROMPT
    assert body["store"] is False
    assert body["max_output_tokens"] == MAX_OUTPUT_TOKENS
    text_format = body["text"]["format"]
    assert text_format["type"] == "json_schema"
    assert text_format["strict"] is True
    assert text_format["name"] == "ExtractionResult"
    assert text_format["schema"]["required"] == ["applicant_name", "results"]


async def test_request_does_not_set_sampling_or_reasoning_or_chaining_options() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))

    await make_client(recorder).extract(extract_request())

    for forbidden in ("temperature", "top_p", "reasoning", "previous_response_id", "tools"):
        assert forbidden not in recorder.body


async def test_input_is_the_prompt_built_from_the_request() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))

    await make_client(recorder).extract(extract_request())

    expected = prompts.build_extract_input(extract_request(), pdf_detail="high")
    assert recorder.body["input"] == expected


async def test_pdf_is_sent_as_an_input_file_with_the_configured_detail() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))
    config = Config(openai_api_key=API_KEY, openai_base_url=BASE_URL, pdf_detail="low")

    await make_client(recorder, config=config).extract(extract_request(PDF_RESUME))

    file_part = recorder.body["input"][0]["content"][1]
    assert file_part["type"] == "input_file"
    assert file_part["filename"] == "田中.pdf"
    assert file_part["detail"] == "low"
    assert file_part["file_data"].startswith("data:application/pdf;base64,")


async def test_evaluate_uses_the_final_evaluation_schema_and_prompt() -> None:
    recorder = Recorder(ok(FINAL_EVALUATION))

    result = await make_client(recorder).evaluate(evaluate_request())

    assert result == FINAL_EVALUATION
    body = recorder.body
    assert body["instructions"] == prompts.EVALUATE_SYSTEM_PROMPT
    assert body["text"]["format"]["name"] == "FinalEvaluation"
    assert body["store"] is False


async def test_configured_model_is_used() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))
    config = Config(openai_api_key=API_KEY, openai_base_url=BASE_URL, model="gpt-5.5-mini")

    await make_client(recorder, config=config).extract(extract_request())

    assert recorder.body["model"] == "gpt-5.5-mini"


async def test_empty_base_url_uses_the_company_endpoint() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))
    config = Config(openai_api_key=API_KEY, openai_base_url="")

    await make_client(recorder, config=config).extract(extract_request())

    assert str(recorder.requests[0].url) == "https://kjm-kong.kajima.co.jp/openai/v1/responses"


async def test_empty_base_url_ignores_the_sdk_environment_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 保存済みの空文字は、環境変数より優先する（仕様 4.1）。SDK が環境変数を再参照してはならない
    monkeypatch.setenv("OPENAI_BASE_URL", "https://other.example.internal/v1")
    recorder = Recorder(ok(EXTRACTION_RESULT))
    config = Config(openai_api_key=API_KEY, openai_base_url="")

    await make_client(recorder, config=config).extract(extract_request())

    assert str(recorder.requests[0].url) == "https://kjm-kong.kajima.co.jp/openai/v1/responses"


async def test_configured_timeout_is_applied() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))
    config = Config(openai_api_key=API_KEY, openai_base_url=BASE_URL, request_timeout_sec=77)

    await make_client(recorder, config=config).extract(extract_request())

    assert recorder.requests[0].extensions["timeout"]["read"] == 77


async def test_missing_api_key_is_an_auth_error_without_any_request() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))
    config = Config(openai_api_key="", openai_base_url=BASE_URL)

    with pytest.raises(LlmAuthError) as excinfo:
        await make_client(recorder, config=config).extract(extract_request())

    assert "設定ページ" in str(excinfo.value)
    assert recorder.requests == []


# --- 応答の確認（途中で切れた・拒否・パースできない） ---


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (httpx2.Response(200, json=api_response('{"results": [', incomplete=True)), "incomplete"),
        (httpx2.Response(200, json=api_response(None, refusal="お答えできません")), "refusal"),
        (httpx2.Response(200, json=api_response(None)), "empty"),
        (httpx2.Response(200, json=api_response("これは JSON ではない")), "invalid"),
        (httpx2.Response(200, json=api_response('{"results": "not a list"}')), "invalid"),
    ],
    ids=["incomplete", "refusal", "empty", "not-json", "wrong-structure"],
)
async def test_unusable_responses_are_response_errors(
    response: httpx2.Response, reason: str
) -> None:
    with pytest.raises(LlmResponseError) as excinfo:
        await make_client(Recorder(response)).extract(extract_request())

    assert excinfo.value.reason == reason
    assert "もう一度" in str(excinfo.value)


async def test_refusal_text_is_not_shown_to_the_user() -> None:
    response = httpx2.Response(200, json=api_response(None, refusal="SECRET-REFUSAL-TEXT"))

    with pytest.raises(LlmResponseError) as excinfo:
        await make_client(Recorder(response)).extract(extract_request())

    assert "SECRET-REFUSAL-TEXT" not in str(excinfo.value)


# --- HTTP エラーの対応づけ ---


def error_response(status: int, message: str = "error") -> httpx2.Response:
    return httpx2.Response(
        status,
        json={"error": {"message": message, "type": "invalid_request_error", "code": "x"}},
        headers={"x-request-id": "req_err", "retry-after-ms": "1"},
    )


@pytest.mark.parametrize("status", [401, 403])
async def test_auth_errors_point_to_the_settings_page_without_leaking_the_key(status: int) -> None:
    body = f"Incorrect API key provided: {API_KEY}"

    with pytest.raises(LlmAuthError) as excinfo:
        await make_client(Recorder(error_response(status, body))).extract(extract_request())

    assert "設定ページ" in str(excinfo.value)
    assert API_KEY not in str(excinfo.value)
    assert excinfo.value.__cause__ is None
    assert excinfo.value.__suppress_context__


@pytest.mark.parametrize(
    ("status", "kind"), [(429, "rate_limit"), (500, "server"), (502, "server"), (503, "server")]
)
async def test_transient_http_errors_ask_the_user_to_retry(status: int, kind: str) -> None:
    with pytest.raises(LlmUnavailableError) as excinfo:
        await make_client(Recorder(error_response(status))).extract(extract_request())

    assert excinfo.value.kind == kind
    assert "もう一度" in str(excinfo.value)


@pytest.mark.parametrize("status", [400, 404, 422])
async def test_rejected_requests_point_to_the_model_and_base_url(status: int) -> None:
    with pytest.raises(LlmRequestError) as excinfo:
        await make_client(Recorder(error_response(status))).extract(extract_request())

    assert "モデル名" in str(excinfo.value)
    assert "ベース URL" in str(excinfo.value)


async def test_timeout_is_reported_as_a_timeout() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("timed out", request=request)

    with pytest.raises(LlmUnavailableError) as excinfo:
        await make_client(handler).extract(extract_request())

    assert excinfo.value.kind == "timeout"


async def test_connection_failure_is_reported_as_a_connection_error() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused", request=request)

    with pytest.raises(LlmUnavailableError) as excinfo:
        await make_client(handler).extract(extract_request())

    assert excinfo.value.kind == "connection"


# --- 自動リトライ ---


async def test_rate_limit_is_retried_and_then_succeeds() -> None:
    recorder = Recorder(error_response(429), ok(EXTRACTION_RESULT))

    result = await make_client(recorder, max_retries=2).extract(extract_request())

    assert result == EXTRACTION_RESULT
    assert len(recorder.requests) == 2


async def test_retries_stop_after_the_limit() -> None:
    recorder = Recorder(error_response(503))

    with pytest.raises(LlmUnavailableError):
        await make_client(recorder, max_retries=2).extract(extract_request())

    assert len(recorder.requests) == 3


async def test_auth_errors_are_not_retried() -> None:
    recorder = Recorder(error_response(401))

    with pytest.raises(LlmAuthError):
        await make_client(recorder, max_retries=2).extract(extract_request())

    assert len(recorder.requests) == 1


# --- ログ ---


async def test_success_logs_request_id_duration_and_tokens_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG, logger="app.llm")
    recorder = Recorder(ok(EXTRACTION_RESULT))

    await make_client(recorder).extract(extract_request())

    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "req_abc123" in text
    assert "input_tokens=1234" in text
    assert "output_tokens=567" in text
    assert "duration_ms=" in text
    assert API_KEY not in text
    assert "SECRET-RESUME-BODY" not in text
    assert "田中.docx" not in text


async def test_failure_logs_the_status_but_not_the_body_or_the_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG, logger="app.llm")
    body = f"Incorrect API key provided: {API_KEY}"

    with pytest.raises(LlmAuthError):
        await make_client(Recorder(error_response(401, body))).extract(extract_request())

    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "status=401" in text
    assert "req_err" in text
    assert API_KEY not in text
    assert "Incorrect API key" not in text


# --- キャンセルと後始末 ---


async def test_cancellation_reaches_the_in_flight_request() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def handler(request: httpx2.Request) -> httpx2.Response:
        started.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return ok(EXTRACTION_RESULT)

    task = asyncio.create_task(make_client(handler).extract(extract_request()))
    await asyncio.wait_for(started.wait(), timeout=5)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()


async def test_aclose_can_be_called_more_than_once() -> None:
    recorder = Recorder(ok(EXTRACTION_RESULT))
    client = OpenAIClient(
        Config(openai_api_key=API_KEY, openai_base_url=BASE_URL),
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(recorder)),
        max_retries=0,
    )
    await client.extract(extract_request())

    await client.aclose()
    await client.aclose()


async def test_client_does_not_log_or_expose_the_key_in_repr() -> None:
    client = make_client(Recorder(ok(EXTRACTION_RESULT)))

    assert API_KEY not in repr(client)
    assert API_KEY not in repr(client._config)  # pyright: ignore[reportPrivateUsage]


# --- SDK の例外の対応づけ（`_translate`）。HTTP 経由で再現しにくいものを、直接確かめる ---


def translated(error: openai.OpenAIError) -> Exception:
    return OpenAIClient._translate("extract", error, time.perf_counter())  # pyright: ignore[reportPrivateUsage]


def test_a_truncated_completion_is_an_incomplete_response_error() -> None:
    error = openai.LengthFinishReasonError(completion=MagicMock())

    result = translated(error)

    assert isinstance(result, LlmResponseError)
    assert result.reason == "incomplete"


def test_an_unknown_sdk_error_is_an_invalid_response_error_without_its_message() -> None:
    result = translated(openai.OpenAIError("sk-secret-key-0000 と、職歴書の一部"))

    assert isinstance(result, LlmResponseError)
    assert result.reason == "invalid"
    assert "sk-secret" not in str(result)
