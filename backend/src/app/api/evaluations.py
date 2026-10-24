"""POST /api/evaluations: 評価を実行し、進捗と結果を SSE で流す（仕様 7）。

サーバーは評価の状態を持たない。1 回のリクエストの応答として、`stage`・`result`・`error` を
順に流す。切断（キャンセル）されると、実行中の LLM 呼び出しも中止される。
"""

from collections.abc import AsyncIterable
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import TypeAdapter, ValidationError

from app.api.deps import ServicesDep
from app.api.schemas import ErrorResponse, StageData, StreamError
from app.domain.errors import InvalidConditionsError, LlmAuthError, NoConditionsError
from app.domain.models import Condition, Config
from app.ingest.resume import ResumeInput, load_resume
from app.pipeline import ErrorEvent, PipelineEvent, ResultEvent, StageEvent, run

router = APIRouter()

_CONDITIONS = TypeAdapter(list[Condition])


@dataclass(frozen=True)
class EvaluationInput:
    resume: ResumeInput
    conditions: list[Condition]
    config: Config


async def get_evaluation_input(
    services: ServicesDep,
    conditions: Annotated[str, Form()],
    file: Annotated[UploadFile | None, File()] = None,
    text: Annotated[str | None, Form()] = None,
) -> EvaluationInput:
    """ストリームを始める前に、入力を検証する。問題は、通常の HTTP エラー（422・413）で返す。"""
    try:
        parsed = _CONDITIONS.validate_json(conditions)
    except ValidationError:
        raise InvalidConditionsError from None
    if not parsed:
        raise NoConditionsError("評価する条件がありません。条件を 1 件以上選んでください。")
    if len({c.id for c in parsed}) != len(parsed):
        raise InvalidConditionsError

    config = services.config_store.load()
    if services.settings.llm_mode == "real" and not config.openai_api_key:
        raise LlmAuthError(
            "API キーが設定されていません。設定ページで API キーを登録してください。"
        )

    # ファイルは、ここで読み切る（検証のあとに、サーバーに残さない）
    content = await file.read() if file is not None else None
    resume = await load_resume(
        filename=(file.filename or "") if file is not None else None,
        content=content,
        pasted_text=text,
        max_size_mb=config.max_file_size_mb,
    )
    return EvaluationInput(resume=resume, conditions=parsed, config=config)


def _to_sse(event: PipelineEvent) -> ServerSentEvent:
    match event:
        case StageEvent(stage=stage):
            return ServerSentEvent(event="stage", data=StageData(stage=stage))
        case ResultEvent(result=result):
            return ServerSentEvent(event="result", data=result)
        case ErrorEvent(code=code, message=message):
            return ServerSentEvent(event="error", data=StreamError(code=code, message=message))


@router.post(
    "/api/evaluations",
    response_class=EventSourceResponse,
    responses={
        413: {"model": ErrorResponse, "description": "ファイルサイズが上限を超えた"},
        422: {"model": ErrorResponse, "description": "入力（条件・職歴書）が正しくない"},
    },
)
async def evaluate(
    services: ServicesDep,
    evaluation: Annotated[EvaluationInput, Depends(get_evaluation_input)],
) -> AsyncIterable[ServerSentEvent]:
    """イベント: `stage`（StageData）→ `stage` → `result`（EvaluationResult）、または `error`。"""
    client = services.make_client(evaluation.config)
    try:
        async for event in run(
            resume=evaluation.resume,
            conditions=evaluation.conditions,
            client=client,
            today=services.today(),
        ):
            yield _to_sse(event)
    finally:
        # 切断されたとき（CancelledError）も、LLM のクライアントを閉じる
        await client.aclose()
