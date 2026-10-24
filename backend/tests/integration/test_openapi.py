"""OpenAPI の内容と、フロントの型の元になるファイルが最新であることの検査。"""

from pathlib import Path
from typing import Any

import pytest

from app.export_openapi import build_spec, render

OPENAPI_PATH = Path(__file__).resolve().parents[3] / "frontend" / "src" / "api" / "openapi.json"


@pytest.fixture(scope="module")
def spec() -> dict[str, Any]:
    return build_spec()


def test_event_payload_types_are_in_the_schema(spec: dict[str, Any]) -> None:
    schemas = set(spec["components"]["schemas"])

    assert {
        "EvaluationResult",
        "StageData",
        "StreamError",
        "StageEventData",
        "ResultEventData",
        "ErrorEventData",
        "ErrorResponse",
        "Condition",
        "ConditionSet",
        "CatalogItem",
        "SettingsView",
        "ResumeCheck",
    } <= schemas


def test_each_event_type_has_a_fixed_event_name(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]

    assert schemas["StageEventData"]["properties"]["event"]["const"] == "stage"
    assert schemas["ResultEventData"]["properties"]["event"]["const"] == "result"
    assert schemas["ErrorEventData"]["properties"]["event"]["const"] == "error"
    assert schemas["ResultEventData"]["properties"]["data"]["$ref"].endswith("/EvaluationResult")


def test_references_resolve_to_components(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    refs: list[str] = []

    def collect(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():  # pyright: ignore[reportUnknownVariableType]
                if key == "$ref" and isinstance(value, str):
                    refs.append(value)
                else:
                    collect(value)
        elif isinstance(node, list):
            for item in node:  # pyright: ignore[reportUnknownVariableType]
                collect(item)

    collect(spec)

    assert refs
    for ref in refs:
        assert ref.startswith("#/components/schemas/"), ref
        assert ref.rsplit("/", 1)[1] in schemas, ref


def test_error_responses_of_the_stream_endpoint_are_json(spec: dict[str, Any]) -> None:
    responses = spec["paths"]["/api/evaluations"]["post"]["responses"]

    for status in ("413", "422"):
        assert list(responses[status]["content"]) == ["application/json"]
    assert "text/event-stream" in responses["200"]["content"]


def test_all_endpoints_of_the_spec_exist(spec: dict[str, Any]) -> None:
    operations = {
        (method.upper(), path)
        for path, item in spec["paths"].items()
        for method in item
        if method in ("get", "post", "put", "delete")
    }

    assert operations == {
        ("GET", "/api/health"),
        ("GET", "/api/catalog"),
        ("GET", "/api/condition-sets"),
        ("POST", "/api/condition-sets"),
        ("PUT", "/api/condition-sets/{set_id}"),
        ("DELETE", "/api/condition-sets/{set_id}"),
        ("POST", "/api/resumes/check"),
        ("POST", "/api/evaluations"),
        ("GET", "/api/settings"),
        ("PUT", "/api/settings"),
        ("POST", "/api/settings/test"),
    }


def test_committed_openapi_file_is_up_to_date(spec: dict[str, Any]) -> None:
    """API を変えたら、`npm run gen-types` で、フロントの型の元になるファイルを作り直す。"""
    assert OPENAPI_PATH.exists(), "frontend/src/api/openapi.json がありません（npm run gen-types）"

    assert OPENAPI_PATH.read_text(encoding="utf-8") == render(spec), (
        "frontend/src/api/openapi.json が古い。npm run gen-types を実行してください"
    )


def test_validation_errors_are_documented_as_the_error_response_for_every_endpoint(
    spec: dict[str, Any],
) -> None:
    # 実際には、共通のハンドラーが ErrorResponse（code・message・fields）で返す（PR#17・#22）
    found = 0
    for item in spec["paths"].values():
        for method, operation in item.items():
            if method not in ("get", "post", "put", "delete"):
                continue
            response = operation["responses"].get("422")
            if response is None:
                continue
            found += 1
            assert response["content"] == {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}
            }
    assert found >= 5


def test_the_default_validation_error_types_are_not_published(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]

    assert "HTTPValidationError" not in schemas
    assert "ValidationError" not in schemas
