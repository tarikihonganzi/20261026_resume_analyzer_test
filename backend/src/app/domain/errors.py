"""ドメインの例外。`api/` で HTTP ステータスと利用者向けのメッセージに対応づける。

例外のメッセージに、API キーや職歴書の内容を入れない。
"""


class DomainError(Exception):
    """ドメインの規則に反したときの基底クラス。"""


class NoConditionsError(DomainError):
    """評価する条件が 0 件のとき。"""


class ConditionMismatchError(DomainError):
    """条件と、抽出結果または判定の対応が取れないとき（不足・重複）。"""
