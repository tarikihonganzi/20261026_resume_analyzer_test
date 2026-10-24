from fastapi import APIRouter

from app.api.deps import ServicesDep
from app.api.schemas import (
    ConnectionTestRequest,
    ConnectionTestResponse,
    SettingsUpdate,
    SettingsView,
)
from app.domain.errors import LlmError
from app.domain.models import Config
from app.storage.config_store import mask_api_key

router = APIRouter(prefix="/api/settings")


def _view(config: Config) -> SettingsView:
    return SettingsView.from_config(config, mask_api_key(config.openai_api_key))


@router.get("")
def get_settings(services: ServicesDep) -> SettingsView:
    return _view(services.config_store.load())


@router.put("")
def update_settings(body: SettingsUpdate, services: ServicesDep) -> SettingsView:
    """指定された項目だけを更新する。次の評価から反映される（評価のたびに設定を読み直す）。"""
    return _view(services.config_store.update(body.to_config_update()))


@router.post("/test")
async def test_connection(
    body: ConnectionTestRequest, services: ServicesDep
) -> ConnectionTestResponse:
    """保存前の値で、軽量なリクエストを 1 回送る。空・未指定の項目は、保存済みの値を使う。"""
    saved = services.config_store.load()
    changes: dict[str, str] = {}
    if body.openai_api_key and body.openai_api_key.strip():
        changes["openai_api_key"] = body.openai_api_key.strip()
    if body.openai_base_url is not None:
        changes["openai_base_url"] = body.openai_base_url.strip()
    if body.model:
        changes["model"] = body.model
    config = Config.model_validate(saved.model_dump() | changes)

    try:
        await services.check_connection(config)
    except LlmError as e:
        return ConnectionTestResponse(ok=False, message=str(e))
    return ConnectionTestResponse(ok=True, message="接続できました。")
