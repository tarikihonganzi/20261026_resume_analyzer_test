import json
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.domain.errors import StorageCorruptedError
from app.domain.models import Config, ConfigUpdate
from app.storage.config_store import ConfigStore, mask_api_key

API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz1234"


def test_missing_file_gives_the_defaults(tmp_path: Path) -> None:
    config = ConfigStore(tmp_path / "config.json", environ={}).load()

    assert config == Config(
        openai_api_key="",
        openai_base_url="https://kjm-kong.kajima.co.jp/openai/v1",
        model="response-standard",
        max_file_size_mb=0,
        pdf_detail="high",
        request_timeout_sec=180,
    )


def test_loading_does_not_create_the_file(tmp_path: Path) -> None:
    ConfigStore(tmp_path / "config.json", environ={}).load()

    assert list(tmp_path.iterdir()) == []


def test_saved_config_uses_the_keys_of_the_spec_and_survives_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    ConfigStore(path, environ={}).save(
        Config(
            openai_api_key=API_KEY,
            openai_base_url="https://llm.example.internal/v1",
            model="gpt-5.5",
            max_file_size_mb=20,
            pdf_detail="low",
            request_timeout_sec=120,
        )
    )

    assert set(json.loads(path.read_text(encoding="utf-8"))) == {
        "openai_api_key",
        "openai_base_url",
        "model",
        "max_file_size_mb",
        "pdf_detail",
        "request_timeout_sec",
    }
    reloaded = ConfigStore(path, environ={}).load()
    assert reloaded.openai_api_key == API_KEY
    assert reloaded.max_file_size_mb == 20
    assert reloaded.pdf_detail == "low"


def test_saved_file_is_owner_only(
    tmp_path: Path, assert_owner_only: Callable[[Path], None]
) -> None:
    path = tmp_path / "config.json"

    ConfigStore(path, environ={}).save(Config(openai_api_key=API_KEY))

    assert_owner_only(path)


def test_partial_file_is_completed_with_defaults(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"openai_api_key": API_KEY}), encoding="utf-8")

    config = ConfigStore(path, environ={}).load()

    assert config.openai_api_key == API_KEY
    assert config.openai_base_url == "https://kjm-kong.kajima.co.jp/openai/v1"
    assert config.model == "response-standard"
    assert config.request_timeout_sec == 180


def test_unknown_keys_in_the_file_are_ignored(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"model": "gpt-5.5", "future_option": 1}), encoding="utf-8")

    assert ConfigStore(path, environ={}).load().model == "gpt-5.5"


@pytest.mark.parametrize(
    "content",
    ['{"openai_api_key": "' + API_KEY, "[]", '{"max_file_size_mb": -1}', '{"pdf_detail": "x"}'],
)
def test_corrupted_or_invalid_file_is_an_error_without_leaking_the_key(
    tmp_path: Path, content: str
) -> None:
    path = tmp_path / "config.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(StorageCorruptedError) as excinfo:
        ConfigStore(path, environ={}).load()

    assert API_KEY not in str(excinfo.value)


# --- 更新 ---


