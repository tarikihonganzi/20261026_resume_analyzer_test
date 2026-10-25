import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from app.domain.errors import StorageError
from app.storage import permissions
from app.storage.permissions import restrict_to_owner


@pytest.mark.skipif(sys.platform != "win32", reason="Windows の ACL")
def test_windows_acl_is_limited_to_the_current_user(
    tmp_path: Path, assert_owner_only: Callable[[Path], None]
) -> None:
    target = tmp_path / "config.json"
    target.write_text("{}", encoding="utf-8")

    restrict_to_owner(target)

    assert_owner_only(target)
    # 制限したあとも、自分は読み書きできる
    target.write_text('{"a": 1}', encoding="utf-8")
    assert target.read_text(encoding="utf-8") == '{"a": 1}'


@pytest.mark.skipif(sys.platform != "win32", reason="Windows の ACL")
def test_windows_acl_survives_replacing_another_file(
    tmp_path: Path, assert_owner_only: Callable[[Path], None]
) -> None:
    # 一時ファイルに設定した ACL が、os.replace のあとも置き換え先に残る（原子的な書き込みの前提）
    temp = tmp_path / "temp.json"
    destination = tmp_path / "config.json"
    destination.write_text("old", encoding="utf-8")
    temp.write_text("new", encoding="utf-8")
    restrict_to_owner(temp)

    os.replace(temp, destination)

    assert destination.read_text(encoding="utf-8") == "new"
    assert_owner_only(destination)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows の ACL")
def test_windows_failure_of_icacls_is_an_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "config.json"
    target.write_text("{}", encoding="utf-8")

    def failing_run(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args, 5, stdout="", stderr="アクセスが拒否されました")

    # SID の取得は成功させ、icacls が失敗する経路を確かめる
    monkeypatch.setattr(permissions, "current_user_sid", lambda: "S-1-5-21-1-2-3-1001")
    monkeypatch.setattr(permissions.subprocess, "run", failing_run)

    with pytest.raises(StorageError):
        restrict_to_owner(target)


@pytest.mark.skipif(sys.platform != "win32", reason="Windows の ACL")
def test_windows_failure_to_find_the_user_is_an_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "config.json"
    target.write_text("{}", encoding="utf-8")

    def failing_run(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args, 1, stdout="", stderr="")

    monkeypatch.setattr(permissions.subprocess, "run", failing_run)
    permissions.current_user_sid.cache_clear()

    with pytest.raises(StorageError):
        restrict_to_owner(target)
    permissions.current_user_sid.cache_clear()


def test_non_windows_uses_the_posix_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "config.json"
    target.write_text("{}", encoding="utf-8")
    calls: list[Path] = []
    monkeypatch.setattr(permissions, "_is_windows", lambda: False)
    monkeypatch.setattr(permissions, "_restrict_posix", calls.append)

    restrict_to_owner(target)

    assert calls == [target]


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX のファイルモード")
def test_posix_mode_is_0600(tmp_path: Path) -> None:
    target = tmp_path / "config.json"
    target.write_text("{}", encoding="utf-8")
    target.chmod(0o644)

    restrict_to_owner(target)

    assert target.stat().st_mode & 0o777 == 0o600


def test_posix_restriction_sets_owner_only_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Windows では実際の権限を確かめられないので、呼び出しの内容を確かめる（POSIX の分岐）
    calls: list[tuple[Path, int]] = []

    def fake_chmod(path: str | os.PathLike[str], mode: int) -> None:
        calls.append((Path(path), mode))

    monkeypatch.setattr(os, "chmod", fake_chmod)

    permissions._restrict_posix(tmp_path / "config.json")  # pyright: ignore[reportPrivateUsage]

    assert calls == [(tmp_path / "config.json", 0o600)]
