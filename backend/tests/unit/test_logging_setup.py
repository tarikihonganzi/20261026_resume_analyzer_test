"""ログの設定（`log/YYYY-MM-DD.log`。仕様 8.3、13.1 #36）。"""

import logging
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.logging_setup import (
    RETENTION_DAYS,
    DailyFileHandler,
    configure_logging,
    log_file_name,
    request_id_var,
    shutdown_logging,
)

DAY = date(2026, 10, 25)


class Clock:
    """テスト用の時計。日をまたぐ動きを、再現する。"""

    def __init__(self, day: date) -> None:
        self.day = day

    def __call__(self) -> date:
        return self.day


@pytest.fixture(autouse=True)
def _clean_logging() -> Iterator[None]:  # pyright: ignore[reportUnusedFunction]
    shutdown_logging()
    yield
    shutdown_logging()


def flush() -> None:
    for handler in logging.getLogger("app").handlers:
        handler.flush()


def read_day(log_dir: Path, day: date) -> str:
    flush()
    return (log_dir / log_file_name(day)).read_text(encoding="utf-8")


def file_handlers(name: str) -> list[logging.Handler]:
    return [h for h in logging.getLogger(name).handlers if isinstance(h, DailyFileHandler)]


def test_file_name_is_the_date_of_the_day() -> None:
    assert log_file_name(date(2026, 10, 5)) == "2026-10-05.log"


def test_creates_the_directory_and_writes_utf8_lines_to_todays_file(tmp_path: Path) -> None:
    log_dir = tmp_path / "nested" / "log"

    configure_logging(log_dir, today=Clock(DAY))
    logging.getLogger("app.pipeline").warning("段階: 抽出中 stage=%s", "extracting")

    text = read_day(log_dir, DAY)
    assert "WARNING" in text
    assert "app.pipeline" in text
    assert "段階: 抽出中 stage=extracting" in text
    assert [p.name for p in log_dir.iterdir()] == ["2026-10-25.log"]


def test_the_default_clock_is_the_real_date(tmp_path: Path) -> None:
    configure_logging(tmp_path)
    logging.getLogger("app").info("今日")
    flush()

    assert [p.name for p in tmp_path.iterdir()] == [log_file_name(date.today())]


def test_the_file_is_not_created_until_the_first_line(tmp_path: Path) -> None:
    configure_logging(tmp_path, today=Clock(DAY))

    assert list(tmp_path.iterdir()) == []


def test_lines_after_midnight_go_to_the_new_days_file(tmp_path: Path) -> None:
    # 起動したまま、日をまたいでも、ファイル名は、その日の日付になる（起動時の日付に固定しない）
    clock = Clock(DAY)
    configure_logging(tmp_path, today=clock)
    log = logging.getLogger("app.test")

    log.info("23時台")
    clock.day = DAY + timedelta(days=1)
    log.info("日またぎのあと")
    log.info("同じ日の 2 行目")

    first = read_day(tmp_path, DAY)
    second = read_day(tmp_path, DAY + timedelta(days=1))
    assert "23時台" in first
    assert "日またぎのあと" not in first
    assert "日またぎのあと" in second
    assert "同じ日の 2 行目" in second


def test_restarting_on_the_same_day_appends_to_the_same_file(tmp_path: Path) -> None:
    # アプリを続けて起動し直しても、その日のログは、1 つのファイルに続けて残る
    clock = Clock(DAY)
    configure_logging(tmp_path, today=clock)
    logging.getLogger("app").info("1 回目の起動")
    shutdown_logging()

    configure_logging(tmp_path, today=clock)
    logging.getLogger("app").info("2 回目の起動")

    text = read_day(tmp_path, DAY)
    assert text.index("1 回目の起動") < text.index("2 回目の起動")
    assert len(list(tmp_path.glob("*.log"))) == 1


def test_files_older_than_the_retention_period_are_removed_at_startup(tmp_path: Path) -> None:
    keep = [DAY - timedelta(days=n) for n in (0, 1, RETENTION_DAYS - 1)]
    drop = [DAY - timedelta(days=n) for n in (RETENTION_DAYS, RETENTION_DAYS + 40)]
    for day in [*keep, *drop]:
        (tmp_path / log_file_name(day)).write_text("x", encoding="utf-8")
    other = tmp_path / "notes.txt"
    other.write_text("関係のないファイル", encoding="utf-8")
    odd = tmp_path / "2026-13-45.log"  # 日付として読めない名前は、触らない
    odd.write_text("x", encoding="utf-8")

    configure_logging(tmp_path, today=Clock(DAY))

    remaining = {p.name for p in tmp_path.iterdir()}
    assert {log_file_name(d) for d in keep} <= remaining
    assert not ({log_file_name(d) for d in drop} & remaining)
    assert {"notes.txt", "2026-13-45.log"} <= remaining


