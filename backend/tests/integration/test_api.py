"""API（ASGI）の統合テスト: カタログ・条件セット・設定・職歴書の検証。"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.domain.models import Config
from app.llm.openai_client import OpenAIClient
from fixtures import resume_factory as factory

MakeApp = Callable[..., TestClient]
API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz1234"


def condition(id: str, kind: str = "boolean", **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": id,
        "label": f"条件 {id}",
        "kind": kind,
        "required": False,
        "min_value": 3 if kind == "number" else None,
        "unit": "年" if kind == "number" else None,
        "source": "custom",
        "category": "自由記述",
        "description": None,
    }
    return base | overrides


# --- カタログ ---


def test_catalog_returns_the_presets(make_app: MakeApp) -> None:
    response = make_app().get("/api/catalog")

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 40
    description = items[0].pop("description")  # 何をその条件として数えるか（仕様 5.1）
    assert items[0] == {
        "id": "qual-kenchiku-sekou-1",
        "label": "1級建築施工管理技士",
        "kind": "boolean",
        "unit": None,
        "category": "資格・認定",
    }
    assert "1級建築施工管理技士" in description
    assert all(item["description"] for item in items[1:])


# --- 条件セット（受け入れ基準 8） ---


def test_condition_set_crud(make_app: MakeApp) -> None:
    client = make_app()
    assert client.get("/api/condition-sets").json() == {"sets": []}

    created = client.post(
        "/api/condition-sets",
        json={"name": "現場監督", "conditions": [condition("a"), condition("b", "number")]},
    )
    assert created.status_code == 201
    saved = created.json()
    assert saved["name"] == "現場監督"
    assert [c["id"] for c in saved["conditions"]] == ["a", "b"]
    assert saved["created_at"] == saved["updated_at"]

    listed = client.get("/api/condition-sets").json()["sets"]
    assert [s["id"] for s in listed] == [saved["id"]]

    updated = client.put(
        f"/api/condition-sets/{saved['id']}",
        json={"name": "現場監督（改）", "conditions": [condition("c")]},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "現場監督（改）"
    assert updated.json()["created_at"] == saved["created_at"]
    assert [c["id"] for c in updated.json()["conditions"]] == ["c"]

    assert client.delete(f"/api/condition-sets/{saved['id']}").status_code == 204
    assert client.get("/api/condition-sets").json() == {"sets": []}


def test_saved_condition_sets_survive_a_restart(make_app: MakeApp, tmp_path: Path) -> None:
    data_dir = tmp_path / "shared-data"
    saved = make_app(data_dir=data_dir).post(
        "/api/condition-sets", json={"name": "保存", "conditions": [condition("a")]}
    )

    after_restart = make_app(data_dir=data_dir).get("/api/condition-sets").json()["sets"]

    assert [s["id"] for s in after_restart] == [saved.json()["id"]]
    assert after_restart[0]["conditions"][0]["label"] == "条件 a"


@pytest.mark.parametrize("method", ["put", "delete"])
def test_unknown_condition_set_is_404(make_app: MakeApp, method: str) -> None:
    client = make_app()
    body = {"name": "x", "conditions": [condition("a")]}

    response = (
        client.put("/api/condition-sets/missing", json=body)
        if method == "put"
        else client.delete("/api/condition-sets/missing")
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"name": "", "conditions": [condition("a")]}, None),
        ({"name": "あ" * 101, "conditions": [condition("a")]}, None),
        ({"name": "重複", "conditions": [condition("a"), condition("a")]}, None),
        ({"name": "x", "conditions": [condition("a", kind="text")]}, "conditions.0.kind"),
        ({"name": "x", "conditions": [condition("a", "number", min_value=-1)]}, None),
        ({"name": "x", "conditions": [condition("a", "boolean", min_value=2)]}, None),
        ({"conditions": []}, "name"),
        ({"name": "x", "conditions": [condition("a")], "extra": 1}, "extra"),
    ],
)
def test_invalid_condition_set_is_rejected_with_the_field_names(
    make_app: MakeApp, body: dict[str, Any], field: str | None
) -> None:
    response = make_app().post("/api/condition-sets", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    if field is not None:
        assert field in response.json()["fields"]


def test_validation_errors_do_not_echo_the_input(make_app: MakeApp) -> None:
    body = {"name": "SECRET-NAME" * 20, "conditions": [condition("a")]}

    response = make_app().post("/api/condition-sets", json=body)

    assert response.status_code == 422
    assert "SECRET-NAME" not in response.text


def test_corrupted_condition_set_file_is_a_500_without_its_content(
    make_app: MakeApp, tmp_path: Path
) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "condition_sets.json").write_text('{"secret": "SECRET-CONTENT"', encoding="utf-8")

    response = make_app(data_dir=data_dir).get("/api/condition-sets")

    assert response.status_code == 500
    assert response.json()["code"] == "storage_error"
    assert "SECRET-CONTENT" not in response.text


# --- 設定（受け入れ基準 10） ---


def test_settings_default_to_the_company_endpoint(make_app: MakeApp) -> None:
    response = make_app().get("/api/settings")

    assert response.status_code == 200
    assert response.json() == {
        "openai_api_key_masked": "",
        "openai_base_url": "https://kjm-kong.kajima.co.jp/openai/v1",
        "model": "response-standard",
        "max_file_size_mb": 0,
    }


def test_saved_api_key_is_never_returned_in_full(make_app: MakeApp, tmp_path: Path) -> None:
    client = make_app()

    put = client.put("/api/settings", json={"openai_api_key": API_KEY})
    get = client.get("/api/settings")

    for response in (put, get):
        assert response.status_code == 200
        assert response.json()["openai_api_key_masked"] == "****1234"
        assert API_KEY not in response.text
        assert API_KEY[:-4] not in response.text


def test_settings_changes_apply_immediately_without_restart(make_app: MakeApp) -> None:
    client = make_app()

    client.put(
        "/api/settings",
        json={"model": "gpt-5.5-mini", "max_file_size_mb": 5, "openai_base_url": "https://x/v1"},
    )

    assert client.get("/api/settings").json() == {
        "openai_api_key_masked": "",
        "openai_base_url": "https://x/v1",
        "model": "gpt-5.5-mini",
        "max_file_size_mb": 5,
    }


def test_blank_api_key_in_an_update_keeps_the_saved_one(make_app: MakeApp) -> None:
    client = make_app()
    client.put("/api/settings", json={"openai_api_key": API_KEY})

    for blank in (None, "", "   "):
        client.put("/api/settings", json={"openai_api_key": blank, "model": "m"})
        assert client.get("/api/settings").json()["openai_api_key_masked"] == "****1234"


def test_api_key_is_saved_with_owner_only_access(
    make_app: MakeApp, tmp_path: Path, assert_owner_only: Callable[[Path], None]
) -> None:
    make_app().put("/api/settings", json={"openai_api_key": API_KEY})

    saved = tmp_path / "data" / "config.json"
    assert json.loads(saved.read_text(encoding="utf-8"))["openai_api_key"] == API_KEY
    assert_owner_only(saved)


@pytest.mark.parametrize(
    "body",
    [
        {"max_file_size_mb": -1},
        {"model": ""},
        {"pdf_detail": "low"},  # 設定ページに出さない項目は、API からは変えられない
        {"request_timeout_sec": 10},
    ],
)
def test_invalid_settings_are_rejected_and_nothing_is_written(
    make_app: MakeApp, tmp_path: Path, body: dict[str, Any]
) -> None:
    response = make_app().put("/api/settings", json=body)

    assert response.status_code == 422
    assert not (tmp_path / "data" / "config.json").exists()


def test_environment_variables_are_the_initial_values(make_app: MakeApp) -> None:
    client = make_app(environ={"OPENAI_API_KEY": API_KEY, "OPENAI_MODEL": "gpt-env"})

    body = client.get("/api/settings").json()

    assert body["openai_api_key_masked"] == "****1234"
    assert body["model"] == "gpt-env"


# --- 接続テスト ---


def test_connection_test_succeeds_with_the_values_in_the_request(make_app: MakeApp) -> None:
    response = make_app().post("/api/settings/test", json={"openai_api_key": API_KEY})

    assert response.json() == {"ok": True, "message": "接続できました。"}


def test_connection_test_without_any_key_fails_and_points_to_the_settings(
    make_app: MakeApp,
) -> None:
    body = make_app().post("/api/settings/test", json={}).json()

    assert body["ok"] is False
    assert "API キー" in body["message"]


def test_connection_test_uses_the_saved_key_when_the_request_has_none(make_app: MakeApp) -> None:
    client = make_app()
    client.put("/api/settings", json={"openai_api_key": API_KEY})

    assert client.post("/api/settings/test", json={}).json()["ok"] is True


def test_connection_test_reports_a_rejected_key(make_app: MakeApp) -> None:
    body = (
        make_app().post("/api/settings/test", json={"openai_api_key": "bad-key-0000000000"}).json()
    )

    assert body["ok"] is False
    assert "設定ページ" in body["message"]
    assert "bad-key" not in body["message"]


def test_connection_test_does_not_save_the_values(make_app: MakeApp, tmp_path: Path) -> None:
    make_app().post("/api/settings/test", json={"openai_api_key": API_KEY, "model": "m"})

    assert not (tmp_path / "data" / "config.json").exists()


def real_client(
    handler: Callable[[httpx2.Request], httpx2.Response],
) -> Callable[[Config], OpenAIClient]:
    def factory_(config: Config) -> OpenAIClient:
        return OpenAIClient(
            config,
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
            max_retries=0,
        )

    return factory_


def test_real_connection_test_sends_one_small_request_with_the_given_values(
    make_app: MakeApp,
) -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(
            200,
            json={
                "id": "r",
                "object": "response",
                "created_at": 1.0,
                "model": "m",
                "status": "completed",
                "output": [],
                "parallel_tool_calls": True,
                "tool_choice": "auto",
                "tools": [],
            },
        )

    client = make_app(llm_mode="real", openai_factory=real_client(handler))

    body = client.post(
        "/api/settings/test",
        json={
            "openai_api_key": API_KEY,
            "openai_base_url": "https://llm.example/v1",
            "model": "gpt-x",
        },
    ).json()

    assert body["ok"] is True
    [request] = seen
    assert str(request.url) == "https://llm.example/v1/responses"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    sent = json.loads(request.content)
    assert sent["model"] == "gpt-x"
    assert sent["store"] is False
    assert sent["max_output_tokens"] == 16


def test_real_connection_test_turns_a_401_into_a_message_without_the_key(
    make_app: MakeApp,
) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(401, json={"error": {"message": f"bad key {API_KEY}"}})

    client = make_app(llm_mode="real", openai_factory=real_client(handler))

    response = client.post("/api/settings/test", json={"openai_api_key": API_KEY})

    assert response.json()["ok"] is False
    assert "設定ページ" in response.json()["message"]
    assert API_KEY not in response.text


# --- 職歴書の検証（受け入れ基準 12） ---


def test_check_pasted_text(make_app: MakeApp) -> None:
    text = factory.make_text()

    response = make_app().post("/api/resumes/check", data={"text": text})

    assert response.status_code == 200
    assert response.json() == {
        "format": "text",
        "source_name": "貼り付けテキスト",
        "char_count": len(text),
    }


def test_check_an_uploaded_docx_returns_only_a_summary(make_app: MakeApp) -> None:
    response = make_app().post(
        "/api/resumes/check", files={"file": ("田中_職務経歴書.docx", factory.make_docx())}
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"format", "source_name", "char_count"}
    assert body["format"] == "docx"
    assert body["source_name"] == "田中_職務経歴書.docx"
    assert "1級建築施工管理技士" not in response.text


def test_check_a_pdf_has_no_character_count(make_app: MakeApp) -> None:
    response = make_app().post(
        "/api/resumes/check", files={"file": ("職歴書.pdf", factory.make_pdf_digital())}
    )

    assert response.json() == {"format": "pdf", "source_name": "職歴書.pdf", "char_count": None}


@pytest.mark.parametrize(
    ("filename", "content", "status", "code"),
    [
        pytest.param("resume.bin", bytes(range(256)) * 10, 422, "unsupported_format", id="bin"),
        pytest.param(
            "broken.docx", factory.make_broken_docx(), 422, "conversion_failed", id="broken"
        ),
        pytest.param("empty.docx", factory.make_empty_docx(), 422, "empty_text", id="empty"),
        pytest.param("fake.pdf", b"not a pdf" * 20, 422, "conversion_failed", id="fake-pdf"),
    ],
)
def test_unreadable_files_are_rejected_on_the_spot_with_a_japanese_message(
    make_app: MakeApp, filename: str, content: bytes, status: int, code: str
) -> None:
    response = make_app().post("/api/resumes/check", files={"file": (filename, content)})

    assert response.status_code == status
    assert response.json()["code"] == code
    assert response.json()["message"]


def test_file_over_the_limit_in_settings_is_413_with_the_limit(make_app: MakeApp) -> None:
    client = make_app()
    client.put("/api/settings", json={"max_file_size_mb": 1})

    response = client.post(
        "/api/resumes/check", files={"file": ("big.txt", b"a" * (1024 * 1024 + 1))}
    )

    assert response.status_code == 413
    assert response.json()["code"] == "file_too_large"
    assert "1 MB" in response.json()["message"]


def test_check_requires_exactly_one_of_file_and_text(make_app: MakeApp) -> None:
    client = make_app()

    neither = client.post("/api/resumes/check")
    both = client.post(
        "/api/resumes/check",
        data={"text": factory.make_text()},
        files={"file": ("a.txt", factory.make_text().encode())},
    )

    assert neither.status_code == 422
    assert neither.json()["code"] == "invalid_input"
    assert both.status_code == 422
    assert both.json()["code"] == "invalid_input"


def test_check_does_not_leave_anything_on_disk(make_app: MakeApp, tmp_path: Path) -> None:
    client = make_app()

    client.post("/api/resumes/check", files={"file": ("a.docx", factory.make_docx())})
    client.post("/api/resumes/check", data={"text": factory.make_text()})

    assert not (tmp_path / "data").exists()


# --- 補足説明（description。仕様 5.1） ---


def test_condition_set_keeps_the_description_of_custom_conditions(make_app: MakeApp) -> None:
    client = make_app()
    body = {
        "name": "補足つき",
        "conditions": [
            condition("a", description="耐震診断の報告書の作成までを数える"),
            condition("b"),
        ],
    }

    saved = client.post("/api/condition-sets", json=body).json()
    loaded = client.get("/api/condition-sets").json()["sets"][0]

    assert [c["description"] for c in saved["conditions"]] == [
        "耐震診断の報告書の作成までを数える",
        None,
    ]
    assert [c["description"] for c in loaded["conditions"]] == [
        saved["conditions"][0]["description"],
        None,
    ]


def test_condition_without_a_description_field_is_still_accepted(make_app: MakeApp) -> None:
    legacy = condition("a")
    del legacy["description"]  # description を持たない形式でも、受け付ける

    response = make_app().post(
        "/api/condition-sets", json={"name": "古い形式", "conditions": [legacy]}
    )

    assert response.status_code == 201
    assert response.json()["conditions"][0]["description"] is None


def test_too_long_description_is_rejected(make_app: MakeApp) -> None:
    response = make_app().post(
        "/api/condition-sets",
        json={"name": "長い", "conditions": [condition("a", description="あ" * 501)]},
    )

    assert response.status_code == 422
