"""設定（`data/config.json`）の読み書き（仕様 4.1、8.1）。"""

import os
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.domain.errors import StorageCorruptedError
from app.domain.models import Config, ConfigUpdate
from app.storage.json_store import MISSING, read_json, write_json

# これより短いキーは、末尾 4 文字でも大半が分かってしまうので、一切見せない（仕様 13.1 #23）
_MIN_LENGTH_TO_SHOW_SUFFIX = 12
_MASK = "****"

# 設定ファイルにまだ値がない項目の初期値（仕様 4.1）
_ENVIRONMENT_VARIABLES = {
    "openai_api_key": "OPENAI_API_KEY",
    "openai_base_url": "OPENAI_BASE_URL",
    "model": "OPENAI_MODEL",
}


def mask_api_key(api_key: str) -> str:
    """画面に返すための値にする。未設定なら空、設定済みなら末尾 4 文字だけを見せる。"""
    if not api_key:
        return ""
    if len(api_key) < _MIN_LENGTH_TO_SHOW_SUFFIX:
        return _MASK
    return _MASK + api_key[-4:]


class ConfigStore:
    """設定は評価のたびに読み直す（ファイルが小さいため。設定ページの変更が次の評価から反映される）。

    環境変数（`OPENAI_API_KEY`・`OPENAI_BASE_URL`・`OPENAI_MODEL`）は、ファイルにない項目の
    初期値にだけ使う。保存済みの値は、空文字列でも環境変数より優先する。
    """

    def __init__(self, path: Path, environ: Mapping[str, str] | None = None) -> None:
        self._path = path
        self._environ = os.environ if environ is None else environ
        self._lock = threading.Lock()

    def _environment_defaults(self) -> dict[str, str]:
        defaults: dict[str, str] = {}
        for key, variable in _ENVIRONMENT_VARIABLES.items():
            value = self._environ.get(variable, "").strip()
            if value:
                defaults[key] = value
        return defaults

    def _read_saved(self) -> dict[str, Any]:
        """ファイルに保存されている項目だけを返す。未作成なら空。壊れていればエラー。"""
        raw = read_json(self._path)
        if raw is MISSING:
            return {}
        if not isinstance(raw, dict):
            raise StorageCorruptedError(f"{self._path.name} の内容が正しくありません")
        return {str(key): value for key, value in raw.items()}  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]

    def _validate(self, saved: Mapping[str, Any]) -> Config:
        try:
            return Config.model_validate(self._environment_defaults() | dict(saved))
        except ValidationError:
            # 検証エラーの詳細には入力値（API キーなど）が含まれうるので、連鎖させない
            raise StorageCorruptedError(f"{self._path.name} の内容が正しくありません") from None

    def load(self) -> Config:
        """実際に使う設定を返す。ファイルにない項目は、環境変数、なければ既定値で補う。"""
        return self._validate(self._read_saved())

    def save(self, config: Config) -> None:
        with self._lock:
            write_json(self._path, config.model_dump(), private=True)

    def update(self, update: ConfigUpdate) -> Config:
        """指定された項目だけを変えて保存する。API キーは、空・未指定なら既存の値を残す。

        環境変数から補われた値は、ファイルに書き込まない（保存済みの値になってしまうため）。
        """
        with self._lock:
            saved = self._read_saved()
            self._validate(saved)  # 壊れたファイルを、変更で上書きしない
            changes = update.model_dump(exclude_none=True)
            if not changes.get("openai_api_key"):
                changes.pop("openai_api_key", None)
            saved = saved | changes
            updated = self._validate(saved)
            write_json(self._path, saved, private=True)
            return updated
