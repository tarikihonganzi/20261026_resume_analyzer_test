"""ドメインの型。外部（LLM・HTTP・ファイル・時刻）に依存しない。"""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
