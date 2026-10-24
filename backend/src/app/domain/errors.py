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


class ResumeError(DomainError):
    """職歴書の入力に問題があるとき。メッセージは、利用者にそのまま表示できる日本語（5.6 章）。

    `code` は API のエラーコードとして使う。メッセージに、職歴書の内容を入れない。
    """

    code = "invalid_resume"


class InvalidResumeInputError(ResumeError):
    """ファイルか貼り付けテキストの、どちらか 1 つが指定されていないとき。"""

    code = "invalid_input"


class UnsupportedFormatError(ResumeError):
    """未対応の形式のとき。"""

    code = "unsupported_format"


class FileTooLargeError(ResumeError):
    """設定ページで指定した上限を超えたとき。"""

    code = "file_too_large"

    def __init__(self, limit_mb: int) -> None:
        super().__init__(
            f"ファイルサイズが上限（{limit_mb} MB）を超えています。"
            "小さいファイルを選ぶか、設定ページで上限を変更してください。"
        )
        self.limit_mb = limit_mb


class ConversionFailedError(ResumeError):
    """ファイルを読み取れなかったとき（壊れている、拡張子と内容が一致しない、など）。"""

    code = "conversion_failed"


class EmptyResumeError(ResumeError):
    """テキストが得られない、または極端に短いとき。"""

    code = "empty_text"
