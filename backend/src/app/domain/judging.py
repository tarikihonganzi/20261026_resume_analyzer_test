"""条件の判定、マッチ度合い、必須未達（仕様 5.4 ステップ 2）。"""

import math
from collections.abc import Sequence
from typing import Protocol

from app.domain.errors import ConditionMismatchError, NoConditionsError
from app.domain.models import Condition, Judgement, JudgementStatus


class Extracted(Protocol):
    """ステップ 1 の抽出結果のうち、判定に使う部分。

    LLM の出力型（`llm.schemas.ConditionExtraction`）に依存しないよう、属性だけを要求する。
    """

    @property
    def condition_id(self) -> str: ...

    @property
    def has_skill(self) -> bool | None: ...

    @property
    def years(self) -> float | None: ...


def _status(condition: Condition, extracted: Extracted) -> JudgementStatus:
    if condition.kind == "boolean":
        if extracted.has_skill is None:
            return "unknown"
        return "achieved" if extracted.has_skill else "unmet"

    # 条件の検証（Condition）で、number には最低値があることが保証されている
    assert condition.min_value is not None
    if extracted.years is None:
        return "unknown"
    return "achieved" if extracted.years >= condition.min_value else "unmet"


def judge(conditions: Sequence[Condition], extractions: Sequence[Extracted]) -> list[Judgement]:
    """条件ごとの達成・未達・不明を、条件の並び順で返す。

    抽出結果の並び順は問わない。条件に対応する抽出結果が 0 件または 2 件以上のときはエラー。
    条件にない抽出結果は無視する（全条件がそろっているかの検査は、呼び出し側で行う）。
    """
    if not conditions:
        raise NoConditionsError("評価する条件がありません")

    condition_ids = {c.id for c in conditions}
    by_id: dict[str, Extracted] = {}
    for extracted in extractions:
        if extracted.condition_id not in condition_ids:
            continue
        if extracted.condition_id in by_id:
            raise ConditionMismatchError("同じ条件の抽出結果が複数あります")
        by_id[extracted.condition_id] = extracted

    judgements: list[Judgement] = []
    for condition in conditions:
        extracted = by_id.get(condition.id)
        if extracted is None:
            raise ConditionMismatchError("条件に対応する抽出結果がありません")
        judgements.append(
            Judgement(condition_id=condition.id, status=_status(condition, extracted))
        )
    return judgements


def match_rate(judgements: Sequence[Judgement]) -> int:
    """達成した条件数 ÷ 全条件数 × 100 を、小数点以下を四捨五入（half-up）した整数で返す。

    Python の `round()` は偶数丸め（62.5 → 62）なので使わず、整数の演算で求める。
    不明は未達として数える。
    """
    total = len(judgements)
    if total == 0:
        raise NoConditionsError("評価する条件がありません")

    achieved = sum(1 for j in judgements if j.status == "achieved")
    # achieved * 100 / total + 1/2 の切り捨て。分母を total * 2 にそろえると整数だけで書ける
    return (achieved * 200 + total) // (total * 2)


def missing_required(
    conditions: Sequence[Condition], judgements: Sequence[Judgement]
) -> list[Condition]:
    """必須条件のうち、達成していない（未達または不明の）ものを、条件の並び順で返す。"""
    status_by_id: dict[str, JudgementStatus] = {}
    for judgement in judgements:
        if judgement.condition_id in status_by_id:
            raise ConditionMismatchError("同じ条件の判定が複数あります")
        status_by_id[judgement.condition_id] = judgement.status

    missing: list[Condition] = []
    for condition in conditions:
        if not condition.required:
            continue
        status = status_by_id.get(condition.id)
        if status is None:
            raise ConditionMismatchError("条件に対応する判定がありません")
        if status != "achieved":
            missing.append(condition)
    return missing


def find_extraction_problems(
    conditions: Sequence[Condition], extractions: Sequence[Extracted]
) -> list[str]:
    """抽出結果の不整合を、条件の id を含めずに、分類した説明で返す。空なら整合している。

    仕様 5.4 ステップ 1: 全条件分がそろっていない、`condition_id` が一致しない、`kind` に対して
    使うフィールドが誤っている（boolean に years、number に has_skill）。抽出できなかった
    （null）ことは不整合ではなく「不明」。並び順は問わない。
    """
    problems: list[str] = []
    expected = {c.id: c for c in conditions}

    seen: set[str] = set()
    for extracted in extractions:
        if extracted.condition_id in seen:
            problems.append("同じ条件の抽出結果が重複している")
        seen.add(extracted.condition_id)
        condition = expected.get(extracted.condition_id)
        if condition is None:
            problems.append("条件にない抽出結果がある")
        elif condition.kind == "boolean" and extracted.years is not None:
            problems.append("boolean の条件に years がある")
        elif condition.kind == "number" and extracted.has_skill is not None:
            problems.append("number の条件に has_skill がある")
        elif (
            condition.kind == "number"
            and extracted.years is not None
            and not (math.isfinite(extracted.years) and extracted.years >= 0)
        ):
            problems.append("years が、有限の 0 以上の値ではない")

    if missing := expected.keys() - seen:
        problems.append(f"{len(missing)} 件の条件の抽出結果がない")
    return problems
