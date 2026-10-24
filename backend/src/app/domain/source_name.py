"""出典名（職歴書の名前）の整形（仕様 5.4 共通ルール）。

ファイル名は利用者の入力なので、プロンプトに入れる前に整える。
"""

import re
import unicodedata

PASTED_TEXT_NAME = "貼り付けテキスト"
# 整形の結果が空になったときの名前。仕様に定めがないので、出典名が空にならないようにする
UNNAMED = "名称未設定"
MAX_LENGTH = 200

_PATH_SEPARATORS = re.compile(r"[/\\]")
# 制御文字（Cc）、書式制御文字（Cf。ゼロ幅文字や、表示を偽装できる右から左への上書きなど）、
# 行・段落の区切り（Zl・Zp）
_REMOVED_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp"})


def sanitize(filename: str) -> str:
    """ディレクトリ部分を除いたファイル名を、NFC・制御文字なし・200 文字以内にして返す。

    `/` と `\\` の両方をパスの区切りとして扱う。macOS のファイル名は濁点が分解された形で届く
    ことがあり、そのままだと LLM が出力する出典名と一致しなくなるため NFC にそろえる。
    """
    name = _PATH_SEPARATORS.split(filename)[-1]
    name = unicodedata.normalize("NFC", name)
    name = "".join(ch for ch in name if unicodedata.category(ch) not in _REMOVED_CATEGORIES)
    # 除いた文字の両側にあった基底文字と結合文字が隣り合い、NFC が崩れることがある
    name = unicodedata.normalize("NFC", name)
    name = name.strip()[:MAX_LENGTH]
    # 切り詰めの結果、末尾に空白が残ることがある
    return name.rstrip() or UNNAMED
