"""API のファズ（スキーマ駆動のテスト。T-M9-13）。

OpenAPI から、多数の入力（境界の値・不正な形・変な文字）を自動で作って、全エンドポイントに送り、
次を確かめる: サーバーのエラー（5xx）にならない／応答が、OpenAPI に書いた形に合っている。
例を挙げるテストでは、思いつかない入力を見つけるため。
"""

# schemathesis の型情報が不完全なため、このファイルだけ、型検査を標準の厳しさにする
# pyright: basic

import os
import tempfile
from pathlib import Path

import schemathesis
from hypothesis import HealthCheck, settings
from schemathesis.checks import not_a_server_error
from schemathesis.specs.openapi.checks import (
    content_type_conformance,
    response_schema_conformance,
    status_code_conformance,
)

from app.main import create_app
from app.settings import AppSettings

# データは、テストごとの一時フォルダ。偽の LLM で動かす（API の費用はかからない）
_data_dir = Path(tempfile.mkdtemp(prefix="app-fuzz-"))
app = create_app(AppSettings(data_dir=_data_dir, llm_mode="fake"), environ={})

# Host の検査（127.0.0.1・localhost のみ）を通る名前で呼ぶ
HOST = {"Host": "127.0.0.1"}
schema = schemathesis.openapi.from_asgi("/openapi.json", app, headers=HOST)


@schema.parametrize()
@settings(
    max_examples=int(os.environ.get("FUZZ_EXAMPLES", "60")),
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
def test_no_endpoint_fails_with_a_server_error_or_a_wrong_shape(case: schemathesis.Case) -> None:
    case.call_and_validate(
        headers=HOST,
        checks=[
            not_a_server_error,
            response_schema_conformance,
            status_code_conformance,
            content_type_conformance,
        ],
    )
