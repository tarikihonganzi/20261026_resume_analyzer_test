"""JSON ファイルの読み書き。書き込みは、一時ファイルへ書いてから置き換える（仕様 8.1）。"""

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from app.domain.errors import StorageCorruptedError, StorageError
from app.storage.permissions import restrict_to_owner

# Windows では、開いているファイル（ウイルス対策ソフトやエディターが読んでいる最中など）への
# os.replace が PermissionError で失敗することがある。短く待って繰り返す
_REPLACE_ATTEMPTS = 10
_REPLACE_DELAY_SEC = 0.05


def read_json(path: Path) -> Any:
    """JSON を読む。ファイルがなければ None。壊れていればエラー（内容はメッセージに入れない）。"""
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return None
    except OSError as e:
        raise StorageError(f"{path.name} を読み込めません") from e

    try:
        # メモ帳などで保存された BOM つきのファイルも読めるようにする
        return json.loads(raw.decode("utf-8-sig"))
    except UnicodeDecodeError, json.JSONDecodeError:
        # 元の例外は、内容の一部を含みうるので連鎖させない
        raise StorageCorruptedError(f"{path.name} の内容が壊れています") from None


def _replace_with_retry(source: Path, destination: Path) -> None:
    for attempt in range(_REPLACE_ATTEMPTS):
        try:
            os.replace(source, destination)
            return
        except PermissionError as e:
            if attempt == _REPLACE_ATTEMPTS - 1:
                raise StorageError(
                    f"{destination.name} を書き込めません（他のプログラムが使用中かもしれません）"
                ) from e
            time.sleep(_REPLACE_DELAY_SEC)


def write_json(path: Path, data: Any, *, private: bool = False) -> None:
    """JSON を原子的に書く。途中で失敗しても、元のファイルは壊れない。

    `private=True` のときは、所有者のみがアクセスできるようにする。アクセス権は、中身を書く前に
    一時ファイルへ設定する（置き換え後も、一時ファイルのアクセス権が引き継がれる）。
    """
    # 先にシリアライズする。失敗してもファイルシステムに何も残さない
    payload = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as file:
            if private:
                restrict_to_owner(temp)
            file.write(payload)
            file.flush()
            os.fsync(file.fileno())
        _replace_with_retry(temp, path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
