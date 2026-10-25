"""OpenAPI の補正。フロントの TypeScript の型は、この OpenAPI から生成する（`npm run gen-types`）。

FastAPI の SSE は、イベントの中身（`data`）の型を OpenAPI に出さない。また、エラー応答の
媒体の種類を、ストリームのもの（`text/event-stream`）にしてしまう。次のように補う。
- `EvaluationResult` と、SSE の各イベント（`StageEventData` など）を、スキーマに加える
- すべてのエンドポイントの 422 を、実際の応答（`ErrorResponse`）にする
- `/api/evaluations` の 413 を、JSON にする
- 本文を受け取る操作に、400（本文を読み取れない）を、条件セットの更新・削除に、404 を書く
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

    error_body = {
        "application/json": {"schema": {"$ref": _COMPONENTS.format(model="ErrorResponse")}}
    }
    # 検証エラー（422）は、どのエンドポイントも、共通のハンドラー（errors.py）が
    # ErrorResponse で返す。FastAPI が公開する既定の型（HTTPValidationError。`detail`）は、
    # 実際の応答と違うので置き換える
    for path_item in spec["paths"].values():
        for operation in path_item.values():
            responses = operation.get("responses", {})
            if "422" in responses:
                responses["422"] = {"description": "入力が正しくない", "content": error_body}
            # JSON・multipart として読めない本文は、フレームワークが 400 にする（errors.py が、
            # 同じ形に整える）。本文を受け取る操作に、書く
            if "requestBody" in operation:
                responses.setdefault(
                    "400",
                    {"description": "リクエストの本文を読み取れない", "content": error_body},
                )
    for unused in ("HTTPValidationError", "ValidationError"):
        schemas.pop(unused, None)

    # 存在しない条件セットの更新・削除は、404
    for method in ("put", "delete"):
        spec["paths"]["/api/condition-sets/{set_id}"][method]["responses"]["404"] = {
            "description": "条件セットがない",
            "content": error_body,
        }

    post = spec["paths"]["/api/evaluations"]["post"]
    if "413" in post["responses"]:
        post["responses"]["413"]["content"] = error_body
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
