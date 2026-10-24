---
paths:
  - "backend/**"
---

# バックエンド（Python）の規則

## 全般

- Python 3.14、パッケージ管理は `uv`（`uv add` / `uv sync` / `uv run`）。`pip install` を直接使わない。依存を追加したら `uv.lock` もコミット対象に含める。
- 整形・lint は `ruff`、型検査は `pyright`。型ヒントを省略しない。
- Web 層は `async def`。**同期の重い処理（MarkItDown の変換など）は、イベントループを止めないよう `run_in_threadpool` で実行する。**
- 例外は `domain/errors.py` の型に集約し、`api/` で HTTP ステータスと利用者向けの日本語メッセージに対応づける。API キーや職歴書の内容を、例外メッセージやログに入れない。
- ログに出してよいのは、リクエスト ID、所要時間、トークン使用量、処理の段階だけ。

## LLM の出力スキーマ（`llm/schemas.py`）

- Pydantic のモデルから strict の JSON Schema を作り、`text.format` に渡す（`llm/openai_client.py`）。**全フィールドを必須にし、省略可能にしたい場合は `X | None`（`null` との union）にする**（OpenAI の strict の規則）。
- 使ってよい制約: `ge`／`le`（数値）、`min_length`／`max_length`（配列）。文字列の `min_length` は対応が不明なので使わない。
- 各フィールドの `description` は日本語で丁寧に書く。**仕様書 5.4 章の文言と一致させ、変更するときは両方を更新する。**
- スキーマを変えたら、スキーマの検査テスト（`tests/unit/test_schemas.py`）とプロンプトのゴールデンファイルを更新する。

## OpenAI の呼び出し（`llm/openai_client.py`）

- `AsyncOpenAI` を使い、`responses.create(..., text={"format": ...}, store=False, max_output_tokens=...)` で呼ぶ（`parse` は、途中で切れた応答を区別できないので使わない。計画書 5.2）。HTTP の差し替えは `httpx2`（SDK 3.x の HTTP クライアント）。タイムアウトは設定の `request_timeout_sec`。
- レスポンスの確認順: `status == "incomplete"` → `refusal` → 出力のテキストが空 → スキーマに沿ったパース → 構造の検証。どれもエラーとして扱う。
- 設定（API キー・ベース URL・モデル名）が変わったら、クライアントを作り直す。
- 出典名（元のファイル名）は `domain/source_name.py` で整形してからプロンプトに入れる。

## テスト

- `tests/unit`: 外部に依存しない。`tests/integration`: ASGI アプリと `FakeClient`、HTTP の差し替え。`tests/live`: 実 API（`-m live`）。通常の実行に含めない。
- ネットワークに出るテストを、`live` 以外に書かない。
- 非同期のテストは `pytest-asyncio`。時刻は引数で渡し（今日の日付など）、テストで固定できるようにする。
