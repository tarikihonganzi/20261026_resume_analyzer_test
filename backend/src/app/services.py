"""API が使う部品（ストア、LLM クライアントの作り方、今日の日付）をまとめる。"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from app.domain.errors import LlmAuthError
from app.domain.models import Config
from app.llm.client import ClosableLlmClient
from app.llm.fake_client import FakeClient
from app.llm.openai_client import OpenAIClient
from app.settings import AppSettings
from app.storage.condition_set_store import ConditionSetStore
from app.storage.config_store import ConfigStore

# 偽の LLM のモード（E2E 用）で、この文字で始まる API キーは、接続テストが失敗する
FAKE_BAD_KEY_PREFIX = "bad"


@dataclass
class Services:
    settings: AppSettings
    config_store: ConfigStore
    condition_set_store: ConditionSetStore
    today: Callable[[], date] = date.today
    # テストで、HTTP を差し替えた OpenAIClient を使えるようにする
    openai_factory: Callable[[Config], OpenAIClient] = OpenAIClient

    def make_client(self, config: Config) -> ClosableLlmClient:
        """評価のたびに作り、終わったら閉じる（設定は評価のたびに読み直すため）。"""
        if self.settings.llm_mode == "fake":
            return FakeClient(delay_sec=self.settings.fake_delay_sec)
        return self.openai_factory(config)

    async def check_connection(self, config: Config) -> None:
        """接続テスト。失敗したら `LlmError`。"""
        if self.settings.llm_mode == "fake":
            if not config.openai_api_key:
                raise LlmAuthError(
                    "API キーが設定されていません。設定ページで API キーを登録してください。"
                )
            if config.openai_api_key.startswith(FAKE_BAD_KEY_PREFIX):
                raise LlmAuthError
            return
        client = self.openai_factory(config)
        try:
            await client.check_connection()
        finally:
            await client.aclose()
