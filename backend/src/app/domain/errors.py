"""ドメインの例外。`api/` で HTTP ステータスと利用者向けのメッセージに対応づける。

例外のメッセージに、API キーや職歴書の内容を入れない。
"""

from typing import ClassVar


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


class LlmError(DomainError):
    """LLM（OpenAI の API）の呼び出しに失敗したとき。メッセージは、利用者に表示できる日本語。

    API キーや、API の応答の本文、職歴書の内容を、メッセージに入れない。
    """

    code = "llm_error"


class LlmAuthError(LlmError):
    """API キーが未設定、または認証に失敗したとき。設定ページへ誘導する。"""

    code = "llm_auth"

    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            message
            or "API キーが正しくないか、権限がありません。設定ページで API キーを確認してください。"
        )


class LlmUnavailableError(LlmError):
    """一時的に呼び出せないとき（タイムアウト、レート制限、接続失敗、サーバーの障害）。再試行を促す。"""

    code = "llm_unavailable"

    _MESSAGES: ClassVar[dict[str, str]] = {
        "timeout": "AI サービスの応答に時間がかかりすぎました。もう一度お試しください。",
        "rate_limit": "AI サービスが混み合っています。しばらく待ってから、もう一度お試しください。",
        "connection": "AI サービスに接続できませんでした。ネットワークとベース URL を確認して、"
        "もう一度お試しください。",
        "server": "AI サービスで一時的な障害が起きています。"
        "しばらく待ってから、もう一度お試しください。",
    }

    def __init__(self, kind: str) -> None:
        super().__init__(self._MESSAGES.get(kind, self._MESSAGES["server"]))
        self.kind = kind


class LlmRequestError(LlmError):
    """リクエストが受け付けられなかったとき（モデル名・ベース URL の誤りなど）。"""

    code = "llm_request"

    def __init__(self) -> None:
        super().__init__(
            "AI サービスがリクエストを受け付けませんでした。"
            "設定ページでモデル名とベース URL を確認してください。"
        )


class LlmResponseError(LlmError):
    """応答を利用できないとき（途中で切れた、拒否された、構造が正しくない）。再実行を促す。

    `reason` は、ログに出してよい分類（incomplete・refusal・empty・invalid）。
    """

    code = "llm_response"

    def __init__(self, reason: str) -> None:
        super().__init__("AI の応答を利用できませんでした。もう一度お試しください。")
        self.reason = reason


class ExtractionInconsistentError(DomainError):
    """LLM の抽出結果が、再実行しても条件と食い違っていたとき（仕様 5.4 ステップ 1、5.6）。"""

    code = "extraction_inconsistent"

    def __init__(self) -> None:
        super().__init__("AI の抽出結果に不整合がありました。もう一度実行してください。")
