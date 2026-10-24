"""条件セット（`data/condition_sets.json`）の読み書き（仕様 5.2、8.1）。"""

import threading
import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from app.domain.errors import ConditionSetNotFoundError, StorageCorruptedError
from app.domain.models import Condition, ConditionSet
from app.storage.json_store import read_json, write_json


class _File(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    sets: list[ConditionSet]


def _now() -> datetime:
    return datetime.now().astimezone()


class ConditionSetStore:
    def __init__(self, path: Path, now: Callable[[], datetime] = _now) -> None:
        self._path = path
        self._now = now
        # 読み込み → 変更 → 書き込みの途中に、別のリクエスト（スレッド）が割り込まないようにする
        self._lock = threading.Lock()

    def _load(self) -> list[ConditionSet]:
        raw = read_json(self._path)
        if raw is None:
            return []
        try:
            return _File.model_validate(raw).sets
        except ValidationError:
            raise StorageCorruptedError(
                f"{self._path.name} の形式が正しくないか、未対応の版です"
            ) from None

    def _save(self, sets: Sequence[ConditionSet]) -> None:
        file = _File(version=1, sets=list(sets))
        write_json(self._path, file.model_dump(mode="json"))

    def list_sets(self) -> list[ConditionSet]:
        with self._lock:
            return self._load()

    def get(self, set_id: str) -> ConditionSet:
        for condition_set in self.list_sets():
            if condition_set.id == set_id:
                return condition_set
        raise ConditionSetNotFoundError("条件セットが見つかりません")

    def create(self, name: str, conditions: Sequence[Condition]) -> ConditionSet:
        with self._lock:
            sets = self._load()
            now = self._now()
            created = ConditionSet(
                id=uuid.uuid4().hex,
                name=name,
                conditions=list(conditions),
                created_at=now,
                updated_at=now,
            )
            self._save([*sets, created])
            return created

    def update(self, set_id: str, name: str, conditions: Sequence[Condition]) -> ConditionSet:
        """上書き保存。id と作成日時は変えない。一覧での位置も変わらない。"""
        with self._lock:
            sets = self._load()
            for index, existing in enumerate(sets):
                if existing.id == set_id:
                    updated = ConditionSet(
                        id=existing.id,
                        name=name,
                        conditions=list(conditions),
                        created_at=existing.created_at,
                        updated_at=self._now(),
                    )
                    sets[index] = updated
                    self._save(sets)
                    return updated
        raise ConditionSetNotFoundError("条件セットが見つかりません")

    def delete(self, set_id: str) -> None:
        with self._lock:
            sets = self._load()
            remaining = [s for s in sets if s.id != set_id]
            if len(remaining) == len(sets):
                raise ConditionSetNotFoundError("条件セットが見つかりません")
            self._save(remaining)
