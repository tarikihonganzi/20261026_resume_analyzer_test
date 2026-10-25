"""ログの設定（仕様 8.3、13.1 #36）。

出力先は、ファイル（`log/YYYY-MM-DD.log`。その日の日付が、ファイル名）と、画面（標準エラー）。
ログに出してよいのは、リクエスト ID、所要時間、トークン使用量、処理の段階、エラーの種類だけ。
職歴書の内容・API キー・リクエストの本文やクエリは、出さない（呼び出す側が守る。
api/request_log.py も、パスだけを記録する）。
"""

import contextlib
import logging
import os
from collections.abc import Callable
from contextvars import ContextVar
from datetime import date, datetime, timedelta
from pathlib import Path

# 残す日数。これより古い日のファイルは、起動したとき・日が変わったときに、消す
RETENTION_DAYS = 30

# いま処理しているリクエストの ID。リクエストの外では「-」
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

_FORMAT = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"
# このアプリが付けたハンドラーの目印（付け直すとき、これだけを外す）
_HANDLER_NAME = "app-logging"
# ファイルに書くロガー。`uvicorn.error` は、想定外の失敗（スタックトレース）を、
# あとから調べられるようにするため
_LOGGER_NAMES = ("app", "uvicorn.error")
_DATE_FORMAT = "%Y-%m-%d"
_SUFFIX = ".log"


def log_file_name(day: date) -> str:
    """その日のログのファイル名（例: `2026-10-25.log`）。"""
    return f"{day.strftime(_DATE_FORMAT)}{_SUFFIX}"


class DailyFileHandler(logging.FileHandler):
    """その日の日付のファイルに書く。日をまたいだら、次の日のファイルに切り替える。

    - 日付は、**書くたびに**時計から読む（起動したときの日付に固定しない。起動したまま日をまたぐ
      ことがあるため）。
    - 同じ日に、アプリを起動し直しても、同じファイルに、続けて書く（追記）。
    - 最初の 1 行を書くまで、ファイルを作らない。
    - 古い日のファイルは、`RETENTION_DAYS` を超えたものから消す。日付として読めない名前の
      ファイルには、触れない。
    """

    def __init__(
        self,
        log_dir: Path,
        *,
        today: Callable[[], date] = date.today,
        retention_days: int = RETENTION_DAYS,
    ) -> None:
        self._log_dir = log_dir
        self._today = today
        self._retention_days = retention_days
        self._day = today()
        super().__init__(log_dir / log_file_name(self._day), encoding="utf-8", delay=True)
        self._purge_old_files()

    def emit(self, record: logging.LogRecord) -> None:
        day = self._today()
        if day != self._day:
            self._switch_to(day)
        super().emit(record)

    def _switch_to(self, day: date) -> None:
        self.acquire()
        try:
            if self.stream is not None:
                self.stream.close()
                self.stream = None  # pyright: ignore[reportAttributeAccessIssue]
            self.baseFilename = os.fspath((self._log_dir / log_file_name(day)).resolve())
            self._day = day
        finally:
            self.release()
        self._purge_old_files()

    def _purge_old_files(self) -> None:
        oldest_kept = self._day - timedelta(days=self._retention_days - 1)
        for path in self._log_dir.glob(f"*{_SUFFIX}"):
            try:
                day = datetime.strptime(path.stem, _DATE_FORMAT).date()
            except ValueError:
                continue  # 日付の名前でないものは、このアプリのログではない
            if day < oldest_kept:
                # 別のプログラムが開いているなどで、消せなければ、次の機会に、消す
                with contextlib.suppress(OSError):
                    path.unlink()


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


def configure_logging(
    log_dir: Path,
    *,
    level: str = "INFO",
    console: bool = True,
    today: Callable[[], date] = date.today,
) -> None:
    """`log_dir/YYYY-MM-DD.log` と、標準エラーに、ログを出す。何度呼んでも、二重には出ない。"""
    numeric = logging.getLevelNamesMapping().get(level.upper())
    if numeric is None:
        raise ValueError("APP_LOG_LEVEL は DEBUG・INFO・WARNING・ERROR のどれかを指定してください")

    log_dir.mkdir(parents=True, exist_ok=True)
    _remove_handlers()

    formatter = logging.Formatter(_FORMAT)
    request_filter = _RequestIdFilter()

    file_handler = DailyFileHandler(log_dir, today=today)
    handlers: list[logging.Handler] = [file_handler]
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
    for handler in handlers:
        app_logger.addHandler(handler)
    logging.getLogger("uvicorn.error").addHandler(file_handler)
