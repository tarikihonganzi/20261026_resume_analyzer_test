"""LLM 呼び出しへの入力。`LlmClient`（client.py）とプロンプトの組み立て（prompts.py）が共有する。"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from app.domain.models import Condition, Judgement
from app.ingest.resume import ResumeInput
from app.llm.schemas import ConditionExtraction


@dataclass(frozen=True)
class ExtractRequest:
    """ステップ 1（条件の抽出）への入力。`resumes` は、同一の応募者の書類（1 件以上）。"""

    resumes: Sequence[ResumeInput]
    today: date
    conditions: Sequence[Condition]


@dataclass(frozen=True)
class EvaluateRequest:
    """ステップ 3（最終評価）への入力。判定とマッチ度合いは、コードが算出した値。"""

    resumes: Sequence[ResumeInput]
    today: date
    conditions: Sequence[Condition]
    extractions: Sequence[ConditionExtraction]
    judgements: Sequence[Judgement]
    match_rate: int
    missing_required: Sequence[Condition]
