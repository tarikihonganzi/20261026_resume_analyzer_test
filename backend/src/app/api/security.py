"""ローカル API の保護（仕様 10）。

`Host` を `localhost`／`127.0.0.1` に限定し（DNS リバインディングの対策）、状態を変える
リクエスト（GET・HEAD・OPTIONS 以外）では、`Origin` が自分自身であることを確認する（他のサイトからの
送信の防止）。CORS は有効にしない。

ストリーミング（SSE）の応答を壊さないよう、`BaseHTTPMiddleware` ではなく、素の ASGI で書く。
"""

import json

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

_ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost"})
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _hostname(host_header: str) -> str:
    """`Host` ヘッダーから、ポートを除いたホスト名を取り出す（小文字）。"""
    host = host_header.strip().lower()
    if host.startswith("["):  # IPv6。サーバーは IPv4 だけで待ち受けるので、許可しない
        return host
    return host.rsplit(":", 1)[0] if ":" in host else host


class LocalOnlyMiddleware:
    """`allow_remote=True`（デモモード）のときだけ、`Host` の制限を外す。`Origin` の確認は残す。"""

    def __init__(self, app: ASGIApp, *, allow_remote: bool = False) -> None:
        self.app = app
        self._allow_remote = allow_remote

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        host = headers.get("host", "")
        if not self._allow_remote and _hostname(host) not in _ALLOWED_HOSTS:
            await self._reject(send, 400, "invalid_host", "このアドレスからは利用できません。")
            return

        origin = headers.get("origin")
        if origin is not None and scope["method"] not in _SAFE_METHODS:
            own_origin = f"{scope['scheme']}://{host.strip()}".lower()
            if origin.strip().lower() != own_origin:
                await self._reject(
                    send, 403, "invalid_origin", "他のサイトからのリクエストは受け付けません。"
                )
                return

        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(send: Send, status: int, code: str, message: str) -> None:
        body = json.dumps({"code": code, "message": message}, ensure_ascii=False).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
