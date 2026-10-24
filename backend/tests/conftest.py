import os
import re
import subprocess
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, Literal

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import AppSettings


def _windows_acl_entries(path: Path) -> list[str]:
    """`icacls` の出力から、ACE（アクセス許可の項目）の部分だけを取り出す。"""
    result = subprocess.run(
        ["icacls", str(path)], capture_output=True, text=True, check=True, encoding="mbcs"
    )
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    # 最初の行は「パス + 最初の ACE」。最後の行は処理結果の要約
    first = lines[0].removeprefix(str(path)).strip()
    return [first, *(line.strip() for line in lines[1:-1])]


def _assert_owner_only(path: Path) -> None:
    if sys.platform == "win32":
        entries = _windows_acl_entries(path)
        assert len(entries) == 1, f"ACE が 1 件ではありません: {entries}"
        assert not re.search(r"\(I\)", entries[0]), f"継承された ACE が残っています: {entries}"
        # 許可されているのは、現在のユーザーだけ
        principal = entries[0].rsplit(":(", 1)[0]
        current_user = f"{os.environ['USERDOMAIN']}\\{os.environ['USERNAME']}"
        assert principal.lower() == current_user.lower()
    else:
        assert path.stat().st_mode & 0o777 == 0o600


@pytest.fixture
def assert_owner_only() -> Callable[[Path], None]:
    """ファイルが所有者のみにアクセスを許可していることを検査する。"""
    return _assert_owner_only


@pytest.fixture
def make_app(tmp_path: Path) -> Callable[..., TestClient]:
    """API のテスト用のクライアントを作る。データは tmp_path に置き、環境変数は空にする。"""

    def build(
        *,
        llm_mode: Literal["real", "fake"] = "fake",
        environ: Mapping[str, str] | None = None,
        data_dir: Path | None = None,
        **options: Any,
    ) -> TestClient:
        settings = AppSettings(data_dir=data_dir or tmp_path / "data", llm_mode=llm_mode)
        app = create_app(settings, environ={} if environ is None else environ, **options)
        # Host の検査（localhost・127.0.0.1 のみ）を通る名前で呼ぶ
        return TestClient(app, base_url="http://127.0.0.1")

    return build
