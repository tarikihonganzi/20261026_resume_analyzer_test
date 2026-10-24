"""OpenAI の Responses API を使う `LlmClient`（仕様 9）。

`responses.create` に strict の JSON Schema を渡して、Structured Output を受け取る。`store=False`。
`temperature` と推論負荷（`reasoning`）は指定しない。ログに出すのは、リクエスト ID・所要時間・
トークン使用量だけ（職歴書の内容と API キーは出さない）。
"""

import logging
import time
from typing import cast

import httpx2
import openai
from openai import AsyncOpenAI, pydantic_function_tool
from openai.types.responses import ResponseFormatTextJSONSchemaConfigParam, ResponseInputParam
from pydantic import BaseModel, ValidationError

from app.domain.errors import (
    LlmAuthError,
    LlmRequestError,
    LlmResponseError,
    LlmUnavailableError,
)
from app.domain.models import Config
from app.llm.prompts import (
    EVALUATE_SYSTEM_PROMPT,
    EXTRACT_SYSTEM_PROMPT,
    InputItems,
    build_evaluate_input,
    build_extract_input,
)
from app.llm.requests import EvaluateRequest, ExtractRequest
from app.llm.schemas import ExtractionResult, FinalEvaluation

logger = logging.getLogger("app.llm")

# 推論モデルは、出力トークンに推論の分も含まれる。途中で切れないよう、十分に大きくする
MAX_OUTPUT_TOKENS = 32_000
# ベース URL が空のとき。None を渡すと、SDK が環境変数 OPENAI_BASE_URL を読んでしまい、設定
# （保存した空文字は環境変数より優先する。仕様 4.1）と違う宛先に、職歴書と API キーを送ってしまう
DEFAULT_BASE_URL = "https://api.openai.com/v1"


def _json_schema_format(model: type[BaseModel]) -> ResponseFormatTextJSONSchemaConfigParam:
    """Structured Output（strict）の `text.format`。SDK の `responses.parse` が送るものと同じ形。"""
    parameters = pydantic_function_tool(model)["function"].get("parameters")
    assert parameters is not None
    return {
        "type": "json_schema",
        "name": model.__name__,
        "schema": dict(parameters),
        "strict": True,
    }


class OpenAIClient:
    """設定（API キー・ベース URL・モデル名など）は、作成時のものを使う。

    設定が変わったら、新しい `OpenAIClient` を作って差し替え、古いものは `aclose()` で閉じる。
    """

    def __init__(
        self,
        config: Config,
        *,
        http_client: httpx2.AsyncClient | None = None,
        max_retries: int = 2,
    ) -> None:
        self._config = config
        self._http_client = http_client
        self._max_retries = max_retries
        self._sdk: AsyncOpenAI | None = None

    def _client(self) -> AsyncOpenAI:
        # API キー未設定でもアプリが起動できるよう、最初の呼び出しまで SDK のクライアントを作らない
        if not self._config.openai_api_key:
            raise LlmAuthError(
                "API キーが設定されていません。設定ページで API キーを登録してください。"
            )
        if self._sdk is None:
            self._sdk = AsyncOpenAI(
                api_key=self._config.openai_api_key,
                base_url=self._config.openai_base_url or DEFAULT_BASE_URL,
                timeout=self._config.request_timeout_sec,
                max_retries=self._max_retries,
                http_client=self._http_client,
            )
        return self._sdk

    async def aclose(self) -> None:
        if self._sdk is not None:
            await self._sdk.close()
            self._sdk = None

    async def check_connection(self) -> None:
        """設定ページの「接続テスト」。最小のリクエストを 1 回送り、失敗したら `LlmError`。"""
        client = self._client()
        started = time.perf_counter()
        try:
            # 出力の上限は、API が受け付ける最小の 16。応答の内容は使わない
            await client.responses.create(
                model=self._config.model, input="ping", max_output_tokens=16, store=False
            )
        except openai.OpenAIError as e:
            raise self._translate("check", e, started) from None

    async def extract(self, request: ExtractRequest) -> ExtractionResult:
        items = build_extract_input(request, pdf_detail=self._config.pdf_detail)
        return await self._parse("extract", EXTRACT_SYSTEM_PROMPT, items, ExtractionResult)

    async def evaluate(self, request: EvaluateRequest) -> FinalEvaluation:
        items = build_evaluate_input(request, pdf_detail=self._config.pdf_detail)
        return await self._parse("evaluate", EVALUATE_SYSTEM_PROMPT, items, FinalEvaluation)

    async def _parse[T: BaseModel](
        self, step: str, instructions: str, items: InputItems, text_format: type[T]
    ) -> T:
        """`responses.create` で受け取り、状態を確認してから、スキーマに沿ってパースする。

        `responses.parse` は、途中で切れた応答の JSON を、状態を確認する前にパースして失敗する。
        「途中で切れた」と「構造が正しくない」を区別するため、自分でパースする。
        """
        client = self._client()
        started = time.perf_counter()
        try:
            response = await client.responses.create(
                model=self._config.model,
                instructions=instructions,
                input=cast(ResponseInputParam, items),
                text={"format": _json_schema_format(text_format)},
                store=False,
                max_output_tokens=MAX_OUTPUT_TOKENS,
            )
        except openai.OpenAIError as e:
            raise self._translate(step, e, started) from None

        duration_ms = int((time.perf_counter() - started) * 1000)
        usage = response.usage
        logger.info(
            "llm_call step=%s request_id=%s duration_ms=%d input_tokens=%s output_tokens=%s",
            step,
            response._request_id,  # pyright: ignore[reportPrivateUsage]
            duration_ms,
            usage.input_tokens if usage else None,
            usage.output_tokens if usage else None,
        )

        # 確認の順序: 途中で切れた → 拒否 → 出力なし → 構造
        if response.status == "incomplete":
            raise LlmResponseError("incomplete")
        for output in response.output:
            if output.type == "message" and any(c.type == "refusal" for c in output.content):
                raise LlmResponseError("refusal")
        if not response.output_text:
            raise LlmResponseError("empty")
        try:
            return text_format.model_validate_json(response.output_text)
        except ValidationError:
            # 検証エラーの詳細には、応答の内容（職歴書の引用など）が含まれるので、連鎖させない
            logger.warning("llm_call step=%s failed reason=invalid", step)
            raise LlmResponseError("invalid") from None

    @staticmethod
    def _translate(step: str, error: openai.OpenAIError, started: float) -> Exception:
        """SDK の例外を、利用者向けの日本語のメッセージを持つ例外に対応づける。

        API の応答の本文には、API キーの一部などが含まれうるので、メッセージにも連鎖にも入れない。
        """
        status = getattr(error, "status_code", None)
        logger.warning(
            "llm_call step=%s failed error=%s status=%s request_id=%s duration_ms=%d",
            step,
            type(error).__name__,
            status,
            getattr(error, "request_id", None),
            int((time.perf_counter() - started) * 1000),
        )
        if isinstance(error, openai.AuthenticationError | openai.PermissionDeniedError):
            return LlmAuthError()
        if isinstance(error, openai.RateLimitError):
            return LlmUnavailableError("rate_limit")
        if isinstance(error, openai.APITimeoutError):
            return LlmUnavailableError("timeout")
        if isinstance(error, openai.APIConnectionError):
            return LlmUnavailableError("connection")
        if isinstance(error, openai.InternalServerError):
            return LlmUnavailableError("server")
        if isinstance(error, openai.APIStatusError):
            return LlmRequestError()
        if isinstance(error, openai.LengthFinishReasonError):
            return LlmResponseError("incomplete")
        return LlmResponseError("invalid")
