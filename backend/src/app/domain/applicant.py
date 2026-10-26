"""応募者の氏名の整形。LLM が返した値を、画面に出せる形にする（純粋な関数）。"""

# 氏名として受け付ける最大の文字数。これを超えるものは、文章などを取り違えたとみなして捨てる
MAX_NAME_LENGTH = 100


def normalize_applicant_name(name: str | None) -> str | None:
    """前後の空白を除き、途中の空白・改行を 1 つの空白にする。空・長すぎるときは None。"""
    if name is None:
        return None
    # `split()` は、全角の空白や改行・タブでも区切る
    tidy = " ".join(name.split())
    if tidy == "" or len(tidy) > MAX_NAME_LENGTH:
        return None
    return tidy
