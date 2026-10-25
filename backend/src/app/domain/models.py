"""ドメインの型。外部（LLM・HTTP・ファイル・時刻）に依存しない。"""

from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

DESCRIPTION_MAX_LENGTH = 500
# 前後の空白を除く。空なら、補足説明なし（None）として扱う
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=DESCRIPTION_MAX_LENGTH)
]

ConditionKind = Literal["boolean", "number"]
ConditionSource = Literal["preset", "custom"]
JudgementStatus = Literal["achieved", "unmet", "unknown"]


class Condition(BaseModel):
    """評価の条件（仕様 5.1、8.1）。`data/condition_sets.json` の要素と同じ形。"""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    kind: ConditionKind
    required: bool
    # number 型のみ。小数可（半年は 0.5）。NaN と無限大は比較が成り立たないので受け付けない
    min_value: float | None = Field(allow_inf_nan=False)
    unit: str | None
    source: ConditionSource
    category: str | None
    # 何をこの条件として数えるかの、補足説明（任意）。LLM の判定の基準になる（仕様 5.1）。
    # 省略できる（補足説明を持たない保存ファイルも読める）
    description: Description | None = None

    @field_validator("description", mode="after")
    @classmethod
    def _blank_description_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _check_min_value_matches_kind(self) -> Self:
        if self.kind == "boolean":
            if self.min_value is not None:
                raise ValueError("boolean の条件に最低値は指定できません")
        elif self.min_value is None or self.min_value < 0:
            raise ValueError("number の条件には 0 以上の最低値が必要です")
        return self


class Judgement(BaseModel):
    """条件ごとの判定。

    `unknown` は判断不能で、マッチ度合いの計算では未達として数える（仕様 5.4）。
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    condition_id: str = Field(min_length=1)
    status: JudgementStatus


class ConditionSet(BaseModel):
    """保存された条件セット（仕様 5.2、8.1）。"""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(min_length=1)
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    conditions: list[Condition]
    created_at: AwareDatetime
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def _check_condition_ids_are_unique(self) -> Self:
        ids = [c.id for c in self.conditions]
        if len(ids) != len(set(ids)):
            raise ValueError("条件の id が重複しています")
        return self


# 社内の Responses API の宛先とモデル。設定ファイルと環境変数のどちらにも値がないときに使う
DEFAULT_BASE_URL = "https://kjm-kong.kajima.co.jp/openai/v1"
DEFAULT_MODEL = "response-standard"

PdfDetail = Literal["auto", "low", "high"]
_Text = Annotated[str, StringConstraints(strip_whitespace=True)]


class Config(BaseModel):
    """設定（仕様 8.1 の `data/config.json`）。ファイルにない項目は既定値で補う。"""

    model_config = ConfigDict(frozen=True, extra="ignore")

    # repr に出さない（ログやエラーメッセージに全文が出ないようにする）
    openai_api_key: str = Field(default="", repr=False)
    openai_base_url: str = DEFAULT_BASE_URL
    model: str = Field(default=DEFAULT_MODEL, min_length=1)
    # 0 は無制限
    max_file_size_mb: int = Field(default=0, ge=0)
    pdf_detail: PdfDetail = "high"
    request_timeout_sec: int = Field(default=180, gt=0)


class ConfigUpdate(BaseModel):
    """設定ページからの更新。指定した項目だけを変える。

    `openai_api_key` は、None または空のときは既存の値を残す（画面には全文を返さないため、
    変更するときだけ送られる）。
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    openai_api_key: _Text | None = Field(default=None, repr=False)
    openai_base_url: _Text | None = None
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    max_file_size_mb: int | None = Field(default=None, ge=0)
    pdf_detail: PdfDetail | None = None
    request_timeout_sec: int | None = Field(default=None, gt=0)
