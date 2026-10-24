import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.domain.errors import ConditionSetNotFoundError, StorageCorruptedError
from app.domain.models import Condition
from app.storage.condition_set_store import ConditionSetStore

JST = timezone(timedelta(hours=9))


class Clock:
    """テスト用の時計。呼ぶたびに 1 分進む。"""

    def __init__(self) -> None:
        self.current = datetime(2026, 10, 25, 9, 0, 0, tzinfo=JST)

    def __call__(self) -> datetime:
        value = self.current
        self.current += timedelta(minutes=1)
        return value


def condition(id: str, *, kind: str = "boolean", min_value: float | None = None) -> Condition:
    return Condition.model_validate(
        {
            "id": id,
            "label": f"条件 {id}",
            "kind": kind,
            "required": kind == "boolean",
            "min_value": min_value,
            "unit": "年" if kind == "number" else None,
            "source": "custom",
            "category": "自由記述",
        }
    )


@pytest.fixture
def store(tmp_path: Path) -> ConditionSetStore:
    return ConditionSetStore(tmp_path / "condition_sets.json", now=Clock())


def test_missing_file_gives_an_empty_list(store: ConditionSetStore) -> None:
    assert store.list_sets() == []


def test_create_returns_the_saved_set(store: ConditionSetStore) -> None:
    saved = store.create(
        "現場監督候補", [condition("a"), condition("b", kind="number", min_value=2.5)]
    )

    assert saved.name == "現場監督候補"
    assert [c.id for c in saved.conditions] == ["a", "b"]
    assert saved.id
    assert saved.created_at == saved.updated_at
    assert store.get(saved.id) == saved


def test_saved_sets_are_listed_in_creation_order_and_survive_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "condition_sets.json"
    first_store = ConditionSetStore(path, now=Clock())
    first = first_store.create("セット A", [condition("a")])
    second = first_store.create("セット B", [condition("b")])

    restarted = ConditionSetStore(path)

    assert [s.id for s in restarted.list_sets()] == [first.id, second.id]
    assert restarted.get(second.id).conditions == second.conditions


def test_ids_are_unique(store: ConditionSetStore) -> None:
    ids = {store.create(f"セット {i}", [condition("a")]).id for i in range(20)}

    assert len(ids) == 20


def test_file_format_follows_the_spec(tmp_path: Path) -> None:
    path = tmp_path / "condition_sets.json"
    ConditionSetStore(path, now=Clock()).create("セット", [condition("a")])

    data = json.loads(path.read_text(encoding="utf-8"))

    assert data["version"] == 1
    [item] = data["sets"]
    assert set(item) == {"id", "name", "conditions", "created_at", "updated_at"}
    assert item["created_at"] == "2026-10-25T09:00:00+09:00"
    assert set(item["conditions"][0]) == {
        "id",
        "label",
        "kind",
        "required",
        "min_value",
        "unit",
        "source",
        "category",
    }


def test_update_overwrites_the_set_and_keeps_its_identity(store: ConditionSetStore) -> None:
    created = store.create("旧名", [condition("a")])

    updated = store.update(created.id, "新名", [condition("b"), condition("c")])

    assert updated.id == created.id
    assert updated.name == "新名"
    assert [c.id for c in updated.conditions] == ["b", "c"]
    assert updated.created_at == created.created_at
    assert updated.updated_at > created.updated_at
    assert store.get(created.id) == updated
    assert len(store.list_sets()) == 1


def test_update_keeps_the_position_in_the_list(store: ConditionSetStore) -> None:
    first = store.create("A", [condition("a")])
    second = store.create("B", [condition("b")])

    store.update(first.id, "A2", [condition("a")])

    assert [s.id for s in store.list_sets()] == [first.id, second.id]


def test_delete_removes_only_the_given_set(store: ConditionSetStore) -> None:
    first = store.create("A", [condition("a")])
    second = store.create("B", [condition("b")])

    store.delete(first.id)

    assert [s.id for s in store.list_sets()] == [second.id]


@pytest.mark.parametrize("operation", ["get", "update", "delete"])
def test_unknown_id_is_an_error(store: ConditionSetStore, operation: str) -> None:
    store.create("A", [condition("a")])

    with pytest.raises(ConditionSetNotFoundError):
        if operation == "get":
            store.get("missing")
        elif operation == "update":
            store.update("missing", "名前", [condition("a")])
        else:
            store.delete("missing")


@pytest.mark.parametrize("name", ["", "   ", "\n", "あ" * 101])
def test_invalid_name_is_rejected_and_nothing_is_written(tmp_path: Path, name: str) -> None:
    store = ConditionSetStore(tmp_path / "condition_sets.json")

    with pytest.raises(ValidationError):
        store.create(name, [condition("a")])

    assert list(tmp_path.iterdir()) == []


def test_name_is_trimmed_and_may_be_100_characters(store: ConditionSetStore) -> None:
    assert store.create("  セット  ", [condition("a")]).name == "セット"
    assert store.create("あ" * 100, [condition("a")]).name == "あ" * 100


def test_duplicate_condition_ids_are_rejected(store: ConditionSetStore) -> None:
    with pytest.raises(ValidationError):
        store.create("重複", [condition("a"), condition("a")])


def test_custom_conditions_with_japanese_labels_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "condition_sets.json"
    store = ConditionSetStore(path, now=Clock())
    saved = store.create("自由記述", [condition("x", kind="number", min_value=0.5)])

    loaded = ConditionSetStore(path).get(saved.id)

    assert loaded.conditions[0].label == "条件 x"
    assert loaded.conditions[0].min_value == 0.5
    assert "条件 x" in path.read_text(encoding="utf-8")


def test_timestamps_are_timezone_aware(store: ConditionSetStore) -> None:
    saved = store.create("A", [condition("a")])

    assert saved.created_at.utcoffset() == timedelta(hours=9)


def test_default_clock_gives_timezone_aware_timestamps(tmp_path: Path) -> None:
    saved = ConditionSetStore(tmp_path / "condition_sets.json").create("A", [condition("a")])

    assert saved.created_at.tzinfo is not None
    assert abs(saved.created_at - datetime.now(UTC)) < timedelta(minutes=1)


@pytest.mark.parametrize(
    "content",
    [
        "{",
        "[]",
        '{"version": 2, "sets": []}',
        '{"version": 1}',
        '{"version": 1, "sets": [{"id": "x"}]}',
        '{"version": 1, "sets": "x"}',
        "null",
    ],
)
def test_corrupted_or_unsupported_file_is_an_error(tmp_path: Path, content: str) -> None:
    path = tmp_path / "condition_sets.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(StorageCorruptedError):
        ConditionSetStore(path).list_sets()


def test_corrupted_file_is_not_overwritten_by_a_write(tmp_path: Path) -> None:
    path = tmp_path / "condition_sets.json"
    path.write_text("{ broken", encoding="utf-8")

    with pytest.raises(StorageCorruptedError):
        ConditionSetStore(path).create("A", [condition("a")])

    assert path.read_text(encoding="utf-8") == "{ broken"
