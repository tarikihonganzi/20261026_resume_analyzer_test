"""API の入出力の型。OpenAPI に出て、フロントの型の元になる（`npm run gen-types`）。"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.catalog import CatalogItem
from app.domain.models import Condition, ConditionSet, Config, ConfigUpdate
from app.domain.results import EvaluationResult


class ErrorResponse(BaseModel):
    """HTTP エラー、および SSE の `error` イベントの内容。`message` は、表示できる日本語。"""

    code: str
    message: str
    fields: list[str] | None = None


class StreamError(BaseModel):
    """SSE の `error` イベント。ストリームが始まったあとの失敗（LLM のエラーなど）。"""

    code: str
    message: str


class StageData(BaseModel):
    """SSE の `stage` イベント。画面の進捗表示に使う。"""

    stage: Literal["extracting", "scoring"]


class CatalogResponse(BaseModel):
    items: list[CatalogItem]


class ConditionSetsResponse(BaseModel):
    sets: list[ConditionSet]


class ConditionSetInput(BaseModel):
    """条件セットの保存・上書きの入力。名前の検査は、保存時（`ConditionSet`）に行う。"""

    model_config = ConfigDict(extra="forbid")

    name: str
    conditions: list[Condition]


class SettingsView(BaseModel):
    """設定ページに出す項目。API キーは、全文を返さずマスクした値だけ（仕様 10）。"""

    openai_api_key_masked: str
    openai_base_url: str
    model: str
    max_file_size_mb: int

    @classmethod
    def from_config(cls, config: Config, masked_key: str) -> SettingsView:
        return cls(
            openai_api_key_masked=masked_key,
            openai_base_url=config.openai_base_url,
            model=config.model,
            max_file_size_mb=config.max_file_size_mb,
        )


class SettingsUpdate(BaseModel):
    """設定ページからの更新。指定した項目だけを変える。API キーは、変更するときだけ送る。

    `pdf_detail` と `request_timeout_sec` は、設定ページに出さない（ファイルを直接編集する）。
    """

    model_config = ConfigDict(extra="forbid")

    openai_api_key: str | None = Field(default=None, repr=False)
    openai_base_url: str | None = None
    model: str | None = None
    max_file_size_mb: int | None = None

    def to_config_update(self) -> ConfigUpdate:
        return ConfigUpdate.model_validate(self.model_dump())


class ConnectionTestRequest(BaseModel):
    """接続テスト。保存前の値を使う。空・未指定の項目は、保存済みの値を使う。"""

    model_config = ConfigDict(extra="forbid")

    openai_api_key: str | None = Field(default=None, repr=False)
    openai_base_url: str | None = None
    model: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None


class ConnectionTestResponse(BaseModel):
    ok: bool
    message: str


class StageEventData(BaseModel):
    """SSE の 1 件のイベント（`stage`）。フロントの型の元になる（OpenAPI に含める）。"""

    event: Literal["stage"]
    data: StageData


class ResultEventData(BaseModel):
    event: Literal["result"]
    data: EvaluationResult


class ErrorEventData(BaseModel):
    event: Literal["error"]
    data: StreamError
