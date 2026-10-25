"""ログの設定（仕様 8.3、13.1 #36）。

出力先は、ファイル（`log/app.log`。ローテーションあり）と、画面（標準エラー）。ログに出して
よいのは、リクエスト ID、所要時間、トークン使用量、処理の段階、エラーの種類だけ。職歴書の内容・
API キー・リクエストの本文やクエリは、出さない（呼び出す側が守る。api/request_log.py も、
パスだけを記録する）。
"""

import logging
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FILE_NAME = "app.log"
MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 5

# いま処理しているリクエストの ID。リクエストの外では「-」
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

_FORMAT = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"
# このアプリが付けたハンドラーの目印（付け直すとき、これだけを外す）
_HANDLER_NAME = "app-logging"
# ファイルに書くロガー。`uvicorn.error` は、想定外の失敗（スタックトレース）を、
# あとから調べられるようにするため
_LOGGER_NAMES = ("app", "uvicorn.error")


class _RequestIdFilter(logging.Filter):
    """すべての行に、リクエスト ID（なければ「-」）を付ける。"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


def _remove_handlers() -> None:
    for name in _LOGGER_NAMES:
        logger = logging.getLogger(name)
        for handler in list(logger.handlers):
            if handler.get_name() == _HANDLER_NAME:
                logger.removeHandler(handler)
                handler.close()


def shutdown_logging() -> None:
    """このアプリが付けたハンドラーを外して、ファイルを閉じる（テストの後片付けなど）。"""
    _remove_handlers()


def configure_logging(log_dir: Path, *, level: str = "INFO", console: bool = True) -> None:
    """`log_dir/app.log` と、標準エラーに、ログを出す。何度呼んでも、二重には出ない。"""
    numeric = logging.getLevelNamesMapping().get(level.upper())
    if numeric is None:
        raise ValueError("APP_LOG_LEVEL は DEBUG・INFO・WARNING・ERROR のどれかを指定してください")

    log_dir.mkdir(parents=True, exist_ok=True)
    _remove_handlers()

    formatter = logging.Formatter(_FORMAT)
    request_filter = _RequestIdFilter()

    handlers: list[logging.Handler] = [
        RotatingFileHandler(
            log_dir / LOG_FILE_NAME,
            maxBytes=MAX_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
            # 最初の 1 行を書くまで、ファイルを開かない
            delay=True,
        )
    ]
    if console:
        handlers.append(logging.StreamHandler())

    for handler in handlers:
        handler.set_name(_HANDLER_NAME)
        handler.setFormatter(formatter)
        handler.addFilter(request_filter)

    app_logger = logging.getLogger("app")
    app_logger.setLevel(numeric)
    # 親（root）には渡さない。uvicorn などの、ほかのログと、二重に出ないようにする
    app_logger.propagate = False
    app_logger.addHandler(handlers[0])
    if console:
        app_logger.addHandler(handlers[1])
    logging.getLogger("uvicorn.error").addHandler(handlers[0])
