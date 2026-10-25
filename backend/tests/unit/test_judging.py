from dataclasses import dataclass

import pytest

from app.domain.errors import ConditionMismatchError, NoConditionsError
from app.domain.judging import find_extraction_problems, judge, match_rate, missing_required
from app.domain.models import Condition, Judgement, JudgementStatus
from app.llm.schemas import ConditionExtraction


@dataclass(frozen=True)
class Extracted:
    """ConditionExtraction と同じ属性を持つ、テスト用の抽出結果。"""

    condition_id: str
    has_skill: bool | None = None
    years: float | None = None


def boolean(id: str, *, required: bool = False) -> Condition:
    return Condition(
        id=id,
        label=id,
        kind="boolean",
        required=required,
        min_value=None,
        unit=None,
        source="custom",
        category=None,
    )


def number(id: str, min_value: float, *, required: bool = False) -> Condition:
    return Condition(
        id=id,
        label=id,
        kind="number",
        required=required,
        min_value=min_value,
        unit="年",
        source="custom",
        category=None,
    )


def statuses(judgements: list[Judgement]) -> list[JudgementStatus]:
    return [j.status for j in judgements]


def judgements_of(*items: JudgementStatus) -> list[Judgement]:
    return [Judgement(condition_id=f"c{i}", status=status) for i, status in enumerate(items)]


# --- judge ---


@pytest.mark.parametrize(
    ("has_skill", "expected"),
    [(True, "achieved"), (False, "unmet"), (None, "unknown")],
)
def test_boolean_condition_follows_has_skill(
    has_skill: bool | None, expected: JudgementStatus
) -> None:
    result = judge([boolean("a")], [Extracted("a", has_skill=has_skill)])

    assert statuses(result) == [expected]


@pytest.mark.parametrize(
    ("years", "expected"),
    [
        (5.0, "achieved"),
        (5.5, "achieved"),
        (4.5, "unmet"),
        (0.0, "unmet"),
        (None, "unknown"),
    ],
)
def test_number_condition_compares_years_with_min_value(
    years: float | None, expected: JudgementStatus
) -> None:
    result = judge([number("a", 5)], [Extracted("a", years=years)])

    assert statuses(result) == [expected]


def test_number_condition_with_fractional_min_value() -> None:
    conditions = [number("a", 2.5)]

    assert statuses(judge(conditions, [Extracted("a", years=2.5)])) == ["achieved"]
    assert statuses(judge(conditions, [Extracted("a", years=2.4)])) == ["unmet"]


def test_number_condition_with_zero_min_value_is_achieved_by_any_known_years() -> None:
    conditions = [number("a", 0)]

    assert statuses(judge(conditions, [Extracted("a", years=0.0)])) == ["achieved"]
    assert statuses(judge(conditions, [Extracted("a", years=None)])) == ["unknown"]


def test_judgements_follow_the_order_of_conditions_not_extractions() -> None:
    conditions = [boolean("a"), number("b", 3), boolean("c")]
    extractions = [
        Extracted("c", has_skill=False),
        Extracted("a", has_skill=True),
        Extracted("b", years=3.0),
    ]

    result = judge(conditions, extractions)

    assert [j.condition_id for j in result] == ["a", "b", "c"]
    assert statuses(result) == ["achieved", "achieved", "unmet"]


def test_unused_field_is_ignored() -> None:
    # boolean 条件の years、number 条件の has_skill は判定に使わない
    conditions = [boolean("a"), number("b", 3)]
    extractions = [Extracted("a", has_skill=True, years=0.0), Extracted("b", has_skill=True)]

    assert statuses(judge(conditions, extractions)) == ["achieved", "unknown"]


def test_missing_extraction_is_an_error() -> None:
    with pytest.raises(ConditionMismatchError):
        judge([boolean("a"), boolean("b")], [Extracted("a", has_skill=True)])


def test_duplicate_extraction_is_an_error() -> None:
    extractions = [Extracted("a", has_skill=True), Extracted("a", has_skill=False)]

    with pytest.raises(ConditionMismatchError):
        judge([boolean("a")], extractions)


def test_no_conditions_is_an_error() -> None:
    with pytest.raises(NoConditionsError):
        judge([], [])


def test_judge_accepts_the_llm_extraction_type() -> None:
    extraction = ConditionExtraction(
        condition_id="a", has_skill=None, years=6.0, reason="r", quotes=[]
    )

    assert statuses(judge([number("a", 5)], [extraction])) == ["achieved"]


# --- match_rate ---


@pytest.mark.parametrize(
    ("achieved", "total", "expected"),
    [
        (0, 1, 0),
        (1, 1, 100),
        (0, 5, 0),
        (5, 5, 100),
        (1, 3, 33),  # 33.3
        (2, 3, 67),  # 66.7
        (1, 8, 13),  # 12.5 は切り上げ
        (3, 8, 38),  # 37.5 は切り上げ
        (5, 8, 63),  # 62.5 は切り上げ（Python の round() だと 62 になる）
        (7, 8, 88),  # 87.5 は切り上げ
        (1, 2, 50),
        (1, 6, 17),  # 16.7
        (1, 200, 1),  # 0.5 は切り上げ
    ],
)
def test_match_rate_rounds_half_up(achieved: int, total: int, expected: int) -> None:
    achieved_items: list[JudgementStatus] = ["achieved"] * achieved
    unmet_items: list[JudgementStatus] = ["unmet"] * (total - achieved)

    assert match_rate(judgements_of(*achieved_items, *unmet_items)) == expected