def test_update_changes_only_the_given_fields(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", environ={})
    store.save(Config(openai_api_key=API_KEY, model="gpt-5.5", max_file_size_mb=10))

    updated = store.update(ConfigUpdate(model="gpt-5.5-mini", max_file_size_mb=0))

    assert updated.model == "gpt-5.5-mini"
    assert updated.max_file_size_mb == 0
    assert updated.openai_api_key == API_KEY
    assert store.load() == updated


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_update_without_an_api_key_keeps_the_existing_one(
    tmp_path: Path, blank: str | None
) -> None:
    store = ConfigStore(tmp_path / "config.json", environ={})
    store.save(Config(openai_api_key=API_KEY))

    updated = store.update(ConfigUpdate(openai_api_key=blank, model="gpt-5.5-mini"))

    assert updated.openai_api_key == API_KEY
    assert store.load().openai_api_key == API_KEY


def test_update_with_a_new_api_key_replaces_it(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", environ={})
    store.save(Config(openai_api_key=API_KEY))

    updated = store.update(ConfigUpdate(openai_api_key="  sk-new-key-0000000000  "))

    assert updated.openai_api_key == "sk-new-key-0000000000"


def test_update_can_set_the_base_url_and_clear_it(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", environ={})

    store.update(ConfigUpdate(openai_base_url="https://llm.example.internal/v1"))
    assert store.load().openai_base_url == "https://llm.example.internal/v1"

    store.update(ConfigUpdate(openai_base_url=""))
    assert store.load().openai_base_url == ""


def test_update_on_a_missing_file_starts_from_the_defaults(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", environ={})

    updated = store.update(ConfigUpdate(openai_api_key=API_KEY))

    assert updated.openai_api_key == API_KEY
    assert updated.model == "response-standard"


@pytest.mark.parametrize(
    "invalid",
    [
        {"max_file_size_mb": -1},
        {"request_timeout_sec": 0},
        {"pdf_detail": "ultra"},
        {"model": ""},
        {"unknown": 1},
    ],
)
def test_invalid_update_is_rejected_and_nothing_is_written(
    tmp_path: Path, invalid: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        ConfigUpdate.model_validate(invalid)

    assert list(tmp_path.iterdir()) == []


# --- 環境変数（仕様 4.1: 設定ファイルに値がないときの初期値） ---

ENV = {
    "OPENAI_API_KEY": "sk-from-env-0000000000",
    "OPENAI_BASE_URL": "https://env.example.internal/v1",
    "OPENAI_MODEL": "gpt-env",
}


def test_environment_variables_are_used_when_the_file_does_not_exist(tmp_path: Path) -> None:
    config = ConfigStore(tmp_path / "config.json", environ=ENV).load()

    assert config.openai_api_key == "sk-from-env-0000000000"
    assert config.openai_base_url == "https://env.example.internal/v1"
    assert config.model == "gpt-env"


def test_environment_variables_fill_only_the_items_missing_from_the_file(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"model": "gpt-file"}), encoding="utf-8")

    config = ConfigStore(path, environ=ENV).load()

    assert config.model == "gpt-file"  # 保存済みの値を優先
    assert config.openai_api_key == "sk-from-env-0000000000"
    assert config.openai_base_url == "https://env.example.internal/v1"


def test_saved_empty_string_wins_over_the_environment(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"openai_base_url": "", "openai_api_key": ""}), encoding="utf-8")

    config = ConfigStore(path, environ=ENV).load()

    assert config.openai_base_url == ""
    assert config.openai_api_key == ""


def test_blank_environment_variables_are_ignored(tmp_path: Path) -> None:
    environ = {"OPENAI_API_KEY": "  ", "OPENAI_BASE_URL": "", "OPENAI_MODEL": " "}

    config = ConfigStore(tmp_path / "config.json", environ=environ).load()

    assert (config.openai_api_key, config.openai_base_url, config.model) == (
        "",
        "https://kjm-kong.kajima.co.jp/openai/v1",
        "response-standard",
    )


def test_update_does_not_write_environment_values_into_the_file(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    store = ConfigStore(path, environ=ENV)

    updated = store.update(ConfigUpdate(max_file_size_mb=5))

    assert json.loads(path.read_text(encoding="utf-8")) == {"max_file_size_mb": 5}
    assert updated.openai_api_key == "sk-from-env-0000000000"  # 実際に使われる値には反映される
    assert store.load().max_file_size_mb == 5


def test_update_with_a_blank_api_key_keeps_the_environment_key(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", environ=ENV)

    updated = store.update(ConfigUpdate(openai_api_key="", model="gpt-5.5-mini"))

    assert updated.openai_api_key == "sk-from-env-0000000000"
    assert updated.model == "gpt-5.5-mini"


def test_saving_a_new_api_key_overrides_the_environment(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", environ=ENV)

    store.update(ConfigUpdate(openai_api_key="sk-new-key-1111111111"))

    assert store.load().openai_api_key == "sk-new-key-1111111111"


def test_file_containing_null_is_corrupted_not_defaults(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text("null", encoding="utf-8")

    with pytest.raises(StorageCorruptedError):
        ConfigStore(path, environ={}).load()
    with pytest.raises(StorageCorruptedError):
        ConfigStore(path, environ={}).update(ConfigUpdate(model="gpt-5.5-mini"))

    assert path.read_text(encoding="utf-8") == "null"


# --- マスク ---


def test_api_key_is_masked_to_the_last_four_characters() -> None:
    assert mask_api_key(API_KEY) == "****1234"


def test_unset_api_key_is_masked_as_empty() -> None:
    assert mask_api_key("") == ""


@pytest.mark.parametrize("short", ["a", "abcd", "abcdefgh", "abcdefghijk"])
def test_short_api_key_is_fully_hidden(short: str) -> None:
    # 短いキーは、末尾 4 文字でも大半が分かってしまうので、一切見せない
    assert mask_api_key(short) == "****"


def test_masked_value_never_contains_the_rest_of_the_key() -> None:
    masked = mask_api_key(API_KEY)

    assert API_KEY[:-4] not in masked
    assert len(masked) == 8


def test_repr_and_str_of_config_do_not_contain_the_api_key() -> None:
    config = Config(openai_api_key=API_KEY)

    assert API_KEY not in repr(config)
    assert API_KEY not in str(config)
