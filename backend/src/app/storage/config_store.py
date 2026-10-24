"""設定（`data/config.json`）の読み書き（仕様 8.1）。"""

import threading
from pathlib import Path

from pydantic import ValidationError

from app.domain.errors import StorageCorruptedError
from app.domain.models import Config, ConfigUpdate
from app.storage.json_store import read_json, write_json

# これより短いキーは、末尾 4 文字でも大半が分かってしまうので、一切見せない
_MIN_LENGTH_TO_SHOW_SUFFIX = 12
_MASK = "****"


def mask_api_key(api_key: str) -> str:
    """画面に返すための値にする。未設定なら空、設定済みなら末尾 4 文字だけを見せる。"""
    if not api_key:
        return ""
    if len(api_key) < _MIN_LENGTH_TO_SHOW_SUFFIX:
        return _MASK
    return _MASK + api_key[-4:]


class ConfigStore:
    """設定は評価のたびに読み直す（ファイルが小さいため。設定ページの変更が次の評価から反映される）。"""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()

    def load(self) -> Config:
        """ファイルがなければ既定値。壊れている・値が不正なときはエラー。"""
        raw = read_json(self._path)
        if raw is None:
            return Config()
        try:
            return Config.model_validate(raw)
        except ValidationError:
            # 検証エラーの詳細には入力値（API キーなど）が含まれうるので、連鎖させない
            raise StorageCorruptedError(f"{self._path.name} の内容が正しくありません") from None

    def save(self, config: Config) -> None:
        with self._lock:
            write_json(self._path, config.model_dump(), private=True)

    def update(self, update: ConfigUpdate) -> Config:
        """指定された項目だけを変えて保存する。API キーは、空・未指定なら既存の値を残す。"""
        with self._lock:
            current = self.load()
            changes = update.model_dump(exclude_none=True)
            if not changes.get("openai_api_key"):
                changes.pop("openai_api_key", None)
            updated = Config.model_validate(current.model_dump() | changes)
            write_json(self._path, updated.model_dump(), private=True)
            return updated
