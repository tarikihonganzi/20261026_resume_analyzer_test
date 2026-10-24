"""OpenAPI を JSON ファイルに書き出す。`npm run gen-types` から呼ぶ。

uv run --directory backend python -m app.export_openapi ../frontend/src/api/openapi.json
"""

import json
import sys
from pathlib import Path
from typing import Any

from app.main import create_app
from app.settings import AppSettings


def build_spec() -> dict[str, Any]:
    # データのディレクトリは作られない（スキーマを作るだけ）
    return create_app(AppSettings(data_dir=Path("data"), llm_mode="fake"), environ={}).openapi()


def render(spec: dict[str, Any]) -> str:
    return json.dumps(spec, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> None:
    destination = Path(sys.argv[1])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(render(build_spec()), encoding="utf-8", newline="\n")
    print(f"wrote {destination}", file=sys.stderr)


if __name__ == "__main__":
    main()
