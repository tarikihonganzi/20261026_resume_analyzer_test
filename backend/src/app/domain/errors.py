"""ドメインの例外。`api/` で HTTP ステータスと利用者向けのメッセージに対応づける。

例外のメッセージに、API キーや職歴書の内容を入れない。
"""


class DomainError(Exception):
    """ドメインの規則に反したときの基底クラス。"""


class NoConditionsError(DomainError):
    """評価する条件が 0 件のとき。"""


class ConditionMismatchError(DomainError):
    """条件と、抽出結果または判定の対応が取れないとき（不足・重複）。"""


class StorageError(DomainError):
    """ファイルの読み書きに失敗したとき。メッセージにファイルの内容を入れない。"""


class StorageCorruptedError(StorageError):
    """保存されたファイルが壊れている、または未対応の形式のとき。"""


class ConditionSetNotFoundError(DomainError):
    """指定された条件セットが存在しないとき。"""
