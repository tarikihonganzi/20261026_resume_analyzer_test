"""プリセット（catalog.json）の検査。仕様書 11 章の表と一致することを確認する。"""

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.catalog import CatalogItem, load_catalog

SPEC_PATH = Path(__file__).resolve().parents[3] / "docs" / "spec.md"
CATEGORIES = ["資格", "スキル・ツール", "経験・実績"]


def spec_presets() -> list[tuple[str, str, str, str | None]]:
    """仕様書 11 章の表から、(カテゴリ, ラベル, 型, 単位) を、書かれた順に取り出す。"""
    text = SPEC_PATH.read_text(encoding="utf-8")
    section = text.split("## 11. 建築業界向けプリセット")[1].split("## 12.")[0]
    presets: list[tuple[str, str, str, str | None]] = []
    category = ""
    for line in section.splitlines():
        if line.startswith("### "):
            category = line.removeprefix("### ").strip()
            continue
        row = re.fullmatch(r"\|\s*(.+?)\s*\|\s*(B|N（(.+?)）)\s*\|", line)
        if row and row.group(1) != "条件":
            kind = "boolean" if row.group(2) == "B" else "number"
            presets.append((category, row.group(1), kind, row.group(3)))
    return presets


def test_catalog_matches_the_spec_tables_in_order() -> None:
    expected = spec_presets()

    actual = [(i.category, i.label, i.kind, i.unit) for i in load_catalog()]

    assert len(expected) == 39
    assert actual == expected


def test_every_item_has_a_unique_ascii_id() -> None:
    ids = [i.id for i in load_catalog()]

    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", i) for i in ids)


def test_categories_appear_in_the_order_of_the_spec() -> None:
    seen: list[str] = []
    for item in load_catalog():
        if item.category not in seen:
            seen.append(item.category)

    assert seen == CATEGORIES


def test_number_items_have_the_year_unit_and_boolean_items_have_none() -> None:
    for item in load_catalog():
        assert (item.unit == "年") if item.kind == "number" else (item.unit is None)


def test_loading_twice_gives_equal_results() -> None:
    assert load_catalog() == load_catalog()


@pytest.mark.parametrize(
    "overrides",
    [{"id": ""}, {"label": ""}, {"kind": "text"}, {"category": ""}, {"extra": 1}],
)
def test_invalid_item_is_rejected(overrides: dict[str, object]) -> None:
    base: dict[str, object] = {
        "id": "x",
        "label": "ラベル",
        "kind": "boolean",
        "unit": None,
        "category": "資格",
    }

    with pytest.raises(ValidationError):
        CatalogItem.model_validate(base | overrides)
