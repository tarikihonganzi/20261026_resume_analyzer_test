import unicodedata

from app.domain.quotes import normalize, verify

# --- normalize ---


def test_normalize_converts_full_width_to_half_width() -> None:
    assert normalize("１級　ＲＥＶＩＴ（ｒｅｖｉｔ）") == "1級REVIT(revit)"


def test_normalize_removes_all_kinds_of_whitespace() -> None:
    assert normalize(" 現場 \t監督\r\n経験\n\n 5年　以上 ") == "現場監督経験5年以上"


def test_normalize_removes_markdown_symbols() -> None:
    assert normalize("| **1級** | `施工` | > # 管理 |") == "1級施工管理"


def test_normalize_composes_decomposed_characters() -> None:
    decomposed = unicodedata.normalize("NFD", "ガス")
    assert decomposed != "ガス"

    assert normalize(decomposed) == "ガス"


def test_normalize_keeps_letter_case_and_other_punctuation() -> None:
    assert normalize("Revit 2024 - BIM、施工") == "Revit2024-BIM、施工"


def test_normalize_of_only_whitespace_and_symbols_is_empty() -> None:
    assert normalize(" \n | ** # ") == ""


# --- verify ---


def test_exact_substring_matches() -> None:
    source = "資格\n1級建築施工管理技士 取得（2018年）\n"

    assert verify("1級建築施工管理技士 取得（2018年）", source) == "match"


def test_difference_in_width_and_spaces_still_matches() -> None:
    source = "資格: 1級建築施工管理技士 取得(2018年)"

    assert verify("１級建築施工管理技士　取得（２０１８年）", source) == "match"


def test_quote_spanning_a_line_break_matches() -> None:
    source = "2015年4月〜2020年3月\n株式会社○○ 現場監督"

    assert verify("2015年4月〜2020年3月 株式会社○○", source) == "match"


def test_quote_spanning_table_cells_matches() -> None:
    source = "| 期間 | 会社 | 役割 |\n|---|---|---|\n| 2015〜2020 | 株式会社○○ | 現場監督 |"

    assert verify("2015〜2020 株式会社○○ 現場監督", source) == "match"


def test_quote_of_bold_text_matches_source_with_markdown() -> None:
    assert verify("1級建築施工管理技士", "- **1級建築施工管理技士** 取得") == "match"


def test_quote_with_markdown_matches_plain_source() -> None:
    assert verify("**1級建築施工管理技士**", "1級建築施工管理技士 取得") == "match"


def test_decomposed_source_matches_composed_quote() -> None:
    source = unicodedata.normalize("NFD", "ガス主任技術者")

    assert verify("ガス主任技術者", source) == "match"


def test_missing_quote_is_not_found() -> None:
    assert verify("Revit 実務 3年", "AutoCAD を使用した設計経験 5年") == "not_found"


def test_paraphrased_quote_is_not_found() -> None:
    assert verify("施工管理の資格を持つ", "1級建築施工管理技士 取得") == "not_found"


def test_quote_joined_with_ellipsis_is_not_found() -> None:
    # 離れた箇所を「…」でつなぐ引用は、原文にないので照合できない（仕様 5.4）
    source = "1級建築施工管理技士 取得。\n別の段落。\n現場監督 5年"

    assert verify("1級建築施工管理技士 取得…現場監督 5年", source) == "not_found"


def test_quote_that_is_empty_after_normalization_is_not_found() -> None:
    # 空文字は任意の原文の部分文字列になるが、引用としては何も示していない
    assert verify(" | ** ", "1級建築施工管理技士") == "not_found"
    assert verify("", "1級建築施工管理技士") == "not_found"


def test_empty_source_text_is_not_found() -> None:
    assert verify("1級建築施工管理技士", "") == "not_found"


def test_no_source_text_is_skipped() -> None:
    # PDF は手元にテキストがないので、照合しない
    assert verify("1級建築施工管理技士", None) == "skipped"


def test_no_source_text_is_skipped_even_for_an_empty_quote() -> None:
    assert verify("", None) == "skipped"


def test_a_standalone_dakuten_matches_the_composed_character_in_the_source() -> None:
    # 単独の濁点（゛ U+309B）は、NFKC で「空白 + 結合濁点」になる。空白を除いたあと、結合濁点が
    # 取り残されると、原文の「が」と一致しない（性質テストで見つかった不具合）
    assert normalize("か゛") == normalize("が") == "が"
    assert verify("か゛", "経歴: が 取得") == "match"


def test_normalize_is_idempotent_for_the_cedilla_case() -> None:
    once = normalize("R¸")

    assert normalize(once) == once
