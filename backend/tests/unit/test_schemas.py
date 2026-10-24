"""LLM 出力スキーマの検査。

OpenAI の Structured Output（strict）が受け付ける形かどうかと、仕様書 5.4 章との一致を確認する。
"""

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from openai import pydantic_function_tool
from pydantic import BaseModel

from app.llm.schemas import (
    ConditionExtraction,
    EvaluatedPoint,
    ExtractionResult,
    FinalEvaluation,
    Quote,
)

SPEC_PATH = Path(__file__).resolve().parents[3] / "docs" / "spec.md"

SCHEMA_MODELS: list[type[BaseModel]] = [
    Quote,
    ConditionExtraction,
    ExtractionResult,
    EvaluatedPoint,
    FinalEvaluation,
]
ROOT_MODELS: list[type[BaseModel]] = [ExtractionResult, FinalEvaluation]

# OpenAI の Structured Output が対応するキーワード。これ以外が出たら、対応が不明なので失敗させる
SUPPORTED_KEYWORDS = {
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "description",
    "title",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "anyOf",
    "$ref",
    "$defs",
}
MAX_DEPTH = 10


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """SDK が strict 変換したあとの JSON Schema を返す。"""
    parameters = pydantic_function_tool(model)["function"].get("parameters")
    assert parameters is not None
    return dict(parameters)


def walk(node: dict[str, Any], depth: int = 0) -> Iterator[tuple[dict[str, Any], int]]:
    """スキーマの各ノードを、オブジェクトの入れ子の深さつきでたどる。"""
    yield node, depth
    child_depth = depth + 1 if node.get("type") == "object" else depth
    children: list[dict[str, Any]] = []
    for key in ("properties", "$defs"):
        named: dict[str, dict[str, Any]] = node.get(key) or {}
        children.extend(named.values())
    if "items" in node:
        children.append(node["items"])
    any_of: list[dict[str, Any]] = node.get("anyOf") or []
    children.extend(any_of)
    for child in children:
        yield from walk(child, child_depth)


@pytest.mark.parametrize("model", ROOT_MODELS, ids=lambda m: m.__name__)
def test_root_is_an_object_without_any_of(model: type[BaseModel]) -> None:
    schema = strict_schema(model)

    assert schema["type"] == "object"
    assert "anyOf" not in schema


@pytest.mark.parametrize("model", ROOT_MODELS, ids=lambda m: m.__name__)
def test_every_object_requires_all_fields_and_forbids_extras(model: type[BaseModel]) -> None:
    schema = strict_schema(model)

    objects = [node for node, _ in walk(schema) if node.get("type") == "object"]
    assert objects
    for node in objects:
        assert node["additionalProperties"] is False
        assert set(node["required"]) == set(node["properties"])


@pytest.mark.parametrize("model", ROOT_MODELS, ids=lambda m: m.__name__)
def test_only_supported_keywords_are_used(model: type[BaseModel]) -> None:
    schema = strict_schema(model)

    used = {key for node, _ in walk(schema) for key in node}
    assert used <= SUPPORTED_KEYWORDS, used - SUPPORTED_KEYWORDS


def max_object_depth(schema: dict[str, Any]) -> int:
    """`$ref` を使われている位置で解決し、オブジェクトの入れ子の深さ（ルートが 1）を数える。"""
    definitions: dict[str, dict[str, Any]] = schema.get("$defs") or {}

    def depth_of(node: dict[str, Any], depth: int) -> int:
        if "$ref" in node:
            return depth_of(definitions[node["$ref"].rsplit("/", 1)[-1]], depth)
        own = depth + 1 if node.get("type") == "object" else depth
        children: list[dict[str, Any]] = []
        properties: dict[str, dict[str, Any]] = node.get("properties") or {}
        children.extend(properties.values())
        if "items" in node:
            children.append(node["items"])
        any_of: list[dict[str, Any]] = node.get("anyOf") or []
        children.extend(any_of)
        return max([own, *(depth_of(child, own) for child in children)])

    return depth_of({key: value for key, value in schema.items() if key != "$defs"}, 0)


