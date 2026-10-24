"""引用の正規化と、原文との照合（仕様 5.4 共通ルール）。"""

import unicodedata
from typing import Literal

QuoteVerification = Literal["match", "not_found", "skipped"]

# MarkItDown が加える Markdown の記号。表の区切り、強調、見出し、コード、引用
_MARKDOWN_SYMBOLS = frozenset("|*#`>")


def normalize(text: str) -> str:
    """表記の揺れを除いて、照合用の文字列にする。

    NFKC 正規化（全角・半角、濁点の分解形をそろえる）→ 空白・改行の除去 → Markdown 記号の除去。
    大文字・小文字は区別する（仕様に定めがないため）。
    """
    normalized = unicodedata.normalize("NFKC", text)
    return "".join(ch for ch in normalized if not ch.isspace() and ch not in _MARKDOWN_SYMBOLS)


def verify(quote_text: str, source_text: str | None) -> QuoteVerification:
    """引用が原文に含まれるかを調べる。

    - `source_text` が None（PDF など、手元にテキストがない）: `skipped`
    - 正規化した引用が、正規化した原文の部分文字列: `match`
    - それ以外: `not_found`（引用が誤りとは断定せず、原文で確認できなかったことを示す）
    """
    if source_text is None:
        return "skipped"

    needle = normalize(quote_text)
    # 空の引用は、どの原文にも含まれてしまうので照合できたことにしない
    if not needle:
        return "not_found"
    return "match" if needle in normalize(source_text) else "not_found"
