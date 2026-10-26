"""評価の結果（仕様 7 の `result` イベントの内容）。`api/` がそのまま JSON にして返す。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.domain.models import Condition, JudgementStatus
from app.domain.quotes import QuoteVerification


class VerifiedQuote(BaseModel):
    """根拠の引用と、原文との照合の結果（仕様 5.4 共通ルール）。"""

    model_config = ConfigDict(frozen=True)

    source_name: str
    location: str | None
    text: str
    verified: QuoteVerification


class JudgedCondition(BaseModel):
    """条件ごとの判定。抽出した値と、その根拠を含む。"""

    model_config = ConfigDict(frozen=True)

    condition: Condition
    status: JudgementStatus
    has_skill: bool | None
    years: float | None
    reason: str
    quotes: list[VerifiedQuote]


class MissingRequired(BaseModel):
    """達成していない必須条件。`unknown` は、職歴書から判断できなかったもの。"""

    model_config = ConfigDict(frozen=True)

    condition_id: str
    label: str
    status: Literal["unmet", "unknown"]


class EvaluationPoint(BaseModel):
    """最終評価の 1 項目（概要・良かった点・懸念点）。`text` は Markdown。"""

    model_config = ConfigDict(frozen=True)

    text: str
    reason: str
    quotes: list[VerifiedQuote]


class EvaluationResult(BaseModel):
    """評価の結果。`score` は補正後で、`original_score` が LLM の元のスコア。"""

    model_config = ConfigDict(frozen=True)

    # 応募者の氏名。書類から読み取れなかったときは None（最終評価には渡さない）
    applicant_name: str | None
    score: int
    original_score: int
    clipped: bool
    match_rate: int
    missing_required: list[MissingRequired]
    conditions: list[JudgedCondition]
    summary: EvaluationPoint
    strengths: list[EvaluationPoint]
    weaknesses: list[EvaluationPoint]
