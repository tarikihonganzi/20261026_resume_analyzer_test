"""建築業界向けのプリセット条件（仕様 11 章）。`data/catalog.json` に定義する。"""

import functools
import json
from importlib import resources
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models import ConditionKind


class CatalogItem(BaseModel):
    """プリセットの 1 件。必須かどうか・最低値は、利用者が条件を選ぶときに決めるので持たない。"""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    kind: ConditionKind
    unit: str | None
    category: str = Field(min_length=1)


class _CatalogFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    items: list[CatalogItem]


@functools.cache
def _load() -> tuple[CatalogItem, ...]:
    raw = resources.files("app.data").joinpath("catalog.json").read_text(encoding="utf-8")
    return tuple(_CatalogFile.model_validate(json.loads(raw)).items)


def load_catalog() -> list[CatalogItem]:
    """プリセットの一覧を、仕様書に書かれた順に返す。"""
    return list(_load())
