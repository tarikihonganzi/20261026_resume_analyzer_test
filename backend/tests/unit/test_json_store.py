import json
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from app.domain.errors import StorageCorruptedError, StorageError
from app.storage import json_store
from app.storage.json_store import read_json, write_json


def test_roundtrip_keeps_japanese_text_as_utf8(tmp_path: Path) -> None:
    path = tmp_path / "data.json"

    write_json(path, {"name": "1級建築施工管理技士", "years": 2.5, "tags": ["資格", "必須"]})

    assert read_json(path) == {
        "name": "1級建築施工管理技士",
        "years": 2.5,
        "tags": ["資格", "必須"],
    }
    raw = path.read_bytes()
    assert "1級建築施工管理技士".encode() in raw  # \uXXXX にエスケープしない
    assert b"\r" not in raw  # Windows でも LF
    assert raw.endswith(b"\n")


def test_missing_file_reads_as_none(tmp_path: Path) -> None:
    assert read_json(tmp_path / "none.json") is None


def test_parent_directories_are_created(tmp_path: Path) -> None:
    path = tmp_path / "data" / "nested" / "data.json"

    write_json(path, {"a": 1})

    assert read_json(path) == {"a": 1}


def test_write_replaces_existing_content(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    write_json(path, {"a": 1, "b": 2})

    write_json(path, {"a": 3})

    assert read_json(path) == {"a": 3}


def test_no_temporary_files_are_left_behind(tmp_path: Path) -> None:
    path = tmp_path / "data.json"

    write_json(path, {"a": 1})
    write_json(path, {"a": 2})

    assert [p.name for p in tmp_path.iterdir()] == ["data.json"]


def test_corrupted_json_is_an_error_without_leaking_content(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_text('{"openai_api_key": "sk-secret-value", ', encoding="utf-8")

    with pytest.raises(StorageCorruptedError) as excinfo:
        read_json(path)

    assert "sk-secret-value" not in str(excinfo.value)
    assert "data.json" in str(excinfo.value)


def test_invalid_utf8_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_bytes(b"\xff\xfe\x00broken")

    with pytest.raises(StorageCorruptedError):
        read_json(path)


def test_empty_file_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_text("", encoding="utf-8")

    with pytest.raises(StorageCorruptedError):
        read_json(path)


def test_failed_serialization_keeps_the_existing_file_and_leaves_no_temp(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    write_json(path, {"a": 1})

    with pytest.raises(TypeError):
        write_json(path, {"a": object()})

    assert read_json(path) == {"a": 1}
    assert [p.name for p in tmp_path.iterdir()] == ["data.json"]


def test_replace_is_retried_when_the_file_is_temporarily_locked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "data.json"
    real_replace = os.replace
    attempts: list[int] = []
    sleeps: list[float] = []

    def flaky_replace(src: Any, dst: Any) -> None:
        attempts.append(1)
        if len(attempts) <= 2:
            raise PermissionError(13, "使用中です")
        real_replace(src, dst)

    monkeypatch.setattr(json_store.os, "replace", flaky_replace)
    monkeypatch.setattr(json_store.time, "sleep", sleeps.append)

    write_json(path, {"a": 1})

    assert read_json(path) == {"a": 1}
    assert len(attempts) == 3
    assert len(sleeps) == 2


def test_replace_that_keeps_failing_is_an_error_and_keeps_the_original(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "data.json"
    write_json(path, {"a": 1})

    def locked_replace(src: Any, dst: Any) -> None:
        raise PermissionError(13, "使用中です")

    monkeypatch.setattr(json_store.os, "replace", locked_replace)

    def no_sleep(seconds: float) -> None:
        return None

    monkeypatch.setattr(json_store.time, "sleep", no_sleep)

    with pytest.raises(StorageError):
        write_json(path, {"a": 2})

    monkeypatch.undo()
    assert read_json(path) == {"a": 1}
    assert [p.name for p in tmp_path.iterdir()] == ["data.json"]


def test_write_succeeds_after_another_handle_releases_the_file(tmp_path: Path) -> None:
    # Windows では、開いているファイルへの os.replace が失敗する。少し待てば成功する
    path = tmp_path / "data.json"
    write_json(path, {"a": 1})
    holder = path.open("rb")
    timer = threading.Timer(0.2, holder.close)
    timer.start()
    try:
        write_json(path, {"a": 2})
    finally:
        timer.join()
        holder.close()

    assert read_json(path) == {"a": 2}


def test_private_file_is_restricted_before_any_data_is_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "config.json"
    seen: list[tuple[str, int]] = []

    def spy(target: Path) -> None:
        seen.append((target.name, target.stat().st_size))

    monkeypatch.setattr(json_store, "restrict_to_owner", spy)

    write_json(path, {"openai_api_key": "sk-secret"}, private=True)

    # 制限した時点では、一時ファイルはまだ空（秘密が緩い権限のファイルに存在しない）
    assert len(seen) == 1
    assert seen[0][0] != "config.json"
    assert seen[0][1] == 0
    assert json.loads(path.read_text(encoding="utf-8")) == {"openai_api_key": "sk-secret"}


def test_non_private_file_is_not_restricted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Path] = []
    monkeypatch.setattr(json_store, "restrict_to_owner", calls.append)

    write_json(tmp_path / "data.json", {"a": 1})

    assert calls == []


def test_failure_to_restrict_aborts_the_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "config.json"

    def failing(target: Path) -> None:
        raise StorageError("権限を制限できません")

    monkeypatch.setattr(json_store, "restrict_to_owner", failing)

    with pytest.raises(StorageError):
        write_json(path, {"openai_api_key": "sk-secret"}, private=True)

    assert list(tmp_path.iterdir()) == []


def test_private_file_has_owner_only_access(
    tmp_path: Path, assert_owner_only: Callable[[Path], None]
) -> None:
    path = tmp_path / "config.json"
    write_json(path, {"openai_api_key": "sk-secret"}, private=True)
    write_json(path, {"openai_api_key": "sk-other"}, private=True)  # 上書きしても維持される

    assert_owner_only(path)
