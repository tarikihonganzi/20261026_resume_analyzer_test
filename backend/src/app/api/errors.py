"""ドメインの例外を、HTTP のステータスと、利用者向けのメッセージに対応づける。

エラーの本文は、すべて `{"code": ..., "message": ..., "fields": [...]}`（ErrorResponse）。
API キーや職歴書の内容を、メッセージに入れない。
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.schemas import ErrorResponse
from app.domain.errors import (
    ConditionSetNotFoundError,
    DomainError,
    FileTooLargeError,
    InvalidConditionsError,
    LlmAuthError,
    LlmError,
    NoConditionsError,
    ResumeError,
    StorageError,
)

logger = logging.getLogger("app.api")

_HTTP_MESSAGES = {
    400: "リクエストの形式が正しくありません。",
    404: "指定されたものが見つかりません。",
    405: "この操作は使えません。",
    413: "送信するデータが大きすぎます。",
}


def _json(status: int, body: ErrorResponse) -> JSONResponse:
    return JSONResponse(status_code=status, content=body.model_dump(exclude_none=True))


def _status_for(error: DomainError) -> int:
    """利用者の入力の問題は 413・422、外部（AI サービス）の失敗は 502、それ以外は 500。"""
    if isinstance(error, FileTooLargeError):
        return 413
    if isinstance(error, ResumeError | NoConditionsError | LlmAuthError | InvalidConditionsError):
        return 422
    if isinstance(error, LlmError):
        return 502
    return 500


def _fields_of(error: RequestValidationError | ValidationError) -> list[str]:
    """検証に失敗した項目名を、重複なしで並べる。入力値は、返さない。"""
    fields: list[str] = []
    for item in error.errors():
        location = ".".join(str(part) for part in item["loc"] if part not in ("body", "form"))
        if location and location not in fields:
            fields.append(location)
    return fields


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def handle_domain_error(request: Request, error: DomainError) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        # 保存ファイルの問題は、利用者が直せないので、500 にして、ファイル名だけを知らせる
        if isinstance(error, StorageError):
            logger.error("storage error: %s", error)
            return _json(500, ErrorResponse(code="storage_error", message=str(error)))
        if isinstance(error, ConditionSetNotFoundError):
            return _json(404, ErrorResponse(code="not_found", message=str(error)))
        if isinstance(error, NoConditionsError):
            return _json(422, ErrorResponse(code="no_conditions", message=str(error)))
        code = getattr(error, "code", "error")
        return _json(_status_for(error), ErrorResponse(code=code, message=str(error)))

    async def handle_invalid_request(  # pyright: ignore[reportUnusedFunction]
        request: Request, error: RequestValidationError | ValidationError
    ) -> JSONResponse:
        # 検証エラーの詳細には、入力値が含まれうるので、項目名だけを返す
        return _json(
            422,
            ErrorResponse(
                code="invalid_request",
                message="入力内容が正しくありません。項目を確認してください。",
                fields=_fields_of(error),
            ),
        )

    async def handle_http_exception(  # pyright: ignore[reportUnusedFunction]
        request: Request, error: StarletteHTTPException
    ) -> JSONResponse:
        # フレームワークが出す 400（multipart の不備など）・404・405 も、同じ形にする。
        # 元のステータスとヘッダー（405 の Allow など）は保つ
        message = _HTTP_MESSAGES.get(error.status_code, "リクエストを処理できませんでした。")
        response = _json(
            error.status_code, ErrorResponse(code=f"http_{error.status_code}", message=message)
        )
        if error.headers:
            response.headers.update(error.headers)
        return response

    async def handle_unexpected(request: Request, error: Exception) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        # 想定外の失敗も、同じ形で返す。例外のメッセージ・スタックは、利用者に返さず、ログにも、
        # 型の名前だけを残す（API キーや職歴書の内容が、メッセージに紛れ込むのを避ける）
        logger.error("unexpected error type=%s", type(error).__name__)
        return _json(
            500,
            ErrorResponse(
                code="internal_error",
                message="予期しないエラーが起きました。もう一度お試しください。",
            ),
        )

    app.add_exception_handler(Exception, handle_unexpected)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)  # pyright: ignore[reportArgumentType]
    app.add_exception_handler(RequestValidationError, handle_invalid_request)  # pyright: ignore[reportArgumentType]
    app.add_exception_handler(ValidationError, handle_invalid_request)  # pyright: ignore[reportArgumentType]
