from fastapi import APIRouter, Response

from app.api.deps import ServicesDep
from app.api.schemas import ConditionSetInput, ConditionSetsResponse
from app.domain.models import ConditionSet

router = APIRouter(prefix="/api/condition-sets")

# ファイルの読み書きは同期処理なので、`def` で定義する（FastAPI がスレッドプールで実行する）


@router.get("")
def list_condition_sets(services: ServicesDep) -> ConditionSetsResponse:
    return ConditionSetsResponse(sets=services.condition_set_store.list_sets())


@router.post("", status_code=201)
def create_condition_set(body: ConditionSetInput, services: ServicesDep) -> ConditionSet:
    return services.condition_set_store.create(body.name, body.conditions)


@router.put("/{set_id}")
def update_condition_set(
    set_id: str, body: ConditionSetInput, services: ServicesDep
) -> ConditionSet:
    return services.condition_set_store.update(set_id, body.name, body.conditions)


@router.delete("/{set_id}", status_code=204)
def delete_condition_set(set_id: str, services: ServicesDep) -> Response:
    services.condition_set_store.delete(set_id)
    return Response(status_code=204)
