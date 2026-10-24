"""プリセット（catalog.json）の検査。仕様書 11 章の表と一致することを確認する。"""

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.catalog import CatalogItem, load_catalog

SPEC_PATH = Path(__file__).resolve().parents[3] / "docs" / "spec.md"
CATEGORIES = [
    "資格・認定",
    "スキル・ツール",
    "施工図・図面",
    "施工管理",
    "現場事務・書類",
    "経験年数",
]


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

    assert len(expected) == 75
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


def test_source_and_test_files_are_not_ignored_by_git() -> None:
    """`.gitignore` の `data/` の指定が、`app/data/` のプリセットまで除外していた（PR#15）。

    除外されたファイルは、手元にあるのでテストが通るのに、クローンした環境では存在しない。
    未追跡のファイル（`--others`）と、追跡済みのファイル（`--cached`）の両方を調べる。
    追跡済みのものを調べないと、`.gitignore` を元に戻しても、このテストが通ってしまう（PR#19）。
    """
    import shutil
    import subprocess

    if shutil.which("git") is None:
        pytest.skip("git がない")
    repository = Path(__file__).resolve().parents[3]

    ignored: list[str] = []
    for scope in ("--others", "--cached"):
        result = subprocess.run(
            [
                "git",
                "ls-files",
                scope,
                "--ignored",
                "--exclude-standard",
                "backend/src",
                "backend/tests",
            ],
            cwd=repository,
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
        )
        if result.returncode != 0:
            pytest.skip("git のリポジトリではない")
        ignored += [
            line
            for line in result.stdout.splitlines()
            if "__pycache__" not in line and not line.startswith("backend/tests/fixtures/out/")
        ]
    assert ignored == []


def test_every_preset_has_a_description_that_defines_what_to_count() -> None:
    """補足説明がないと、「品質管理」のような名前だけでは、LLM の判定がぶれる（仕様 13.1 #27）。"""
    for item in load_catalog():
        assert item.description, f"{item.label} に補足説明がありません"
        assert len(item.description) <= 500
        assert item.description != item.label


def test_ambiguous_presets_say_what_does_not_count() -> None:
    by_label = {item.label: item for item in load_catalog()}

    for label in ("品質管理", "原価管理", "安全管理", "工程管理"):
        description = by_label[label].description or ""
        assert "含めない" in description, f"{label} の補足説明に、数えないものの例がありません"