def test_old_files_are_also_removed_when_the_day_changes(tmp_path: Path) -> None:
    clock = Clock(DAY)
    configure_logging(tmp_path, today=clock)
    logging.getLogger("app").info("初日")
    # 起動後に、保存期間より古くなるファイル（初日のログ）が、日をまたいだときに消える
    clock.day = DAY + timedelta(days=RETENTION_DAYS)

    logging.getLogger("app").info("保存期間のあと")
    flush()

    names = {p.name for p in tmp_path.iterdir()}
    assert log_file_name(DAY) not in names
    assert log_file_name(clock.day) in names


def test_every_line_carries_the_request_id_or_a_dash(tmp_path: Path) -> None:
    configure_logging(tmp_path, today=Clock(DAY))
    log = logging.getLogger("app.test")

    log.info("リクエストの外")
    token = request_id_var.set("ab12cd34")
    try:
        log.info("リクエストの中")
    finally:
        request_id_var.reset(token)

    lines = read_day(tmp_path, DAY).splitlines()
    assert "[-]" in lines[0]
    assert "[ab12cd34]" in lines[1]


def test_calling_it_twice_does_not_duplicate_lines(tmp_path: Path) -> None:
    configure_logging(tmp_path, today=Clock(DAY))
    configure_logging(tmp_path, today=Clock(DAY))

    logging.getLogger("app").info("一度だけ")

    assert read_day(tmp_path, DAY).count("一度だけ") == 1
    assert len(file_handlers("app")) == 1


def test_the_level_filters_lines(tmp_path: Path) -> None:
    configure_logging(tmp_path, level="WARNING", today=Clock(DAY))
    log = logging.getLogger("app.test")

    log.info("出ない")
    log.warning("出る")

    text = read_day(tmp_path, DAY)
    assert "出ない" not in text
    assert "出る" in text


def test_an_unknown_level_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="APP_LOG_LEVEL"):
        configure_logging(tmp_path, level="LOUD")


def test_app_logs_do_not_propagate_to_the_root_logger(tmp_path: Path) -> None:
    # uvicorn などの、ほかのログと二重に出ないようにする
    configure_logging(tmp_path)

    assert logging.getLogger("app").propagate is False


def test_server_errors_from_uvicorn_are_written_to_the_same_file(tmp_path: Path) -> None:
    configure_logging(tmp_path, today=Clock(DAY))

    logging.getLogger("uvicorn.error").error("サーバーの失敗")

    assert "サーバーの失敗" in read_day(tmp_path, DAY)


def test_shutdown_closes_the_file_so_that_it_can_be_removed(tmp_path: Path) -> None:
    configure_logging(tmp_path, today=Clock(DAY))
    logging.getLogger("app").info("書く")

    shutdown_logging()

    assert file_handlers("app") == []
    (tmp_path / log_file_name(DAY)).unlink()  # Windows では、開いたままだと、消せない


def console_handlers() -> list[logging.Handler]:
    # pytest が付ける捕捉用のハンドラーは、数えない。このアプリが付けたものだけ
    return [
        h
        for h in logging.getLogger("app").handlers
        if h.get_name() == "app-logging" and not isinstance(h, DailyFileHandler)
    ]


def test_console_output_is_added_unless_disabled(tmp_path: Path) -> None:
    configure_logging(tmp_path)
    assert len(console_handlers()) == 1

    shutdown_logging()
    configure_logging(tmp_path, console=False)

    assert console_handlers() == []


def test_module_exposes_no_state_other_than_the_context_variable() -> None:
    assert request_id_var.get() == "-"


def test_the_test_suite_never_writes_into_the_repository_log_directory() -> None:
    # conftest が、アプリを読み込む前に、出力先を一時フォルダにしている（なければ、実行のたびに、
    # リポジトリの log/ に、テストのログが溜まる）
    from app.settings import AppSettings

    repository_log = Path(__file__).resolve().parents[3] / "log"

    log_dir = AppSettings.from_env().log_dir

    assert log_dir is not None
    assert log_dir.resolve() != repository_log
    assert repository_log.resolve() not in log_dir.resolve().parents
