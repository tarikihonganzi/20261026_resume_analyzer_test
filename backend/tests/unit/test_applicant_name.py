"""応募者の氏名の整形（LLM が返した値を、画面に出せる形にする）。"""

import pytest

from app.domain.applicant import MAX_NAME_LENGTH, normalize_applicant_name


def test_none_stays_none() -> None:
    assert normalize_applicant_name(None) is None


@pytest.mark.parametrize("blank", ["", " ", "　", "\n", " \t\n "])
def test_a_blank_name_is_none(blank: str) -> None:
    assert normalize_applicant_name(blank) is None


def test_surrounding_whitespace_is_removed() -> None:
    assert normalize_applicant_name("  架空 太郎 \n") == "架空 太郎"


def test_runs_of_whitespace_including_full_width_and_line_breaks_become_one_space() -> None:
    assert normalize_applicant_name("架空　　太郎") == "架空 太郎"
    assert normalize_applicant_name("架空\n太郎") == "架空 太郎"


def test_a_name_without_a_space_is_kept_as_is() -> None:
    assert normalize_applicant_name("架空太郎") == "架空太郎"


def test_a_too_long_value_is_not_a_name() -> None:
    # 文章などを、氏名として受け取ってしまったときに、画面に出さない
    assert normalize_applicant_name("あ" * MAX_NAME_LENGTH) == "あ" * MAX_NAME_LENGTH
    assert normalize_applicant_name("あ" * (MAX_NAME_LENGTH + 1)) is None
