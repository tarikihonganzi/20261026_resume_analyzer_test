# 職歴書マッチング評価アプリ 実装計画

- 対象仕様: [spec.md](spec.md) v0.11
- 作成日: 2026-10-25
- 調査日: 2026-10-25（公式ドキュメントとパッケージレジストリで確認。出典は末尾）

---

## 0. この計画の要点

1. **最初に「疎通スパイク」を行う。** 最大のリスクは、社内の OpenAI API が、このアプリに必要な機能（Responses API、`input_file` での PDF 入力、Structured Output）をすべて通すかどうかである。これが通らないと設計が変わる。コードを書き込む前に、1 日以内で確認する（M0）。
2. **純粋なロジックを先に作る。** スコア計算、引用の照合、ファイル名の正規化、判定は、LLM にも Web にも依存しない関数にして、テスト駆動で作る（M1）。仕様の中で最も間違えやすく、かつテストで確実に守れる部分である。
3. **LLM 呼び出しは差し替え可能にする。** `LlmClient` の抽象を挟み、本物（OpenAI）と偽物（固定の出力を返す）を切り替えられるようにする。これで、API 費用をかけずに画面から E2E までテストできる。
4. **画面は仕様どおり ① 条件 → ② 職歴書 → ③ 結果。** 状態はブラウザのメモリだけに持つ。サーバーは、LLM に取り次ぐだけの、状態を持たない構成にする。

---

## 1. 調査で分かったこと（仕様・設計への影響）

