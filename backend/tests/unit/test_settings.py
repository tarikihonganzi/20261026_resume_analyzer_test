from pathlib import Path

import pytest

from app.settings import AppSettings


def test_defaults_use_the_real_llm_and_the_repository_data_directory() -> None:
    settings = AppSettings.from_env({})

    assert settings.llm_mode == "real"
    assert settings.fake_delay_sec == 0.0
    assert settings.allow_remote is False
    assert settings.data_dir.name == "data"


def test_environment_variables_override_the_defaults(tmp_path: Path) -> None:
    settings = AppSettings.from_env(
        {
            "APP_LLM_MODE": "fake",
            "APP_FAKE_DELAY_SEC": "1.5",
            "APP_DATA_DIR": str(tmp_path),
            "APP_STATIC_DIR": str(tmp_path / "dist"),
        }
    )

    assert settings.llm_mode == "fake"
    assert settings.fake_delay_sec == 1.5
    assert settings.data_dir == tmp_path
    assert settings.static_dir == tmp_path / "dist"


@pytest.mark.parametrize("value", ["fake ", "FAKE", "mock", "", "1"])
def test_an_unknown_llm_mode_is_rejected(value: str) -> None:
    # 偽の LLM を、設定の誤りで、意図せず使わない（または、実 API を、意図せず使わない）
    with pytest.raises(ValueError, match="APP_LLM_MODE"):
        AppSettings.from_env({"APP_LLM_MODE": value})


@pytest.mark.parametrize(
    ("value", "expected"),
    [("1", True), (" 1 ", True), ("true", False), ("yes", False), ("0", False), ("", False)],
)
def test_remote_access_is_enabled_only_by_exactly_one(value: str, expected: bool) -> None:
    # 公開範囲を変える設定なので、曖昧な値（true・yes など）では、有効にしない（仕様 13.1 #26）
    assert AppSettings.from_env({"APP_ALLOW_REMOTE": value}).allow_remote is expected
