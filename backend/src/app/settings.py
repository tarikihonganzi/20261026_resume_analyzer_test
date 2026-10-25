"""実行時の設定（データの置き場所、LLM のモード）。環境変数から読む。

アプリの設定（API キーなど）は、`data/config.json`（storage/config_store.py）。ここにあるのは、
サーバーの起動時に決まる設定だけ。
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

# backend/src/app/settings.py → リポジトリのルート
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class AppSettings:
    data_dir: Path
    # fake は、テスト・E2E 用の偽の LLM（環境変数 APP_LLM_MODE=fake のときだけ。既定は real）
    llm_mode: Literal["real", "fake"] = "real"
    fake_delay_sec: float = 0.0
    # デモモード。他の PC からのアクセスを許す（Host の検査を外す。仕様 10）
    allow_remote: bool = False
    # ビルドしたフロント（frontend/dist）。あれば、同じオリジンで配信する。なければ API だけ
    static_dir: Path | None = None
    # ログの出力先（`YYYY-MM-DD.log` を置くディレクトリ）。None のときは、ファイルに書かない。
    # テストなどで、意図せず、リポジトリの log/ に書かないよう、既定は None
    # （実際の起動の既定は、from_env が決める）
    log_dir: Path | None = None
    log_level: str = "INFO"

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> AppSettings:
        env = os.environ if environ is None else environ
        mode = env.get("APP_LLM_MODE", "real")
        if mode not in ("real", "fake"):
            raise ValueError("APP_LLM_MODE は real か fake を指定してください")
        return cls(
            data_dir=Path(env["APP_DATA_DIR"])
            if "APP_DATA_DIR" in env
            else _REPOSITORY_ROOT / "data",
            llm_mode=mode,
            fake_delay_sec=float(env.get("APP_FAKE_DELAY_SEC", "0")),
            # 公開範囲を変える設定なので、仕様どおり 1 のときだけ有効にする（true・yes などは無効）
            allow_remote=env.get("APP_ALLOW_REMOTE", "").strip() == "1",
            static_dir=Path(env["APP_STATIC_DIR"])
            if "APP_STATIC_DIR" in env
            else _REPOSITORY_ROOT / "frontend" / "dist",
            # `data/` と同じ階層の `log/`
            log_dir=Path(env["APP_LOG_DIR"]) if "APP_LOG_DIR" in env else _REPOSITORY_ROOT / "log",
            log_level=env.get("APP_LOG_LEVEL", "INFO").strip().upper() or "INFO",
        )
