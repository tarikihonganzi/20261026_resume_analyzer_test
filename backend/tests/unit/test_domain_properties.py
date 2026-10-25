"""純粋なロジックの性質テスト（hypothesis）。

例を挙げるテスト（test_judging など）では、書き手が思いつかない入力を試せない。ここでは、
「どんな入力でも成り立つべき性質」を書き、多数の入力で確かめる。
"""

import unicodedata

from hypothesis import assume, given
from hypothesis import strategies as st

from app.domain.clipping import MAX_DEVIATION, clip_score
from app.domain.judging import match_rate
from app.domain.models import Judgement
from app.domain.quotes import normalize, verify
from app.domain.source_name import MAX_LENGTH, make_unique, sanitize

statuses = st.sampled_from(["achieved", "unmet", "unknown"])


def judgements(statuses_: list[str]) -> list[Judgement]:
    return [
        Judgement(condition_id=f"c{i}", status=status)  # pyright: ignore[reportArgumentType]
        for i, status in enumerate(statuses_)
    ]


# --- マッチ度合い ---


@given(st.lists(statuses, min_size=1, max_size=60))
def test_match_rate_is_between_0_and_100_and_matches_the_half_up_ratio(
    values: list[str],
) -> None:
    achieved = values.count("achieved")
    total = len(values)

    rate = match_rate(judgements(values))

    assert 0 <= rate <= 100
    # 四捨五入（half-up）の定義どおり。ちょうど .5 は、切り上げる（偶数丸めにしない）
    assert abs(rate - 100 * achieved / total) <= 0.5 + 1e-9
    if (achieved * 100) % total * 2 == total:
        assert rate == 100 * achieved // total + 1


@given(st.lists(statuses, min_size=1, max_size=40), st.integers(min_value=0, max_value=39))
def test_achieving_one_more_condition_never_lowers_the_match_rate(
    values: list[str], index: int
) -> None:
    index %= len(values)
    improved = [*values[:index], "achieved", *values[index + 1 :]]

    assert match_rate(judgements(improved)) >= match_rate(judgements(values))


@given(st.lists(st.sampled_from(["unmet", "unknown"]), min_size=1, max_size=30))
def test_unknown_counts_the_same_as_unmet(values: list[str]) -> None:
    as_unmet = ["unmet"] * len(values)

    assert match_rate(judgements(values)) == match_rate(judgements(as_unmet)) == 0


# --- 最終スコアの補正 ---


@given(st.integers(min_value=-500, max_value=500), st.integers(min_value=0, max_value=100))
def test_clipped_score_stays_within_the_allowed_range(score: int, rate: int) -> None:
    result = clip_score(score, rate)

    assert max(rate - MAX_DEVIATION, 0) <= result.score <= min(rate + MAX_DEVIATION, 100)
    assert result.original_score == score
    assert result.clipped == (result.score != score)


@given(st.integers(min_value=0, max_value=100), st.integers(min_value=0, max_value=100))
def test_a_score_already_in_range_is_not_changed(score: int, rate: int) -> None:
    if abs(score - rate) <= MAX_DEVIATION:
        result = clip_score(score, rate)
        assert (result.score, result.clipped) == (score, False)


@given(st.integers(min_value=-500, max_value=500), st.integers(min_value=0, max_value=100))
def test_clipping_twice_changes_nothing(score: int, rate: int) -> None:
    once = clip_score(score, rate).score

    assert clip_score(once, rate) == (once, once, False)


# --- 引用の照合 ---

texts = st.text(min_size=1, max_size=80)


def has_combining(text: str) -> bool:
    """正規化（NFKC）すると、結合文字（濁点・アクセントなど）を含むか。

    結合文字は、直前の文字と合成されて、別の文字になる。引用の前後に、結合文字になる文字が続くと、
    「原文の一部を切り出した」引用が、元の文字と一致しなくなる（引用の誤りではなく、文字の性質）。
    """
    return any(
        unicodedata.category(ch) in {"Mn", "Mc", "Me"} for ch in unicodedata.normalize("NFKC", text)
    )


@given(texts)
def test_normalize_is_idempotent_and_has_no_whitespace(text: str) -> None:
    once = normalize(text)

    assert normalize(once) == once
    assert not any(ch.isspace() for ch in once)


@given(texts, texts, texts)
def test_a_quote_cut_out_of_the_source_is_always_found(before: str, quote: str, after: str) -> None:
    # 正規化して空になる引用（空白・記号だけ）は、照合しない（別のテストで確かめている）
    assume(normalize(quote) != "")
    assume(not (has_combining(before) or has_combining(quote) or has_combining(after)))

    assert verify(quote, before + quote + after) == "match"


@given(texts, texts)
def test_whitespace_and_width_differences_do_not_break_a_match(quote: str, filler: str) -> None:
    assume(normalize(quote) != "")
    assume(not (has_combining(quote) or has_combining(filler)))
    spaced = "  \n".join(quote)  # 1 文字ごとに、改行と空白を挟む（表の折り返しなどの再現）
    wide = unicodedata.normalize("NFKC", quote)

    assert verify(spaced, f"{filler}{wide}{filler}") == "match"


@given(texts)
def test_without_source_text_nothing_is_verified(quote: str) -> None:
    assert verify(quote, None) == "skipped"


# --- 出典名 ---


@given(st.text(max_size=400))
def test_sanitized_name_is_clean_short_and_never_empty(raw: str) -> None:
    name = sanitize(raw)

    assert 0 < len(name) <= MAX_LENGTH
    assert name == name.strip()
    assert unicodedata.normalize("NFC", name) == name
    assert not any(unicodedata.category(ch) in {"Cc", "Cf", "Zl", "Zp"} for ch in name)
    assert "/" not in name
    assert "\\" not in name
    assert sanitize(name) == name


@given(st.lists(st.text(min_size=1, max_size=12), max_size=12))
def test_unique_names_are_unique_keep_the_count_and_the_first_of_each(names: list[str]) -> None:
    result = make_unique(names)

    assert len(result) == len(names)
    assert len(set(result)) == len(result)
    assert all(len(name) <= MAX_LENGTH for name in result)
    for index, name in enumerate(names):
        # 最初に現れた名前は、そのまま。重なった 2 件目以降だけが、番号つきに変わる
        if name not in names[:index]:
            assert result[index] == name
        else:
            assert result[index] != name
