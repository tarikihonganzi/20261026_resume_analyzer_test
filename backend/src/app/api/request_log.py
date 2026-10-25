"""リクエストのログ（仕様 8.3）。

1 リクエストごとに、リクエスト ID を付け（応答の `X-Request-ID` と、すべてのログ行）、終わったとき
に、メソッド・パス・ステータス・所要時間を、1 行で記録する。**パスだけ**を記録し、クエリ・ヘッダー・
本文は、記録しない（API キーや職歴書の内容が、混ざらないように）。

ストリーミング（SSE）の応答を壊さないよう、`BaseHTTPMiddleware` ではなく、素の ASGI で書く。
"""

import logging
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.logging_setup import request_id_var

logger = logging.getLogger("app.request")

# フロントの配信（静的ファイル）は、記録しない。API だけを記録する
_LOGGED_PREFIX = "/api/"
_MAX_PATH_LENGTH = 200


class RequestLogMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # 手元で作る。クライアントが送ってきた値は、ログの偽造に使われうるので、信用しない
        request_id = uuid.uuid4().hex[:8]
        # リクエストごとの task の中で動くので、終わったあとに戻さなくてよい。むしろ、戻さない
        # ことで、外側（ServerErrorMiddleware）が、想定外の例外を記録するときも、同じ ID が付く
        request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500  # 応答を始める前に失敗したとき（想定外の例外）の値

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
                headers: list[tuple[bytes, bytes]] = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            path = str(scope["path"])
            if path.startswith(_LOGGED_PREFIX):
                logger.info(
                    "request method=%s path=%s status=%d duration_ms=%d",
                    scope["method"],
                    path[:_MAX_PATH_LENGTH],
                    status,
                    int((time.perf_counter() - started) * 1000),
                )
