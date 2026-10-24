"""OpenAPI の補正。フロントの TypeScript の型は、この OpenAPI から生成する（`npm run gen-types`）。

FastAPI の SSE は、イベントの中身（`data`）の型を OpenAPI に出さない。また、エラー応答の
媒体の種類を、ストリームのもの（`text/event-stream`）にしてしまう。次のように補う。
- `EvaluationResult` と、SSE の各イベント（`StageEventData` など）を、スキーマに加える
- `/api/evaluations` の 413・422 を、JSON にする
"""

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from pydantic.json_schema import models_json_schema

from app.api.schemas import ErrorEventData, ResultEventData, StageEventData

_EVENT_MODELS = (StageEventData, ResultEventData, ErrorEventData)
_COMPONENTS = "#/components/schemas/{model}"


def build_openapi(app: FastAPI) -> dict[str, Any]:
    spec = get_openapi(
        title=app.title, version=app.version, routes=app.routes, description=app.description
    )

    _, definitions = models_json_schema(
        [(model, "serialization") for model in _EVENT_MODELS], ref_template=_COMPONENTS
    )
    schemas: dict[str, Any] = spec.setdefault("components", {}).setdefault("schemas", {})
    schemas.update(definitions.get("$defs", {}))

    post = spec["paths"]["/api/evaluations"]["post"]
    for status in ("413", "422"):
        if status in post["responses"]:
            post["responses"][status]["content"] = {
                "application/json": {"schema": {"$ref": _COMPONENTS.format(model="ErrorResponse")}}
            }
    # イベントの種類ごとの型を、200 の説明に添える（ドキュメントの読み手のため）
    post["responses"]["200"]["content"]["text/event-stream"]["x-event-schemas"] = [
        {"$ref": _COMPONENTS.format(model=model.__name__)} for model in _EVENT_MODELS
    ]
    return spec


def install_openapi(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = build_openapi(app)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]