def test_match_rate_counts_unknown_as_unmet() -> None:
    assert match_rate(judgements_of("achieved", "unknown", "unmet", "unknown")) == 25


def test_match_rate_with_no_judgements_is_an_error() -> None:
    with pytest.raises(NoConditionsError):
        match_rate([])


def test_same_extraction_always_gives_the_same_rate() -> None:
    conditions = [boolean("a"), number("b", 3), boolean("c")]
    extractions = [
        Extracted("a", has_skill=True),
        Extracted("b", years=2.0),
        Extracted("c", has_skill=True),
    ]

    rates = {match_rate(judge(conditions, extractions)) for _ in range(5)}

    assert rates == {67}


# --- missing_required ---


def test_missing_required_lists_required_conditions_that_are_not_achieved() -> None:
    conditions = [
        boolean("a", required=True),  # 達成
        boolean("b", required=True),  # 未達
        number("c", 3, required=True),  # 不明
        boolean("d"),  # 任意の未達は含めない
    ]
    judgements = [
        Judgement(condition_id="a", status="achieved"),
        Judgement(condition_id="b", status="unmet"),
        Judgement(condition_id="c", status="unknown"),
        Judgement(condition_id="d", status="unmet"),
    ]

    result = missing_required(conditions, judgements)

    assert [c.id for c in result] == ["b", "c"]


def test_missing_required_is_empty_when_all_required_are_achieved() -> None:
    conditions = [boolean("a", required=True), boolean("b")]
    judgements = [
        Judgement(condition_id="a", status="achieved"),
        Judgement(condition_id="b", status="unmet"),
    ]

    assert missing_required(conditions, judgements) == []


def test_missing_required_without_required_conditions_is_empty() -> None:
    assert missing_required([boolean("a")], judgements_of("unmet")) == []


def test_missing_required_with_duplicate_judgements_is_an_error() -> None:
    # 辞書にまとめると後の判定で上書きされ、並び順だけで必須未達が消えてしまう
    judgements = [
        Judgement(condition_id="a", status="unmet"),
        Judgement(condition_id="a", status="achieved"),
    ]

    with pytest.raises(ConditionMismatchError):
        missing_required([boolean("a", required=True)], judgements)


def test_missing_required_with_a_missing_judgement_is_an_error() -> None:
    with pytest.raises(ConditionMismatchError):
        missing_required([boolean("a", required=True)], [])


# --- find_extraction_problems（仕様 5.4 ステップ 1 の検証） ---


def test_consistent_extraction_has_no_problems() -> None:
    conditions = [boolean("a"), number("b", 3)]
    extractions = [Extracted("a", has_skill=True), Extracted("b", years=2.0)]

    assert find_extraction_problems(conditions, extractions) == []


def test_unknown_values_are_not_problems() -> None:
    # 判断できなかった（has_skill・years が null）のは、不整合ではなく「不明」
    conditions = [boolean("a"), number("b", 3)]
    extractions = [Extracted("a", has_skill=None), Extracted("b", years=None)]

    assert find_extraction_problems(conditions, extractions) == []


def test_extraction_order_does_not_matter() -> None:
    conditions = [boolean("a"), boolean("b")]
    extractions = [Extracted("b", has_skill=True), Extracted("a", has_skill=False)]

    assert find_extraction_problems(conditions, extractions) == []


def test_missing_extraction_is_a_problem() -> None:
    problems = find_extraction_problems(
        [boolean("a"), boolean("b")], [Extracted("a", has_skill=True)]
    )

    assert len(problems) == 1


def test_extra_extraction_is_a_problem() -> None:
    extractions = [Extracted("a", has_skill=True), Extracted("zzz", has_skill=True)]

    assert find_extraction_problems([boolean("a")], extractions)


def test_duplicate_extraction_is_a_problem() -> None:
    extractions = [Extracted("a", has_skill=True), Extracted("a", has_skill=False)]

    assert find_extraction_problems([boolean("a")], extractions)


def test_boolean_condition_with_years_is_a_problem() -> None:
    assert find_extraction_problems([boolean("a")], [Extracted("a", has_skill=True, years=3.0)])


def test_number_condition_with_has_skill_is_a_problem() -> None:
    assert find_extraction_problems([number("a", 3)], [Extracted("a", has_skill=True, years=3.0)])


@pytest.mark.parametrize("years", [-1.0, float("nan"), float("inf"), float("-inf")])
def test_invalid_years_is_a_problem(years: float) -> None:
    # inf は、どの最低年数でも「達成」になってしまう。nan は比較が成り立たない
    assert find_extraction_problems([number("a", 3)], [Extracted("a", years=years)])


def test_zero_and_fractional_years_are_not_problems() -> None:
    conditions = [number("a", 3), number("b", 0)]

    assert (
        find_extraction_problems(
            conditions, [Extracted("a", years=0.0), Extracted("b", years=0.25)]
        )
        == []
    )


def test_two_extractions_for_the_same_condition_are_an_error() -> None:
    # 同じ条件の結果が 2 件あると、どちらを採るかが決まらない。黙って片方を捨てない
    with pytest.raises(ConditionMismatchError):
        judge(
            [boolean("a")],
            [Extracted("a", has_skill=True), Extracted("a", has_skill=False)],
        )


def test_an_extraction_for_a_condition_that_was_not_asked_is_ignored() -> None:
    # 条件にない抽出結果（LLM が余分に返したもの）は、無視する。判定を、狂わせない
    result = judge(
        [boolean("a")],
        [Extracted("a", has_skill=True), Extracted("zzz", has_skill=False)],
    )

    assert [(j.condition_id, j.status) for j in result] == [("a", "achieved")]
