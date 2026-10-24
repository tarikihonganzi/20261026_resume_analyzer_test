"""ファイルのアクセス権を、所有者のみに制限する（仕様 8.1）。

POSIX は `chmod 0600`。Windows では `os.chmod` が読み取り専用の属性しか変えられないため
（Python の公式ドキュメント）、`icacls` で継承を外し、現在のユーザーだけに許可する。
"""

import csv
import functools
import io
import os
import re
import subprocess
import sys
from pathlib import Path

from app.domain.errors import StorageError

_SID_PATTERN = re.compile(r"S-1-\d+(?:-\d+)+")


def _is_windows() -> bool:
    return sys.platform == "win32"


def _system32(name: str) -> str:
    # PATH にある同名の実行ファイルを呼ばないよう、完全なパスで指定する
    return str(Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32" / name)


@functools.cache
def current_user_sid() -> str:
    """現在のユーザーの SID を返す。"""
    result = subprocess.run(
        [_system32("whoami.exe"), "/user", "/fo", "csv", "/nh"],
        capture_output=True,
        text=True,
        errors="replace",
        check=False,
    )
    rows: list[list[str]] = list(csv.reader(io.StringIO(result.stdout)))
    sid = rows[0][-1] if rows and rows[0] else ""
    if result.returncode != 0 or not _SID_PATTERN.fullmatch(sid):
        raise StorageError("現在のユーザーを特定できないため、ファイルのアクセス権を制限できません")
    return sid


def _restrict_posix(path: Path) -> None:
    os.chmod(path, 0o600)


def _restrict_windows(path: Path) -> None:
    sid = current_user_sid()
    # M（変更）には削除が含まれる。os.replace で置き換えられるようにするために必要
    result = subprocess.run(
        [_system32("icacls.exe"), str(path), "/inheritancelevel:r", "/grant:r", f"*{sid}:(M)"],
        capture_output=True,
        text=True,
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise StorageError(f"{path.name} のアクセス権を制限できません")


def restrict_to_owner(path: Path) -> None:
    """`path` を、現在のユーザーだけが読み書きできるようにする。失敗したらエラー。"""
    if _is_windows():
        _restrict_windows(path)
    else:
        _restrict_posix(path)
