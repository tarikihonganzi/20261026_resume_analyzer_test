"""ログの設定（`log/app.log`。仕様 8.3、13.1 #36）。"""

import logging
from collections.abc import Iterator
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pytest

from app import logging_setup
from app.logging_setup import (
    BACKUP_COUNT,
    LOG_FILE_NAME,
    MAX_BYTES,
    configure_logging,
    request_id_var,
    shutdown_logging,
)


@pytest.fixture(autouse=True)
def _clean_logging() -> Iterator[None]:  # pyright: ignore[reportUnusedFunction]
    shutdown_logging()
    yield
    shutdown_logging()


def read_log(log_dir: Path) -> str:
    for handler in logging.getLogger("app").handlers:
        handler.flush()
    return (log_dir / LOG_FILE_NAME).read_text(encoding="utf-8")


def file_handlers(name: str) -> list[logging.Handler]:
    return [h for h in logging.getLogger(name).handlers if isinstance(h, RotatingFileHandler)]


def test_creates_the_directory_and_writes_utf8_lines_with_level_and_logger(
    tmp_path: Path,
) -> None:
    log_dir = tmp_path / "nested" / "log"

    configure_logging(log_dir)
    logging.getLogger("app.pipeline").warning("段階: 抽出中 stage=%s", "extracting")

    text = read_log(log_dir)
    assert "WARNING" in text
    assert "app.pipeline" in text
    assert "段階: 抽出中 stage=extracting" in text


def test_every_line_carries_the_request_id_or_a_dash(tmp_path: Path) -> None:
    configure_logging(tmp_path)
    log = logging.getLogger("app.test")

    log.info("リクエストの外")
    token = request_id_var.set("ab12cd34")
    try:
        log.info("リクエストの中")
    finally:
        request_id_var.reset(token)

    lines = read_log(tmp_path).splitlines()
    assert "[-]" in lines[0]
    assert "[ab12cd34]" in lines[1]


def test_calling_it_twice_does_not_duplicate_lines(tmp_path: Path) -> None:
    configure_logging(tmp_path)
    configure_logging(tmp_path)

    logging.getLogger("app").info("一度だけ")

    assert read_log(tmp_path).count("一度だけ") == 1
    assert len(file_handlers("app")) == 1


def test_the_level_filters_lines(tmp_path: Path) -> None:
    configure_logging(tmp_path, level="WARNING")
    log = logging.getLogger("app.test")

    log.info("出ない")
    log.warning("出る")

    text = read_log(tmp_path)
    assert "出ない" not in text
    assert "出る" in text


def test_an_unknown_level_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="APP_LOG_LEVEL"):
        configure_logging(tmp_path, level="LOUD")


def test_the_file_rotates_so_that_it_cannot_grow_without_limit(tmp_path: Path) -> None:
    configure_logging(tmp_path)

    [handler] = file_handlers("app")

    assert isinstance(handler, RotatingFileHandler)
    assert handler.maxBytes == MAX_BYTES == 5 * 1024 * 1024
    assert handler.backupCount == BACKUP_COUNT == 5
    assert handler.encoding == "utf-8"


def test_app_logs_do_not_propagate_to_the_root_logger(tmp_path: Path) -> None:
    # uvicorn などの、ほかのログと二重に出ないようにする
    configure_logging(tmp_path)

    assert logging.getLogger("app").propagate is False


def test_server_errors_from_uvicorn_are_written_to_the_same_file(tmp_path: Path) -> None:
    configure_logging(tmp_path)

    logging.getLogger("uvicorn.error").error("サーバーの失敗")

    assert "サーバーの失敗" in read_log(tmp_path)


def test_shutdown_closes_the_file_so_that_it_can_be_removed(tmp_path: Path) -> None:
    configure_logging(tmp_path)
    logging.getLogger("app").info("書く")

    shutdown_logging()

    assert file_handlers("app") == []
    (tmp_path / LOG_FILE_NAME).unlink()  # Windows では、開いたままだと、消せない


def console_handlers() -> list[logging.Handler]:
    # pytest が付ける捕捉用のハンドラーは、数えない。このアプリが付けたものだけ
    return [
        h
        for h in logging.getLogger("app").handlers
        if h.get_name() == "app-logging" and not isinstance(h, RotatingFileHandler)
    ]


def test_console_output_is_added_unless_disabled(tmp_path: Path) -> None:
    configure_logging(tmp_path)
    assert len(console_handlers()) == 1

    shutdown_logging()
    configure_logging(tmp_path, console=False)

    assert console_handlers() == []


def test_module_exposes_no_state_other_than_the_context_variable() -> None:
    assert logging_setup.request_id_var.get() == "-"


def test_the_test_suite_never_writes_into_the_repository_log_directory() -> None:
    # conftest が、アプリを読み込む前に、出力先を一時フォルダにしている（なければ、実行のたびに、
    # リポジトリの log/ に、テストのログが溜まる）
    from app.settings import AppSettings

    repository_log = Path(__file__).resolve().parents[3] / "log"

    log_dir = AppSettings.from_env().log_dir

    assert log_dir is not None
    assert log_dir.resolve() != repository_log
    assert repository_log.resolve() not in log_dir.resolve().parents
