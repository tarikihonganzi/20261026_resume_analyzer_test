import pytest
from pydantic import ValidationError

from app.domain.models import Condition, Judgement


def make_condition(**overrides: object) -> Condition:
    base: dict[str, object] = {
        "id": "qual-1kyu-sekou",
        "label": "1級建築施工管理技士",
        "kind": "boolean",
        "required": True,
        "min_value": None,
        "unit": None,
        "source": "preset",
        "category": "資格",
    }
    return Condition.model_validate(base | overrides)


def test_boolean_condition_has_no_min_value() -> None:
    condition = make_condition()

    assert condition.kind == "boolean"
    assert condition.min_value is None


def test_number_condition_accepts_fractional_min_value() -> None:
    condition = make_condition(kind="number", min_value=2.5, unit="年")

    assert condition.min_value == 2.5


def test_number_condition_accepts_zero_min_value() -> None:
    assert make_condition(kind="number", min_value=0).min_value == 0


@pytest.mark.parametrize("min_value", [None, -0.5, float("nan"), float("inf")])
def test_number_condition_rejects_invalid_min_value(min_value: float | None) -> None:
    with pytest.raises(ValidationError):
        make_condition(kind="number", min_value=min_value)


def test_boolean_condition_rejects_min_value() -> None:
    with pytest.raises(ValidationError):
        make_condition(kind="boolean", min_value=3)


@pytest.mark.parametrize("field", ["id", "label"])
def test_condition_rejects_empty_text(field: str) -> None:
    with pytest.raises(ValidationError):
        make_condition(**{field: ""})


@pytest.mark.parametrize(("field", "value"), [("kind", "text"), ("source", "other")])
def test_condition_rejects_unknown_choice(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        make_condition(**{field: value})


def test_condition_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        make_condition(weight=2)


def test_condition_is_immutable() -> None:
    condition = make_condition()

    with pytest.raises(ValidationError):
        condition.required = False


@pytest.mark.parametrize("status", ["achieved", "unmet", "unknown"])
def test_judgement_accepts_each_status(status: str) -> None:
    judgement = Judgement.model_validate({"condition_id": "c1", "status": status})

    assert judgement.status == status


def test_judgement_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        Judgement.model_validate({"condition_id": "c1", "status": "partial"})


# --- 補足説明（仕様 5.1・13.1 #27） ---


def test_description_is_optional_and_defaults_to_none() -> None:
    assert make_condition().description is None


def test_description_is_kept_and_trimmed() -> None:
    condition = make_condition(description="  検査への立会い・試験の記録を数える。\n")

    assert condition.description == "検査への立会い・試験の記録を数える。"


@pytest.mark.parametrize("blank", ["", "   ", "\n\t "])
def test_blank_description_means_no_description(blank: str) -> None:
    assert make_condition(description=blank).description is None


def test_description_of_500_characters_is_accepted_and_501_is_rejected() -> None:
    assert make_condition(description="あ" * 500).description == "あ" * 500
    with pytest.raises(ValidationError):
        make_condition(description="あ" * 501)


def test_condition_saved_without_a_description_can_still_be_read() -> None:
    legacy = {
        "id": "a",
        "label": "A",
        "kind": "boolean",
        "required": True,
        "min_value": None,
        "unit": None,
        "source": "custom",
        "category": None,
    }

    assert Condition.model_validate(legacy).description is None
