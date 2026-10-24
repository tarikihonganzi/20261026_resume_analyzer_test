"""評価の流れ（仕様 5.4）。抽出 → 検証 → 判定 → 最終評価 → 補正 → 引用の照合。

HTTP を知らない。進捗と結果を、イベントの非同期ジェネレーターとして返す。切断（キャンセル）されると
`CancelledError` が届き、実行中の LLM 呼び出しも中止される。
"""

import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.domain.clipping import clip_score
from app.domain.errors import ExtractionInconsistentError, LlmError, NoConditionsError
from app.domain.judging import find_extraction_problems, judge, match_rate, missing_required
from app.domain.models import Condition, Judgement
from app.domain.quotes import QuoteVerification, verify
from app.domain.results import (
    EvaluationPoint,
    EvaluationResult,
    JudgedCondition,
    MissingRequired,
    VerifiedQuote,
)
from app.ingest.resume import ResumeInput
from app.llm.client import LlmClient
from app.llm.prompts import neutralize_resume_text
from app.llm.requests import EvaluateRequest, ExtractRequest
from app.llm.schemas import ConditionExtraction, EvaluatedPoint, ExtractionResult, Quote

logger = logging.getLogger("app.pipeline")

# 抽出結果が不整合のとき、再実行する回数（仕様 5.4 ステップ 1: 1 回だけ）
_EXTRACTION_RETRIES = 1


@dataclass(frozen=True)
class StageEvent:
    """処理の段階。画面の進捗表示に使う。"""

    stage: Literal["extracting", "scoring"]


@dataclass(frozen=True)
class ResultEvent:
    result: EvaluationResult


@dataclass(frozen=True)
class ErrorEvent:
    """ストリームが始まったあとの失敗。`message` は、利用者にそのまま表示できる日本語。"""

    code: str
    message: str


PipelineEvent = StageEvent | ResultEvent | ErrorEvent


async def _extract(
    client: LlmClient, resume: ResumeInput, conditions: Sequence[Condition], today: date
) -> dict[str, ConditionExtraction]:
    """抽出し、条件と整合しなければ、1 回だけ再実行する。条件の id で引ける形で返す。"""
    request = ExtractRequest(resume=resume, today=today, conditions=conditions)
    for attempt in range(_EXTRACTION_RETRIES + 1):
        result: ExtractionResult = await client.extract(request)
        problems = find_extraction_problems(conditions, result.results)
        if not problems:
            return {e.condition_id: e for e in result.results}
        # 問題の分類だけをログに出す（条件や職歴書の内容は出さない）
        logger.warning("extraction inconsistent attempt=%d problems=%s", attempt + 1, problems)
    raise ExtractionInconsistentError


def _verify(quote_text: str, resume: ResumeInput) -> QuoteVerification:
    """原文と照合する。原文に見つからなければ、LLM に渡した変換後の文字列とも照合する。"""
    verdict = verify(quote_text, resume.text)
    if verdict == "not_found" and resume.text is not None:
        return verify(quote_text, neutralize_resume_text(resume.text))
    return verdict


def _verified_quotes(quotes: Sequence[Quote], resume: ResumeInput) -> list[VerifiedQuote]:
    """出典名を、与えた名前に置き換え、原文と照合する（テキストがない PDF は未照合）。"""
    return [
        VerifiedQuote(
            source_name=resume.source_name,
            location=q.location,
            text=q.text,
            verified=_verify(q.text, resume),
        )
        for q in quotes
    ]


def _point(point: EvaluatedPoint, resume: ResumeInput) -> EvaluationPoint:
    return EvaluationPoint(
        text=point.text, reason=point.reason, quotes=_verified_quotes(point.quotes, resume)
    )


def _judged_conditions(
    conditions: Sequence[Condition],
    judgements: Sequence[Judgement],
    extractions: dict[str, ConditionExtraction],
    resume: ResumeInput,
) -> list[JudgedCondition]:
    judged: list[JudgedCondition] = []
    for condition, judgement in zip(conditions, judgements, strict=True):
        extraction = extractions[condition.id]
        judged.append(
            JudgedCondition(
                condition=condition,
                status=judgement.status,
                has_skill=extraction.has_skill,
                years=extraction.years,
                reason=extraction.reason,
                quotes=_verified_quotes(extraction.quotes, resume),
            )
        )
    return judged


async def run(
    *,
    resume: ResumeInput,
    conditions: Sequence[Condition],
    client: LlmClient,
    today: date,
) -> AsyncIterator[PipelineEvent]:
    """評価を実行し、`StageEvent` → `StageEvent` → `ResultEvent` の順に返す。

    LLM のエラーと、抽出結果の不整合は、`ErrorEvent` にして返し、そこで終わる。条件が 0 件のときと、
    予期しない例外は、そのまま送出する（API が、ストリームの開始前の HTTP エラーなどにする）。
    """
    if not conditions:
        raise NoConditionsError("評価する条件がありません")

    try:
        yield StageEvent("extracting")
        extractions = await _extract(client, resume, conditions, today)

        judgements = judge(conditions, list(extractions.values()))
        rate = match_rate(judgements)
        missing = missing_required(conditions, judgements)
        status_by_id = {j.condition_id: j.status for j in judgements}

        yield StageEvent("scoring")
        evaluation = await client.evaluate(
            EvaluateRequest(
                resume=resume,
                today=today,
                conditions=conditions,
                extractions=[extractions[c.id] for c in conditions],
                judgements=judgements,
                match_rate=rate,
                missing_required=missing,
            )
        )
    except (LlmError, ExtractionInconsistentError) as e:
        yield ErrorEvent(code=e.code, message=str(e))
        return

    clipped = clip_score(evaluation.score, rate)
    yield ResultEvent(
        EvaluationResult(
            score=clipped.score,
            original_score=clipped.original_score,
            clipped=clipped.clipped,
            match_rate=rate,
            missing_required=[
                MissingRequired(
                    condition_id=c.id,
                    label=c.label,
                    status="unknown" if status_by_id[c.id] == "unknown" else "unmet",
                )
                for c in missing
            ],
            conditions=_judged_conditions(conditions, judgements, extractions, resume),
            summary=_point(evaluation.summary, resume),
            strengths=[_point(p, resume) for p in evaluation.strengths],
            weaknesses=[_point(p, resume) for p in evaluation.weaknesses],
        )
    )
