"""最終スコアの補正（仕様 5.4 ステップ 3）。"""

from typing import NamedTuple

# 最終スコアがマッチ度合いから離れてよい最大の点数
MAX_DEVIATION = 20


class ClippedScore(NamedTuple):
    score: int
    original_score: int
    clipped: bool


def clip_score(score: int, rate: int) -> ClippedScore:
    """最終スコアを、マッチ度合い ± 20 点（0〜100 の範囲内）に収める。

    補正した場合は `clipped` が True になり、`original_score` に LLM の元のスコアが残る。
    """
    if not 0 <= rate <= 100:
        raise ValueError("マッチ度合いは 0〜100 の範囲で指定してください")

    low = max(rate - MAX_DEVIATION, 0)
    high = min(rate + MAX_DEVIATION, 100)
    clipped_score = min(max(score, low), high)
    return ClippedScore(score=clipped_score, original_score=score, clipped=clipped_score != score)