| # | 調査結果 | 影響 |
|---|---|---|
| 1 | Responses API の `input_file` で PDF を base64 で渡す場合、`file_data` は `data:application/pdf;base64,…` 形式が必要。PDF は 1 件・1 リクエストあたり 50 MB まで。API は PDF のテキストとページ画像の両方をモデルに渡す | 仕様 5.4・9 に反映済み |
| 2 | `input_file` の `detail`（`auto`／`low`／`high`）は、`auto` だと GPT-5.6 以降は `high`、それより前のモデルは `low`。GPT-5.5 は `low` 相当になるため、スキャン PDF の読み取りには `high` の明示が必要。入力トークンは増える | `detail: high` に固定（仕様の決定事項 19）。コストは M8 で実測する |
| 3 | GPT-5.5 は、コンテキスト 105 万トークン、最大出力 12.8 万トークン、推論負荷は `none`／`low`／`medium`／`high`／`xhigh`（既定は `medium`）。Structured Output と Responses API に対応。価格は入力 $5／出力 $30（100 万トークンあたり）。`temperature` の記載は公式ページになかった | 仕様どおり `temperature` と推論負荷は指定しない。リクエストが 400 になる場合に備え、M0 のスパイクで確認する |
| 4 | Structured Output（strict）は、全フィールドが必須で、省略可能にしたい場合は `null` との union にする。`additionalProperties: false` が必須。ルートはオブジェクトで `anyOf` 不可。深さ 10 階層・プロパティ 5,000 個まで。`minimum`／`maximum`／`minItems`／`maxItems`／`pattern`／`format` に対応 | `score` の範囲と配列の件数を `Field` の制約でスキーマに入れる（仕様 5.4）。`minLength` は対応が不明なので使わない |
| 5 | `client.responses.parse(..., text_format=PydanticModel)` で、`response.output_parsed` に型付きの結果が入る。拒否は `refusal` の項目として返り、`incomplete` の場合は出力が途中で切れている | 拒否・不完全・`output_parsed` なしは、すべてエラーとして扱う（仕様 9） |
| 6 | OpenAI SDK の既定タイムアウトは 10 分、自動リトライは 2 回（接続エラー・408・409・429・5xx）。`AsyncOpenAI` は非同期処理に使え、使い終わったら `close()` が必要 | タイムアウトを 180 秒に明示。クライアントはアプリ起動時に作り、終了時に閉じる |
| 7 | FastAPI は 0.135.0 以降、`fastapi.sse` の `EventSourceResponse` と `ServerSentEvent` を標準で備える。POST でも使え、15 秒ごとのキープアライブと `X-Accel-Buffering: no` を自動で付ける。切断時の挙動は公式ページに記載がない | 切断時にジェネレーターが止まり、LLM 呼び出しがキャンセルされるかを、M4 の統合テストで確認する |
| 8 | MarkItDown 0.1.9（2026-10-21）は Python 3.10 以上 3.15 未満。`convert_stream(BinaryIO, stream_info=StreamInfo(...))` は、一時ファイルを作らずメモリ上で処理する。未対応形式は `UnsupportedFormatException`、変換失敗は `FileConversionException`。「現在のプロセスの権限で I/O を行う」と警告があり、最も狭い `convert_*` を使うことが勧められている | `convert_stream` のみを使う。PDF 以外の形式の extras（`docx`／`xlsx`／`xls`／`pptx`）だけを入れる。変換は同期処理なので、スレッドプールで実行する |
| 9 | OpenAI の API は docx／xlsx などもテキスト抽出して読めるが、スプレッドシートは 1 シートあたり先頭 1,000 行まで | 非 PDF を手元で MarkItDown 変換する方針は妥当（引用の照合にも手元のテキストが要る） |
| 10 | Ant Design は 6.6.7、React 18 以上が必要。v6 では、Steps の `description` は `content` に、`labelPlacement` は `titlePlacement` に、`direction` は `orientation` に変わった（旧名は v7 で削除予定）。サイズの値は `large`／`medium`／`small` に統一された | v6 の新しい API 名で書く。日本語化は `ConfigProvider` の `locale` で行う |
| 11 | Vite 8.3.5 は Node 20.19 以上または 22.12 以上が必要。Vitest 5.0.5 は Node 22.12 以上、`eventsource-parser` 4.1.2 も Node 22.12 以上 | Node 24.x（LTS）を使えば問題なし |
| 12 | `react-markdown` 10.1.0 は ESM のみ。`rehype-raw` と `rehype-sanitize` を組み合わせて `<u>` だけ許可できる | 仕様 5.5 のとおり |
| 13 | **開発・実行環境を Windows に変更した（2026-10-25）。** `make` は Windows に標準でなく、Git Bash にも含まれない。Claude Code は、Git for Windows があれば Git Bash、なければ PowerShell でコマンドを実行する。`uv` は `winget install --id=astral-sh.uv -e` で導入できる | タスクの入口を、ルートの `package.json` の npm scripts にする（Node.js は必須なので追加の導入が要らない）。scripts は `cmd.exe` と `sh` の両方で動く書き方にする |
| 14 | TypeScript の最新が 7.0.2 で、新しい世代である。**`typescript-eslint` 8.72.0（最新）の peer 依存は `typescript >=4.8.4 <6.1.0` で、7.x に対応していない**（2026-10-25、`npm view` で確認） | **TypeScript は 6.0.x（`~6.0.3`）に固定する。** `typescript-eslint` が 7.x に対応したら移行を検討する |
| 15 | `onnxruntime`（MarkItDown → `magika` の依存）は、1.24.1 以降で macOS x86_64 の wheel を配布していない（[公式リリースノート](https://github.com/microsoft/onnxruntime/releases/tag/v1.24.1)）。`magika` は Python 3.13 で `onnxruntime>=1.21.0`（3.14 では `>=1.24.1`）とだけ指定している。macOS Intel で依存を導入しようとして、この問題で失敗した | Windows では問題にならない。macOS（Intel）は対象外とする。`uv.lock` は最新の `onnxruntime` で解決する（macOS Intel 向けに入れた `required-environments` は外した） |
| 16 | Windows では、Python の `os.chmod` は読み取り専用の属性しか変えられず、`0600` で所有者のみに制限できない（Python の公式ドキュメントの記載）。また、開いているファイルへの `os.replace` は失敗することがある | `data/config.json` の保護は ACL で行う。`json_store` の置き換えは、短い待ちを挟んだリトライを入れる。**T-M2-01 の確認結果（2026-10-25）**: [`icacls` の公式ドキュメント](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)どおり、`/inheritancelevel:r`（継承を外す）と `/grant:r *<SID>:(M)`（数字の SID は先頭に `*`）で、現在のユーザーだけに許可できた。SID は `whoami /user /fo csv /nh` で取る。`(R,W)` には削除権限がなく置き換えで失敗しうるため `(M)`（変更）にする。**ファイルを移動（`os.replace`）すると、置き換え先は移動元（一時ファイル）の ACL を持つ**ことを実機で確認したので、ACL は中身を書く前の一時ファイルに設定する。開いているファイルへの `os.replace` は PermissionError になるが、0.05 秒 × 10 回のリトライで成功する（テストで確認）。API キーのマスクは、12 文字未満の短いキーは末尾 4 文字も見せず `****` だけにする（仕様 13.1 #23 に反映済み） |
| 17 | Windows の Git の既定は、チェックアウト時に改行を CRLF にすることがある | `.gitattributes` で LF に固定する。プロンプトのゴールデンファイルのテストが、改行の違いで失敗しないようにする |
| 18 | **Python は 3.14 を使う（2026-10-25 に 3.13 から変更）。** サポート終了は 3.13 が 2029-10、3.14 が 2030-10（3.13 は既にセキュリティ修正のみ）。3.15 は 2026-10-09 に公開済みだが、MarkItDown 0.1.9 が `<3.15` のため使えない。3.13 と 3.14 で、同じ依存（`pyproject.toml`）から作ったロックの全パッケージの版が同一で、どちらもソースからのビルドなし（`uv sync --no-build`）で Windows に導入できた。FastAPI＋Pydantic（前方参照・`float \| None`・`Field` 制約）、`openai` の strict スキーマ生成、MarkItDown の `convert_stream` のスモークテストも、両方で通った。`magika` は 3.14 で `onnxruntime>=1.24.1` を要求する（Windows には wheel がある）。3.14 では注釈が遅延評価になる（PEP 649）ため、Pydantic のスキーマ生成の確認を T-M1-01 のテストに含めた。**結果（2026-10-25）: `llm/schemas.py` の全モデルが、`openai.pydantic_function_tool` による strict 変換を通り、全フィールド必須・`additionalProperties: false`・対応キーワードのみ・深さ 10 以下を満たす** | 3.14 にする。`backend/.python-version` と `requires-python`（`>=3.14,<3.15`）を直し、`uv.lock` を作り直す。他の PC にも `uv python install 3.14` で入れられる |
| 19 | **MarkItDown 0.1.9 の実測（2026-10-25、T-M2-02）**: docx・xlsx・pptx・txt・md は期待どおりテキスト化できた。Shift_JIS のテキストも正しく読めた。空の docx は 0 文字、空の xlsx は見出しの記号だけの 15 文字になる。壊れた docx は `FileConversionException`、未知のバイナリは `UnsupportedFormatException`。**拡張子を信じるため、docx を `.txt` として渡すと、バイナリを文字として「成功」扱いにする**。`.pdf` の見出しがない内容を `.docx` として渡すと、そのまま文字として返す。拡張子なしでも magika が内容から推測して変換できる | `ingest/resume` で次のように補う。（1）ファイルの先頭に `%PDF-1.x`／`%PDF-2.x` の見出しがあれば、拡張子が違っても PDF として扱う（`.pdf` のときだけ、先頭 1024 バイト以内の行頭でも可）。（2）拡張子が `.pdf` なのに見出しがなければエラー。（3）テキスト系の拡張子（`.text`・`.markdown`・`.jsonl` を含む）で、zip 系・旧 Office の署名や、BOM のない NUL バイトがあればエラー（BOM のある UTF-16／UTF-32 は正常なテキストとして受け付ける）。（4）使う変換器を、docx・xlsx・xls・pptx・csv・html・テキストに限って登録し（`enable_builtins=False`）、zip の変換器は拡張子に関わらず使わない（Copilot のレビューで、拡張子なしの zip が内容の推測で zip 変換器に回る抜け穴を指摘された。2026-10-25）。（5）空チェックは、空白・Markdown の記号・見出し行・水平線・表の区切りを除いて 20 文字未満をエラーとする（MarkItDown は空のシートでもシート名を見出しにするため）。短いことへの警告は出さない（仕様 13.1 #24）。（6）貼り付けテキストにも、ファイルと同じサイズ上限を UTF-8 のバイト数で適用する（仕様 13.1 #25） |

---

## 2. 技術スタックとバージョン

2026-10-25 時点の最新版を確認した。実際の版は `uv.lock` と `package-lock.json` で固定する。

### バックエンド

| 項目 | 選択 | 備考 |
|---|---|---|
| Python | 3.14 | `uv` で管理。MarkItDown は 3.10 以上 3.15 未満（上限）。選定の根拠は 1 章 #18 |
| パッケージ管理 | `uv` | ロックファイルで固定 |
| Web | FastAPI 0.162.0（0.135.0 以降が必要）、`uvicorn[standard]` | |
| LLM | `openai` 3.37.0（非同期クライアント） | |
| スキーマ | Pydantic 2.14.1 | |
| ファイル変換 | `markitdown[docx,xlsx,xls,pptx]` 0.1.9 | PDF の extra は入れない（PDF は LLM に直接渡し、手元でのテキスト抽出は行わない。10 章参照） |
| アップロード受信 | `python-multipart` | |
| テスト | `pytest` 9.1.1、`pytest-asyncio`、`httpx`（ASGI テスト）、`httpx2.MockTransport`（OpenAI SDK の HTTP の差し替え） | |
| テスト用ファイル生成 | `python-docx`、`openpyxl`、`reportlab`（または `fpdf2`）、`Pillow` | 架空の職歴書を生成する。実在の個人情報は使わない |
| Lint・整形 | `ruff` 0.17.2 | |
| 型検査 | `pyright` | |

### フロントエンド

| 項目 | 選択 | 備考 |
|---|---|---|
| Node | 24.x（LTS） | |
| パッケージ管理 | `npm` | |
| タスクの入口 | ルートの `package.json` の npm scripts | `make` は Windows で使えないため。`concurrently` で開発サーバーの同時起動を行う |
| ビルド | Vite 8.3.5、`@vitejs/plugin-react` 6.1.2 | |
| UI | React 19.3.1、TypeScript（6.0.3 に固定。7.x は `typescript-eslint` が非対応。1 章 #14）、Ant Design 6.6.7、`@ant-design/icons` 6 | |
| サーバー状態 | `@tanstack/react-query` 5.104.5 | 条件セット・設定・プリセットの取得と更新に使う |
| 評価フローの状態 | React の `useReducer` + Context | 外部の状態管理ライブラリは入れない |
| SSE の受信 | `fetch` + `eventsource-parser` 4.1.2（`eventsource-parser/stream`） | `EventSource` は POST を使えないため |
| Markdown | `react-markdown` 10.1.0、`remark-gfm`、`rehype-raw`、`rehype-sanitize` | |
| API の型 | `openapi-typescript`（FastAPI の OpenAPI から生成） | SSE のイベント型を生成できるかは 9 章のリスク R7 |
| テスト | Vitest 5.0.5、`@testing-library/react`、`jsdom`、`msw` 2、`@playwright/test` 1.64.1 | |
| Lint・整形 | ESLint（flat config、`typescript-eslint`、`react-hooks`）、Prettier | |

### 実行形態

- **開発時**: `uvicorn --reload`（127.0.0.1:8000）と Vite（5173）を起動する。Vite の開発サーバーが `/api` をバックエンドへ転送する。
- **利用時**: `npm run build` でフロントをビルドし、FastAPI が `frontend/dist` を静的ファイルとして配信する。**1 つのプロセス**（`npm run start`）で、ブラウザから `http://127.0.0.1:8000` を開くだけで使える。

---

## 3. ディレクトリ構成

```
20261023_appliation_check/
├── package.json              # タスクの入口（npm scripts）: setup / dev / check / build / start / e2e / live / gen-types
├── .gitattributes            # 改行を LF に固定
├── README.md
├── .gitignore                # data/, .env, node_modules, .venv, dist など
├── data/                     # 実行時に作られる（Git 管理外）
│   ├── config.json           # 設定（所有者のみアクセス可）
│   └── condition_sets.json   # 保存済みの条件セット
├── docs/
│   ├── spec.md
│   └── implementation-plan.md
├── backend/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/app/
│   │   ├── main.py           # create_app()：ルーター、ミドルウェア、静的配信
│   │   ├── settings.py       # 実行時の設定（データディレクトリ、LLM のモード）
│   │   ├── api/
│   │   │   ├── security.py   # Host／Origin の検査
│   │   │   ├── health.py     # GET /api/health（死活確認）
│   │   │   ├── catalog.py
│   │   │   ├── condition_sets.py
│   │   │   ├── settings_api.py
│   │   │   ├── resumes.py    # POST /api/resumes/check
│   │   │   └── evaluations.py# POST /api/evaluations（SSE）
│   │   ├── domain/           # 純粋なロジック（外部に依存しない）
│   │   │   ├── models.py     # Condition, Judgement, EvaluationResult など
│   │   │   ├── judging.py    # 条件の判定、マッチ度合い、必須未達
│   │   │   ├── clipping.py   # 最終スコアの補正
│   │   │   ├── quotes.py     # 引用の正規化と原文照合
│   │   │   ├── source_name.py# 出典名（ファイル名）の整形
│   │   │   └── errors.py
│   │   ├── llm/
│   │   │   ├── schemas.py    # Quote, ConditionExtraction, ExtractionResult, EvaluatedPoint, FinalEvaluation
│   │   │   ├── prompts.py    # システム指示と入力の組み立て
│   │   │   ├── client.py     # LlmClient（Protocol）
│   │   │   ├── openai_client.py
│   │   │   └── fake_client.py# テスト・E2E 用
│   │   ├── ingest/
│   │   │   └── resume.py     # 種別判定、サイズ検査、MarkItDown 変換、空チェック
│   │   ├── pipeline.py       # 抽出 → 判定 → 最終評価 → 補正 → 照合（非同期ジェネレーター）
│   │   ├── storage/
│   │   │   ├── json_store.py # 原子的な書き込み、所有者のみの権限
│   │   │   ├── config_store.py
│   │   │   └── condition_set_store.py
│   │   └── data/catalog.json # 建築業界向けプリセット（仕様 11 章）
│   └── tests/
│       ├── unit/             # domain, schemas, prompts, storage, ingest
│       ├── integration/      # API（ASGI）、SSE、切断、UploadFile
│       ├── live/             # 実 API（-m live。通常は実行しない）
│       └── fixtures/         # 架空の職歴書と、その生成スクリプト
├── frontend/
│   ├── package.json
│   ├── vite.config.ts        # /api の転送、テスト設定
│   ├── eslint.config.js
│   └── src/
│       ├── main.tsx / App.tsx
│       ├── api/              # client.ts, sse.ts, types.gen.ts
│       ├── state/            # flow-reducer.ts, flow-context.tsx
│       ├── pages/            # ConditionsStep, ResumeStep, ResultStep, SettingsPage
│       ├── components/       # 下記 6 章
│       ├── lib/              # markdown schema、年数の表示など
│       └── test/             # セットアップ、msw のハンドラー
└── e2e/                      # Playwright（偽の LLM で起動したサーバーに対して実行）
```

---

## 4. アーキテクチャ

### 4.1 データの流れ

```
ブラウザ（状態はメモリのみ）            FastAPI（状態を持たない）             OpenAI
 ① 条件 ── ② 職歴書を選ぶ
        └─ POST /api/resumes/check ──▶ 形式・サイズ・変換可否・空を検証
                                      （内容は保持せず結果だけ返す）
 「評価する」
  POST /api/evaluations ─────────────▶ ingest：PDF はそのまま／他は MarkItDown
  （multipart: file or text,            │
   conditions JSON）                    ├─ SSE: stage=extracting ─▶ 抽出（Structured Output）──▶
                                        │      ◀── ExtractionResult ◀──────────────────────────
                                        ├─ judging（コード）：判定・マッチ度合い・必須未達
                                        ├─ SSE: stage=scoring ─▶ 最終評価（Structured Output）─▶
                                        │      ◀── FinalEvaluation ◀───────────────────────────
                                        ├─ clipping（コード）：スコアを ±20 に補正
                                        ├─ quotes（コード）：引用の原文照合
                                        └─ SSE: result
 ③ 結果を表示 ◀──────────────────────
```

### 4.2 層の分け方

- `domain/` は純粋関数のみ。LLM・HTTP・ファイルを知らない。単体テストが速く、確実に書ける。
- `llm/` は LLM との境界。`LlmClient` の Protocol に `extract(...)` と `evaluate(...)` を定義し、`OpenAIClient` と `FakeClient` が実装する。
- `pipeline.py` は上の 2 つを組み合わせる。入力は「職歴書、出典名、条件、LLM クライアント、設定」、出力は「イベントの非同期ジェネレーター」。HTTP を知らないので、API なしでテストできる。
- `api/` は薄く保つ。入力の検証、SSE への変換、エラーの対応づけだけを行う。

### 4.3 `LlmClient` の抽象

```python
class LlmClient(Protocol):
    async def extract(self, request: ExtractRequest) -> ExtractionResult: ...
    async def evaluate(self, request: EvaluateRequest) -> FinalEvaluation: ...
```

- `ExtractRequest` と `EvaluateRequest` に、職歴書（`ResumeInput`：PDF のバイト列、または出典名つきのテキスト）、今日の日付、条件、（評価の場合）判定結果とマッチ度合いを持たせる。
- `OpenAIClient` は、1 回の評価ごとではなく、起動時に作った `AsyncOpenAI` を使い回す。ただし API キー・ベース URL・モデル名は設定ページで変わるため、**設定が変わったらクライアントを作り直す**（設定の更新時に差し替える）。
- `FakeClient` は、環境変数 `APP_LLM_MODE=fake` のときだけ有効。固定の抽出結果と評価を返し、遅延も再現できる（進捗表示のテスト用）。**既定では無効**で、本番の起動では使えないようにする。

---

## 5. バックエンドの設計

### 5.1 主な関数・規則（仕様との対応）

| 対象 | 仕様 | 内容 |
|---|---|---|
| `judging.judge(conditions, extraction)` | 5.4 ステップ 2 | `boolean`: `has_skill is True` なら達成、`False` なら未達、`None` なら不明。`number`: `years is None` は不明、`years >= min_value` なら達成、それ以外は未達。不明は未達として数える |
| `judging.match_rate(judgements)` | 5.4 ステップ 2 | 達成数 ÷ 全条件数 × 100 を**四捨五入（half-up）**で整数にする。**Python の `round()` は偶数丸め**（62.5 → 62）なので使わない。条件が 0 件の場合はエラー |
| `judging.missing_required(...)` | 5.4 ステップ 2 | 必須条件のうち、未達・不明のもの |
| `clipping.clip_score(score, rate)` | 5.4 ステップ 3 | `lo = max(rate − 20, 0)`、`hi = min(rate + 20, 100)` にクリップ。補正したかを返す |
| `quotes.normalize(s)` | 5.4 共通ルール | NFKC → 空白・改行の除去 → Markdown 記号（`\|`、`*`、`#`、バッククォート、`>`）の除去 |
| `quotes.verify(quote, source_text)` | 同上 | `match`／`not_found`／`skipped`。`source_text` が `None` なら `skipped` |
| `source_name.sanitize(filename)` | 同上 | ディレクトリ部分を除去（`/` と `\` の両方）→ NFC → 制御文字の除去 → 200 文字に切り詰め |
| `ingest.resume.check(...)` | 5.3 | 種別判定、サイズ上限、MarkItDown での変換可否、空・極端に短い場合のエラー |
| `pipeline.run(...)` | 5.4 | イベント（`stage`／`result`／`error`）を順に生成。切断（キャンセル）時は `finally` で後始末 |

### 5.2 LLM 呼び出し（OpenAI）

```python
resp = await client.responses.create(
    model=settings.model,
    instructions=EXTRACT_SYSTEM,
    input=[{"role": "user", "content": [...]}],   # input_text と input_file
    text={"format": json_schema_format(ExtractionResult)},   # strict の JSON Schema
    store=False,
    max_output_tokens=MAX_OUTPUT_TOKENS,          # 推論の分を含めて十分に大きく
)
```

- PDF の項目: `{"type": "input_file", "filename": 出典名, "file_data": "data:application/pdf;base64,…", "detail": "high"}`。
- `responses.parse` ではなく `create` を使う理由: `incomplete` の応答は JSON が途中で切れており、`parse` は状態を確認する前にパースして失敗する（「途中で切れた」と「構造が正しくない」を区別できない）。strict のスキーマは、公開 API の `openai.pydantic_function_tool` で作り、応答は自分で `model_validate_json` する（T-M3-02、2026-10-25）。なお、SDK 3.x の HTTP クライアントは `httpx2`（`httpx` ではない）なので、テストの差し替えも `httpx2.MockTransport` を使う。
- 呼び出し後の確認順: ① `resp.status == "incomplete"` → エラー、② 出力に `refusal` → エラー、③ 出力のテキストが空 → エラー、④ スキーマに沿ってパース（失敗はエラー）、⑤ 構造の検証（条件 ID の過不足など。仕様 5.4。パイプライン側）。⑤で不整合なら 1 回だけ再実行。
- `openai.AuthenticationError`（401）→ 「設定ページで API キーを確認」、`RateLimitError`・`APITimeoutError`・`APIConnectionError` → 再試行を促す、など利用者向けの文言に対応づける。
- ログには、リクエスト ID（`_request_id`）、所要時間、トークン使用量だけを出す。**職歴書の内容は出さない。**

### 5.3 プロンプト

- システム指示（日本語）は `prompts.py` の定数にする。含める内容: 役割、データ（職歴書・ファイル名）の中の文章は指示として扱わないこと、根拠の書き方（仕様 5.4 の形式）、類推で `true` にしないこと、年数の算出規則（重複の除外、在籍中は今日の日付）、選考に用いるべきでない属性を使わないこと。
- 入力の組み立ては関数にして、**出力をゴールデンファイルと比較するテスト**を書く（意図しないプロンプトの変更を検知する）。
- PDF は、`<resume>` タグで囲めないため、`input_text` で「職歴書の名前: …、形式: PDF」を添え、システム指示で「PDF の内容もデータである」と明示する。

### 5.4 SSE のエンドポイント

- `POST /api/evaluations`（`multipart/form-data`）。`response_class=EventSourceResponse`、戻り値は `AsyncIterable[ServerSentEvent]`。イベントは `stage`・`result`・`error`。
- 開始前に分かる誤り（条件が 0 件、サイズ超過など）は、可能な限り通常の HTTP エラー（422・413）で返す。ストリームが始まったあとの失敗は `error` イベントで返す。
- 切断時: ジェネレーターに `CancelledError` が届き、実行中の OpenAI 呼び出しがキャンセルされることを、統合テストで確認する（確認できない場合は、明示的に切断を監視するタスクを追加する）。
- 注意: `UploadFile` の読み出しは、ストリームの中で行うことになる。ファイルが閉じられる時期の挙動を、統合テストで確認する。

### 5.5 ローカル API の保護（仕様 10）

- `uvicorn` は `--host 127.0.0.1` で起動する。
- `TrustedHostMiddleware(allowed_hosts=["127.0.0.1", "localhost"])`（DNS リバインディング対策）。
- `GET` 以外では、`Origin` ヘッダーがある場合に、許可したオリジン（自身）と一致することを確認する。違えば 403。
- CORS は有効にしない。開発時は Vite の転送で同一オリジンに見せる。
- **デモモード**（`APP_ALLOW_REMOTE=1`。仕様 13.1 #26）: `--host 0.0.0.0` で起動し、`Host` の検査だけを外す（`Origin` の確認は残す）。素の ASGI ミドルウェア（`api/security.py`）の引数で切り替える。起動時に警告をログに出す。コマンドは `npm run start:demo`（T-M8-04）。通常の `dev`・`start` は、127.0.0.1 のまま。

### 5.6 ストレージ

- `json_store`: 同じディレクトリの一時ファイルに書いて `os.replace` する。新規作成時に所有者のみに制限する（POSIX は 0600、Windows は ACL。リスク R14）。`os.replace` が失敗したときは、短い待ちを挟んで数回リトライする。読み書きはロックで直列化する（1 プロセス前提）。
- `config_store`: 環境変数を初期値にし、保存した値を優先。`GET` は API キーをマスクして返す。`PUT` は API キー欄が未入力なら既存の値を残す。
- `condition_set_store`: `version` フィールドを持たせ、将来の形式変更に備える。ID は UUID。

---

## 6. フロントエンドの設計

### 6.1 状態（`useReducer`）

```ts
type FlowState = {
  step: 0 | 1 | 2                       // ① 条件 ② 職歴書 ③ 結果
  selections: ConditionSelection[]      // { condition, mode: 'off'|'optional'|'required', minValue? }
  customConditions: Condition[]
  resume: { kind: 'file' | 'text', file?: File, text?: string, name: string, check?: CheckResult } | null
  evaluation: { status: 'idle'|'running'|'done'|'error', stage?: 'extracting'|'scoring', result?: Result, error?: ApiError }
}
```

- 画面の遷移規則（仕様 6.2）はリデューサーに集約し、**純粋関数としてテストする**。
- サーバー側の状態（プリセット、条件セット、設定）は TanStack Query に任せる。

### 6.2 コンポーネント

| 領域 | コンポーネント |
|---|---|
| 枠 | `AppShell`（ヘッダー・歯車アイコン・API キー未設定バナー）、`FlowSteps`（Steps。`items[].content` に要約を出す） |
| ① 条件 | `ConditionSetBar`（読込・保存）、`ConditionFilters`（検索・カテゴリ・選択中のみ）、`ConditionList`（カテゴリごとにグルーピング）、`ConditionRow`（Segmented と InputNumber）、`SelectionSummary`（右の要約パネル）、`CustomConditionModal` |
| ② 職歴書 | `ResumeInput`（ドラッグ＆ドロップ、貼り付け）、`ResumeCheckResult`、`ConditionsBadge`（件数と「変更」） |
| ③ 結果 | `ProgressView`（抽出中 → 最終評価中、キャンセル）、`ScoreCard`、`RequiredAlert`、`JudgementTable`、`PointList`、`EvidenceView`（根拠・引用・照合バッジ）、`MarkdownView`、`Disclaimer` |
| 設定 | `SettingsPage`（API キーのマスク表示、接続テスト） |

### 6.3 重要な実装上の規則

- **SSE の受信**: `fetch` で `POST`、`res.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())` で読む。キャンセルは `AbortController`。HTTP エラー（422・413 など）は、ストリームに入る前の JSON として読む。
- **Markdown**: `rehypePlugins = [rehypeRaw, [rehypeSanitize, schema]]`。`schema` は `defaultSchema` に `u` を追加したもの。引用（`quotes[].text`）は Markdown として解釈せず、プレーンテキストで表示する。
- **条件の ID**: プリセットは `catalog.json` の固定の ID、自由記述は `crypto.randomUUID()`。
- **Ant Design 6**: 新しい API 名を使う（Steps の `content`・`titlePlacement`・`orientation`）。ConfigProvider で日本語（`ja_JP`）を指定する。
- **年数の入力**: `InputNumber`（`min=0`、`step=0.5`、`precision=1`）。表示は小数第 1 位。
- **ファイル名**: ブラウザから送る `File.name` をそのまま送る（サーバーで NFC に正規化する）。

---

## 7. テスト戦略

### 7.1 方針

- LLM の出力は決定的でないため、**「コードで確定できる部分を厚く」「LLM の部分は契約（スキーマ・検証）と、実 API での少数のスモーク」** に分ける。
- 通常の `npm run test` は、ネットワークを使わず、API 費用もかからない。実 API のテストは `-m live`（手動）。
- テスト用の職歴書はすべて**架空**で、`tests/fixtures` の生成スクリプトで作る。

### 7.2 バックエンド

| 層 | 対象 | 主なケース |
|---|---|---|
| 単体 | `judging` | boolean／number の達成・未達・不明、`years` ちょうどが最低値、0.5 刻み、全達成・全未達、**62.5 → 63 の四捨五入**、条件 0 件のエラー、必須未達の抽出 |
| 単体 | `clipping` | 範囲内、上限・下限での補正、`rate=0` と `rate=100` の端、補正フラグ |
| 単体 | `quotes` | 全角・半角、空白・改行の違い、表の `\|` 区切りをまたぐ引用、見つからない引用、`source_text=None` で `skipped` |
| 単体 | `source_name` | `/` と `\` を含むパス、NFD → NFC（`ガ` が分解された形）、制御文字・改行、200 文字超、空のファイル名 |
| 単体 | `schemas` | Pydantic のモデルから生成した JSON Schema が、OpenAI の strict の規則（全フィールド必須、`additionalProperties: false`、深さ）を満たすこと。`score` の 0〜100、配列の件数が JSON Schema に出ていること |
| 単体 | `prompts` | 入力の組み立て結果をゴールデンファイルと比較（出典名・今日の日付・条件・タグの囲み）。PDF と非 PDF と貼り付けの 3 通り |
| 単体 | `storage` | 原子的な書き込み、`os.replace` 失敗時のリトライ、所有者のみの権限、破損ファイルの扱い、API キーのマスク、未入力のキーは既存を残す |
| 単体 | `ingest` | docx／xlsx／pptx／テキストの変換、空・短すぎる、未対応形式、サイズ上限（0 は無制限）、PDF の判定 |
| 統合 | API（ASGI） | `health`（200 と `{"status": "ok"}`）、`resumes/check`、条件セットの CRUD、設定の取得・更新・接続テスト（OpenAI をモック）、Host／Origin の拒否、条件 0 件で 422 |
| 統合 | `pipeline` + `FakeClient` | 正常系のイベント順（`stage` → `stage` → `result`）、構造不整合で再実行、再実行後も不整合でエラー、LLM のエラーごとの `error` の内容 |
| 統合 | SSE | 実際の HTTP で、`UploadFile` を読みながらストリームが流れること、**切断で LLM 呼び出しがキャンセルされること** |
| 統合 | `OpenAIClient` | `httpx2.MockTransport` で HTTP を差し替え、リクエストの形（`input_file` の `data:` URL、`detail`、`filename`、`store=false`、`text.format` の strict スキーマ）と、拒否・`incomplete`・401・429 の扱いを確認 |
| 実 API | `-m live` | ① 接続スパイク（M0）、② 架空の職歴書（PDF・docx・xlsx・貼り付け・スキャン PDF）で、期待する判定が出るか（`has_skill`、`years` の許容範囲、根拠に出典名が入るか、引用が原文に存在するか）。結果は合否ではなく**一致率**で見る |

### 7.3 フロントエンド

| 層 | 対象 | 主なケース |
|---|---|---|
| 単体 | リデューサー | 遷移の規則（完了済みのみ戻れる、未到達に飛べない、評価中は戻れない）、「別の応募者」で職歴書だけ破棄、「条件を変えて再評価」 |
| 単体 | `lib` | Markdown のサニタイズ（`<script>`・`onerror` は除去、`<u>`・太字は保持）、年数の表示 |
| コンポーネント | `ConditionRow` | Segmented の切り替え、`number` 型は「使わない」以外で入力欄が出る、未入力の検証 |
| コンポーネント | `SelectionSummary` | 必須・任意の分類と件数 |
| コンポーネント | `CustomConditionModal` | 追加・編集・削除、プリセットは編集不可 |
| コンポーネント | `EvidenceView` | 引用の展開、`not_found`／`skipped` の注意表示 |
| コンポーネント | `ResultStep` | 補正の表示（元スコア → 補正後）、必須未達のアラート、「不明」と「未達」の区別、注意書き |
| 統合 | SSE クライアント | `msw` でイベントを流し、`stage` の更新、`result`、`error`、キャンセル、HTTP 422 を確認 |
| E2E | Playwright | 偽の LLM で起動したサーバーに対して、受け入れ基準（仕様 12 章）の主要な流れを通す（下記） |

**E2E のシナリオ**

1. 条件を選び（必須・任意・年数・自由記述）、保存し、再読み込み後に読み込む。
2. 職歴書をアップロードして評価し、結果（スコア・判定表・根拠・Markdown の太字と下線）が表示される。
3. 読めないファイルを入れるとその場でエラーになり、条件が残ったまま別のファイルを選べる。
4. 「別の応募者を評価」で条件が残り、職歴書の入力から続けられる。
5. 設定ページで API キーを変更し、接続テストが成功と失敗の両方を表示する。
6. 評価中にキャンセルできる。

### 7.4 受け入れ基準（仕様 12 章）との対応

| 受け入れ基準 | 主な検証 |
|---|---|
| 1 条件選択と評価の実行 | E2E 2、コンポーネント（`ConditionRow`） |
| 2 自由記述の条件 | コンポーネント、E2E 1 |
| 3 PDF・docx・xlsx・貼り付け・スキャン PDF | 統合（`ingest`）、実 API ② |
| 4 同じ抽出結果なら同じマッチ度合い | 単体（`judging`） |
| 5 ±20 点の補正と表示 | 単体（`clipping`）、コンポーネント（`ResultStep`） |
| 6 必須未達の明示 | コンポーネント、E2E 2 |
| 7 Markdown の描画 | 単体（サニタイズ）、E2E 2 |
| 8 条件セットの保存・読込 | 単体（`storage`）、E2E 1 |
| 9 職歴書が残らない | 統合（処理後に一時ファイルとデータディレクトリを確認） |
| 10 設定ページ | 統合（API）、E2E 5 |
| 11 Steps の状態と戻り | 単体（リデューサー）、E2E |
| 12 アップロード直後の検証 | 統合、E2E 3 |
| 13 続けて別の応募者 | 単体（リデューサー）、E2E 4 |
| 14 全項目の根拠・出典名 | 統合（`OpenAIClient` と `FakeClient`）、実 API ② |
| 15 「原文で確認できず」の表示 | 単体（`quotes`）、コンポーネント（`EvidenceView`） |

### 7.5 CI 相当

GitHub などの CI は使わず、`npm run check`（lint・型検査・単体・統合・フロントのテスト）をローカルのコミット前に実行する。E2E（`npm run e2e`）と実 API（`npm run live`）は手動で実行する。

---

## 8. 実装フェーズ

規模は S（半日未満）／M（約 1 日）／L（2 日前後）の目安。1 人で進める場合の、おおまかな見積もりである。

### M0: 土台と疎通スパイク（M）

目的: 開発環境を整え、**社内 OpenAI API で必要な機能が通ることを最初に確認する**。

- `uv` のインストール、Python 3.14 の用意。`git init`、`.gitignore`。
- `backend/` と `frontend/` の雛形、ルートの `package.json`（npm scripts）、`.gitattributes`、ruff・pyright・ESLint・Prettier・pytest・Vitest の設定。
- **スパイクのスクリプト**（`backend/tests/live/spike_connectivity.py`）で次を確認する。
  1. 設定した `base_url`・モデル（`gpt-5.5`）で `responses.parse` が通る。`temperature` を指定しなくて問題ない。
  2. `Quote`／`ConditionExtraction`／`ExtractionResult` のスキーマ（`float | None`、入れ子、`Field` の制約）が strict で受け付けられる。
  3. `input_file`（`data:` URL、`filename`、`detail: high`）で、**デジタル PDF とスキャン PDF** を読める。
  4. `store=false` が通る。
  5. 所要時間とトークン使用量（PDF ありで、抽出と最終評価のそれぞれ）。
- TypeScript 7 と周辺ツール（typescript-eslint など）の対応を確認する。

完了条件: スパイクの結果が記録され、`npm run check` が空のプロジェクトで通る。**スパイクで問題が出た場合は、ここで計画を見直す**（例: 社内 API が `input_file` を通さない → 手元で PDF を画像またはテキストに変換して渡す設計に変更）。

### M1: ドメインロジック（L）

- `judging`・`clipping`・`quotes`・`source_name` を、テストを先に書いて実装する（7.2 の単体テスト）。
- `models.py`（Condition などの型）と `schemas.py`（LLM の出力スキーマ）。スキーマの検査テストも含める。

完了条件: ドメインの単体テストがすべて通る。LLM・Web に依存するコードがない。

### M2: 職歴書の取り込みとストレージ（M）

- `ingest/resume.py`（種別判定、サイズ上限、MarkItDown の `convert_stream`、スレッドプールでの実行、空チェック、例外の対応づけ）。
- `json_store`・`config_store`・`condition_set_store`。
- 架空の職歴書を生成するスクリプト（docx・xlsx・pptx・テキスト・デジタル PDF・スキャン PDF）。

完了条件: `ingest` と `storage` の単体テストが通る。

### M3: LLM 層（L）

- `prompts.py`、`client.py`（Protocol）、`openai_client.py`、`fake_client.py`。
- リクエストの形とエラー処理の統合テスト（HTTP を差し替え）。
- ゴールデンファイルのテスト。
- 実 API のテスト（`-m live`）で、架空の職歴書に対する抽出と最終評価を確認する。**ここで、プロンプトと `description` の文言を調整する。**

完了条件: 偽のクライアントでパイプラインを通せる。実 API で、判定の一致率と根拠（出典名・引用）が目標に達している（目標値は M3 の開始時に決める。目安は、デジタル文書の `boolean` 判定で 90％以上）。

### M4: API と SSE（M）

- `pipeline.py`、`api/*`、`security.py`、`main.py`（ルーター、静的配信、起動時のクライアント作成と終了時の `close`）。
- 統合テスト（7.2）。特に、**切断でのキャンセル**と **`UploadFile` + SSE**。
- OpenAPI から TypeScript の型を生成する流れ（`npm run gen-types`）。SSE のイベント型が生成物に含まれるかを確認する。

完了条件: `curl` と統合テストで、条件と職歴書を送ると SSE で結果が返る。

### M5: フロント 基盤と ① 条件（L）

- Vite・Ant Design 6・TanStack Query・日本語化の設定、`AppShell`、`FlowSteps`、リデューサー。
- ① の画面一式: 条件の一覧（カテゴリ・検索・選択中のみ）、`ConditionRow`、`SelectionSummary`、`CustomConditionModal`、`ConditionSetBar`（保存・読込・上書き・削除）。
- コンポーネントとリデューサーのテスト。

完了条件: 条件を選んで保存・読込でき、「次へ」の有効条件が仕様どおり。

### M6: フロント ② 職歴書と ③ 結果（L）

- `ResumeInput`（ドラッグ＆ドロップ、貼り付け）、`resumes/check` の呼び出し、検証結果の表示。
- SSE クライアント、`ProgressView`、キャンセル。
- 結果画面: `ScoreCard`、`RequiredAlert`、`JudgementTable`、`PointList`、`EvidenceView`、`MarkdownView`、`Disclaimer`。
- 「条件を変えて再評価」「別の応募者を評価」。

完了条件: 偽の LLM のサーバーで、通しの操作ができ、結果の表示がすべてそろう。

### M7: 設定ページ（S）

- `SettingsPage`（API キーのマスク表示と変更、ベース URL、モデル名、最大ファイルサイズ、接続テスト）。
- API キー未設定のバナーと、設定ページへの誘導。設定の更新後にクライアントを作り直す。

完了条件: 画面から設定を変えて、再起動なしで次の評価に反映される。

### M8: 仕上げ（L）

- Playwright の E2E（7.3 のシナリオ）。
- 実 API で通しの動作確認（実在しない職歴書）。**トークン使用量とコストを実測**する（`detail: high` の影響）。待ち時間が長ければ、最適化の候補（仕様 13.1 の決定事項 12 のとおり、プロンプトキャッシュは対象外。推論負荷の調整など）を相談する。
- エラー表示の網羅確認（仕様 5.6）、アクセシビリティの基本（キーボード操作、ラベル）。
- `npm run build`・`npm run start` の確認、`README.md`（セットアップ、起動、設定、テストの実行方法）。

完了条件: 受け入れ基準（仕様 12 章）の全項目が、7.4 の対応表どおりに確認できる。

### 依存関係

```
M0 ─┬─ M1 ── M3 ── M4 ─┬─ M6 ── M8
    ├─ M2 ─────────────┘   │
    └─ M5 ─────────────────┘   M7 は M4 の後、M8 の前
```

M1 と M2 と M5 は並行して進められる（フロントの M5 は、API の型が必要になる M4 までは、手書きの型で進める）。

---

## 9. リスクと対策

| # | リスク | 影響 | 対策 |
|---|---|---|---|
| R1 | 社内 OpenAI API が、Responses API の一部（`input_file`、`text_format`、`store=false`）を通さない | 設計の大幅な変更 | **M0 で最初に確認**。通らない場合は、PDF を手元で画像・テキストに変換して渡す設計を検討する |
| R2 | strict の Structured Output で、スキーマ（`float \| None`、入れ子、`Field` の制約）が拒否される | LLM 呼び出しの失敗 | M0 のスパイクで確認。拒否された制約は外し、コード側の検証に移す |
| R3 | `detail: high` の PDF でトークン・時間・費用が想定より大きい（1 回の評価で PDF を 2 回送る） | 待ち時間・コスト | M0 と M8 で実測。`pdf_detail` を設定ファイルで切り替え可能にしてある。必要なら推論負荷を調整 |
| R4 | LLM の判定が揺れる（`temperature` を指定できない） | 同じ職歴書で結果が変わる | 構造化出力と根拠の必須化で品質を保つ。実 API の一致率で確認し、必要ならプロンプトを調整。マッチ度合いはコード算出なので、抽出結果が同じなら同じ |
| R5 | 引用の照合で誤判定（表の抽出結果が崩れるなど） | 「原文で確認できず」の誤表示 | 正規化を単体テストで厚くする。表示は「注意」にとどめ、断定しない（仕様どおり） |
| R6 | `UploadFile` が大きいファイルを一時領域に書き出す、またはストリーム中に閉じられる | 仕様 8.2 との差、実行時エラー | M4 の統合テストで確認。仕様は「処理後に残らない」に修正済み |
| R7 | SSE のイベント型を OpenAPI から生成できない | 型の二重管理 | 生成できない場合は、イベントの型だけ手書きし、Pydantic のモデルとの整合を確認するテストを 1 つ置く |
| R8 | 切断時に LLM 呼び出しがキャンセルされない | 不要な API 費用 | M4 で確認。されない場合は切断監視のタスクを追加 |
| R9 | Vite の開発用転送で SSE が詰まる | 開発時に進捗が出ない | M4 以降で確認。問題があれば開発時だけバックエンドに直接接続する |
| R10 | TypeScript 7 と周辺ツールの非互換 | 開発環境の不具合 | M0 で確認し、非互換なら 6.x に下げる |
| R11 | Ant Design 6 と jsdom のテストの相性（`matchMedia` など） | コンポーネントテストの失敗 | テストのセットアップで補う |
| R12 | `make` などの Unix 前提のツールを使うと、Windows で動かない | 開発・実行の手順が壊れる | タスクの入口を npm scripts にし、`cmd.exe` と `sh` の両方で動く書き方にする。スクリプト内でシェル固有の構文を使わない |
| R13 | Windows でしか確認できない挙動（パス、改行、ファイルのロック）の不具合を、macOS 上では見つけられない | 手戻り | 開発と動作確認は Windows で行う（macOS では行わない）。改行は `.gitattributes` で LF に固定 |
| R14 | Windows では `0600` で所有者のみに制限できない | API キーを保存するファイルの保護が弱くなる | ACL（`icacls` など）で継承を外して現在のユーザーのみに許可する。T-M2-01 で公式ドキュメントを確認して実装し、テストで確認する |
| R15 | 開いているファイルへの `os.replace` が Windows で失敗する（ウイルス対策ソフトなどが掴むことがある） | 設定・条件セットの保存失敗 | 短い待ちを挟んだリトライを `json_store` に入れ、単体テストで確認する |

---

## 10. 確認事項（2026-10-25 に決定済み）

1. **PDF の引用照合**: 行わない。PDF から手元でテキストを取り出すと、OCR の手法が LLM と異なり表記揺れが生じ、誤った「原文で確認できず」が増えるため。PDF の引用は「未照合」のままとする（`markitdown[pdf]` は入れない）。
2. **PDF の `detail: high`**: `high` に固定する。M0 と M8 で費用を実測し、重ければ `data/config.json` の `pdf_detail` で切り替える。
3. **開発環境**: `git init`（ブランチ `main`）は完了した。**開発・実行環境は Windows に変更する**（2026-10-25）。当初の macOS（Intel）での導入（`uv` の入手など）は、Windows に移したため使わない。Windows では `winget install --id=astral-sh.uv -e` で `uv` を導入し、`uv python install 3.14` で Python を用意する。コミットは、ユーザーが依頼したときにだけ行う。
4. **Python の版**: 3.13 から **3.14 に変更する**（2026-10-25、ユーザーの承認）。根拠は 1 章 #18。

---

## 11. 出典

- OpenAI: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[File inputs](https://developers.openai.com/api/docs/guides/file-inputs)、[GPT-5.5 モデルページ](https://developers.openai.com/api/docs/models/gpt-5.5)、[openai-python README](https://github.com/openai/openai-python)、[`ResponseInputFileParam`](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_input_file_param.py)
- FastAPI: [Server-Sent Events](https://fastapi.tiangolo.com/tutorial/server-sent-events/)、[`fastapi/sse.py`](https://github.com/fastapi/fastapi/blob/master/fastapi/sse.py)
- MarkItDown: [PyPI](https://pypi.org/project/markitdown/)、[README](https://github.com/microsoft/markitdown)、[`_markitdown.py`](https://github.com/microsoft/markitdown/blob/main/packages/markitdown/src/markitdown/_markitdown.py)
- Python: [サポート期間（Python Developer's Guide）](https://devguide.python.org/versions/)、[What's New in 3.14](https://docs.python.org/3/whatsnew/3.14.html)、PyPI の [markitdown](https://pypi.org/project/markitdown/) と [magika](https://pypi.org/project/magika/) の `requires_python`・`requires_dist`（いずれも 2026-10-25 に確認）
- Ant Design: [v6 への移行](https://ant.design/docs/react/migration-v6)
- パッケージのバージョン: [PyPI](https://pypi.org/)（openai、fastapi、pydantic、ruff、pytest、markitdown）、[npm レジストリ](https://registry.npmjs.org/)（antd、vite、react、react-markdown、@tanstack/react-query、vitest、@vitejs/plugin-react、typescript、@playwright/test、eventsource-parser）
