import json
import sys
from pathlib import Path

import pytest

from app import export_openapi


def test_main_writes_the_rendered_spec_as_utf8_with_lf(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    destination = tmp_path / "nested" / "openapi.json"
    monkeypatch.setattr(sys, "argv", ["export_openapi", str(destination)])

    export_openapi.main()

    raw = destination.read_bytes()
    assert b"\r\n" not in raw
    assert raw.decode("utf-8") == export_openapi.render(export_openapi.build_spec())
    assert json.loads(raw)["info"]["title"]


def test_render_is_deterministic_and_keeps_japanese() -> None:
    spec = {"b": "条件", "a": [1]}

    text = export_openapi.render(spec)

    assert text == export_openapi.render(dict(reversed(list(spec.items()))))
    assert "条件" in text
    assert text.endswith("\n")
