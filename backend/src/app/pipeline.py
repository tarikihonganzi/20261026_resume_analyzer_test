"""評価の流れ（仕様 5.4）。抽出 → 検証 → 判定 → 最終評価 → 補正 → 引用の照合。

HTTP を知らない。進捗と結果を、イベントの非同期ジェネレーターとして返す。切断（キャンセル）されると
`CancelledError` が届き、実行中の LLM 呼び出しも中止される。
"""

import logging
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.domain.applicant import normalize_applicant_name
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


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


async def _extract(
    client: LlmClient, resumes: Sequence[ResumeInput], conditions: Sequence[Condition], today: date
) -> ExtractionResult:
    """抽出し、条件と整合しなければ、1 回だけ再実行する。整合した結果を返す。"""
    request = ExtractRequest(resumes=resumes, today=today, conditions=conditions)
    for attempt in range(_EXTRACTION_RETRIES + 1):
        result: ExtractionResult = await client.extract(request)
        problems = find_extraction_problems(conditions, result.results)
        if not problems:
            return result
        # 問題の分類だけをログに出す（条件や職歴書の内容は出さない）
        logger.warning("extraction inconsistent attempt=%d problems=%s", attempt + 1, problems)
    raise ExtractionInconsistentError


def _verify(quote_text: str, resume: ResumeInput) -> QuoteVerification:
    """原文と照合する。原文に見つからなければ、LLM に渡した変換後の文字列とも照合する。"""
    verdict = verify(quote_text, resume.text)
    if verdict == "not_found" and resume.text is not None:
        return verify(quote_text, neutralize_resume_text(resume.text))
    return verdict


def _resolve_quote(quote: Quote, resumes: Sequence[ResumeInput]) -> tuple[str, QuoteVerification]:
    """引用の出典名と照合結果を決める（仕様 5.4）。

    出典名が与えた書類の名前と一致すれば、その書類で照合する（別の書類にだけ載っている引用は、
    引用元の取り違えなので「確認できず」）。一致しなければ、書類が 1 件ならその書類として、複数なら
    テキストを持つ書類から探す。どこにも見つからないとき、PDF が含まれるなら（PDF の中かもしれ
    ないので）未照合、そうでなければ「確認できず」とし、出典名は LLM が返したままにする。
    """
    for resume in resumes:
        if resume.source_name == quote.source_name:
            return resume.source_name, _verify(quote.text, resume)
    if len(resumes) == 1:
        only = resumes[0]
        return only.source_name, _verify(quote.text, only)
    for resume in resumes:
        if resume.text is not None and _verify(quote.text, resume) == "match":
            return resume.source_name, "match"
    has_pdf = any(resume.pdf is not None for resume in resumes)
    return quote.source_name, "skipped" if has_pdf else "not_found"


def _verified_quotes(
    quotes: Sequence[Quote], resumes: Sequence[ResumeInput]
) -> list[VerifiedQuote]:
    """出典名を、与えた書類の名前にそろえ、引用元の書類の原文と照合する。"""
    verified: list[VerifiedQuote] = []
    for q in quotes:
        source_name, verdict = _resolve_quote(q, resumes)
        verified.append(
            VerifiedQuote(
                source_name=source_name, location=q.location, text=q.text, verified=verdict
            )
        )
    return verified


def _point(point: EvaluatedPoint, resumes: Sequence[ResumeInput]) -> EvaluationPoint:
    """最終評価の 1 項目（概要・良かった点・懸念点）の引用に、原文との照合結果を付ける。"""
    return EvaluationPoint(
        text=point.text, reason=point.reason, quotes=_verified_quotes(point.quotes, resumes)
    )


def _judged_conditions(
    conditions: Sequence[Condition],
    judgements: Sequence[Judgement],
    extractions: dict[str, ConditionExtraction],
    resumes: Sequence[ResumeInput],
) -> list[JudgedCondition]:
    """条件ごとの判定（コードが決めた達成・未達・不明）に、LLM が抽出した値と根拠を合わせる。"""
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
                quotes=_verified_quotes(extraction.quotes, resumes),
            )
        )
    return judged


async def run(
    *,
    resumes: Sequence[ResumeInput],
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

    # ログには、件数・段階・所要時間だけを残す。書類の名前・内容、条件の名前は、残さない（仕様 8.3）
    logger.info("evaluation start documents=%d conditions=%d", len(resumes), len(conditions))
    started = time.perf_counter()

    try:
        # ステップ 1（LLM）: 条件ごとの有無・年数と根拠を抽出する
        yield StageEvent("extracting")
        extracted = await _extract(client, resumes, conditions, today)
        extractions = {e.condition_id: e for e in extracted.results}
        logger.info("stage=extracting done duration_ms=%d", _elapsed_ms(started))

        # ステップ 2（コード）: 達成・未達・不明、マッチ度合い、未達の必須条件を決める
        # （LLM は使わない）
        judgements = judge(conditions, list(extractions.values()))
        rate = match_rate(judgements)
        missing = missing_required(conditions, judgements)
        status_by_id = {j.condition_id: j.status for j in judgements}

        # ステップ 3（LLM）: 判定結果とマッチ度合いを渡し、最終スコアと評価文を作らせる
        yield StageEvent("scoring")
        scoring_started = time.perf_counter()
        evaluation = await client.evaluate(
            EvaluateRequest(
                resumes=resumes,
                today=today,
                conditions=conditions,
                extractions=[extractions[c.id] for c in conditions],
                judgements=judgements,
                match_rate=rate,
                missing_required=missing,
            )
        )
        logger.info("stage=scoring done duration_ms=%d", _elapsed_ms(scoring_started))
    except (LlmError, ExtractionInconsistentError) as e:
        logger.warning("evaluation failed code=%s", e.code)
        yield ErrorEvent(code=e.code, message=str(e))
        return

    # ステップ 4（コード）: 最終スコアをマッチ度合い ± 20 点に収める。
    # 引用の照合は、下の結果の組み立てで行う
    clipped = clip_score(evaluation.score, rate)
    logger.info(
        "evaluation done score=%d match_rate=%d clipped=%s missing_required=%d duration_ms=%d",
        clipped.score,
        rate,
        clipped.clipped,
        len(missing),
        _elapsed_ms(started),
    )
    yield ResultEvent(
        EvaluationResult(
            # 氏名は、画面に出すためだけに使う。最終評価の LLM には渡さず、ログにも出さない
            applicant_name=normalize_applicant_name(extracted.applicant_name),
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
            conditions=_judged_conditions(conditions, judgements, extractions, resumes),
            summary=_point(evaluation.summary, resumes),
            strengths=[_point(p, resumes) for p in evaluation.strengths],
            weaknesses=[_point(p, resumes) for p in evaluation.weaknesses],
        )
    )
