import os
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import pytest


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