def chained_schema(levels: int) -> dict[str, Any]:
    """`levels` 階層のオブジェクトを、`$ref` でつないだスキーマ。"""
    definitions: dict[str, Any] = {}
    for level in range(2, levels + 1):
        child: dict[str, Any] = (
            {"type": "object", "properties": {"next": {"$ref": f"#/$defs/L{level + 1}"}}}
            if level < levels
            else {"type": "object", "properties": {}}
        )
        definitions[f"L{level}"] = child
    root: dict[str, Any] = {"type": "object", "properties": {"next": {"$ref": "#/$defs/L2"}}}
    if levels == 1:
        root = {"type": "object", "properties": {}}
    return {**root, "$defs": definitions}


@pytest.mark.parametrize("levels", [1, 2, 10, 11, 12])
def test_depth_counter_follows_references(levels: int) -> None:
    # `$defs` をルートの直下として数えると、参照でつないだ深いスキーマが浅く見えてしまう
    assert max_object_depth(chained_schema(levels)) == levels


@pytest.mark.parametrize("model", ROOT_MODELS, ids=lambda m: m.__name__)
def test_nesting_depth_is_within_the_limit(model: type[BaseModel]) -> None:
    assert max_object_depth(strict_schema(model)) <= MAX_DEPTH


@pytest.mark.parametrize("model", SCHEMA_MODELS, ids=lambda m: m.__name__)
def test_every_field_has_a_description(model: type[BaseModel]) -> None:
    for name, field in model.model_fields.items():
        assert field.description, f"{model.__name__}.{name} に description がありません"


def test_score_range_appears_in_json_schema() -> None:
    score = FinalEvaluation.model_json_schema()["properties"]["score"]

    assert score["type"] == "integer"
    assert (score["minimum"], score["maximum"]) == (0, 100)


def test_strengths_and_weaknesses_counts_appear_in_json_schema() -> None:
    properties = FinalEvaluation.model_json_schema()["properties"]

    assert (properties["strengths"]["minItems"], properties["strengths"]["maxItems"]) == (1, 5)
    assert "minItems" not in properties["weaknesses"]
    assert properties["weaknesses"]["maxItems"] == 5


def test_nullable_fields_are_required_unions_with_null() -> None:
    schema = strict_schema(ConditionExtraction)

    assert {"has_skill", "years"} <= set(schema["required"])
    for name in ("has_skill", "years"):
        types = {option.get("type") for option in schema["properties"][name]["anyOf"]}
        assert "null" in types


def test_out_of_range_score_is_rejected() -> None:
    point: dict[str, Any] = {"text": "t", "reason": "r", "quotes": []}
    base: dict[str, Any] = {"summary": point, "strengths": [point], "weaknesses": []}

    FinalEvaluation.model_validate({"score": 100, **base})
    for score in (-1, 101):
        with pytest.raises(ValueError):
            FinalEvaluation.model_validate({"score": score, **base})


def spec_schema_models() -> dict[str, type[BaseModel]]:
    """仕様書 5.4 章の Python のコードブロックを実行し、そこで定義されたモデルを返す。"""
    text = SPEC_PATH.read_text(encoding="utf-8")
    section = text.split("### 5.4 評価処理")[1].split("### 5.5")[0]
    blocks = re.findall(r"```python\n(.*?)```", section, flags=re.DOTALL)
    namespace: dict[str, Any] = {}
    for block in blocks:
        exec(block, namespace)
    return {
        name: value
        for name, value in namespace.items()
        if isinstance(value, type) and issubclass(value, BaseModel) and value is not BaseModel
    }


@pytest.mark.parametrize("model", SCHEMA_MODELS, ids=lambda m: m.__name__)
def test_schema_matches_the_spec(model: type[BaseModel]) -> None:
    """description を含めて、仕様書とコードの JSON Schema が一致する（片方だけの変更を防ぐ）。"""
    spec_models = spec_schema_models()

    assert model.__name__ in spec_models
    assert model.model_json_schema() == spec_models[model.__name__].model_json_schema()


def test_spec_defines_exactly_the_models_in_code() -> None:
    assert set(spec_schema_models()) == {model.__name__ for model in SCHEMA_MODELS}
