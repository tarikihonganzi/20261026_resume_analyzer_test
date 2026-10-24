import pytest

from app.domain.clipping import MAX_DEVIATION, ClippedScore, clip_score


def test_deviation_is_twenty_points() -> None:
    assert MAX_DEVIATION == 20


@pytest.mark.parametrize(
    ("rate", "score"),
    [
        (50, 50),
        (50, 30),  # 下限ちょうど
        (50, 70),  # 上限ちょうど
        (0, 0),
        (0, 20),
        (100, 100),
        (100, 80),
        (10, 0),  # rate - 20 が負になるので、下限は 0
        (90, 100),  # rate + 20 が 100 を超えるので、上限は 100
    ],
)
def test_score_within_range_is_kept(rate: int, score: int) -> None:
    assert clip_score(score, rate) == ClippedScore(score=score, original_score=score, clipped=False)


@pytest.mark.parametrize(
    ("rate", "score", "expected"),
    [
        (50, 71, 70),
        (50, 29, 30),
        (50, 100, 70),
        (50, 0, 30),
        (0, 21, 20),
        (0, 100, 20),
        (100, 79, 80),
        (100, 0, 80),
        (25, 0, 5),
        (75, 100, 95),
        (10, 31, 30),
        (90, 69, 70),
    ],
)
def test_score_outside_range_is_clipped_and_flagged(rate: int, score: int, expected: int) -> None:
    result = clip_score(score, rate)

    assert result == ClippedScore(score=expected, original_score=score, clipped=True)


@pytest.mark.parametrize("rate", [-1, 101])
def test_rate_outside_0_to_100_is_an_error(rate: int) -> None:
    with pytest.raises(ValueError):
        clip_score(50, rate)
