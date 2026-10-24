import logging
from collections.abc import Callable, Mapping
from datetime import date

from fastapi import FastAPI

from app.api import catalog, condition_sets, evaluations, health, resumes, settings_api
from app.api.errors import register_exception_handlers
from app.api.openapi import install_openapi
from app.api.security import LocalOnlyMiddleware
from app.domain.models import Config
from app.llm.client import ClosableLlmClient
from app.llm.openai_client import OpenAIClient
from app.services import Services
from app.settings import AppSettings
from app.storage.condition_set_store import ConditionSetStore
from app.storage.config_store import ConfigStore

logger = logging.getLogger("app")


def create_app(
    settings: AppSettings | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    today: Callable[[], date] = date.today,
    openai_factory: Callable[[Config], OpenAIClient] = OpenAIClient,
    client_factory: Callable[[Config], ClosableLlmClient] | None = None,
) -> FastAPI:
    """アプリを作る。`environ` は、設定の初期値（OPENAI_*）の元（既定は実際の環境変数）。"""
    settings = settings or AppSettings.from_env()
    app = FastAPI(title="職歴書マッチング評価")
    app.state.services = Services(
        settings=settings,
        config_store=ConfigStore(settings.data_dir / "config.json", environ=environ),
        condition_set_store=ConditionSetStore(settings.data_dir / "condition_sets.json"),
        today=today,
        openai_factory=openai_factory,
        client_factory=client_factory,
    )
    register_exception_handlers(app)
    install_openapi(app)
    app.add_middleware(LocalOnlyMiddleware, allow_remote=settings.allow_remote)
    if settings.allow_remote:
        logger.warning(
            "デモモード: Host の制限を外しています。同じネットワークの誰でも、このアプリを使えます"
        )
    for router in (
        health.router,
        catalog.router,
        condition_sets.router,
        settings_api.router,
        resumes.router,
        evaluations.router,
    ):
        app.include_router(router)
    return app


app = create_app()
