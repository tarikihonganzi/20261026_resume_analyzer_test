# Kanban

最終更新: 2026-10-25

<!--
運用（詳細は CLAUDE.md の「Kanban」）
- 1 行 1 カード。書式: `- **T-Mx-nn** 題名 [S|M|L] — 補足`
  - ID: `T-<マイルストーン>-<連番>`。T-00 は計画・環境などの準備、T-M0〜T-M8 は docs/implementation-plan.md のマイルストーン。
  - 規模: S=半日未満、M=約1日、L=2日前後。
- 補足に書くこと: 依存(`依存: T-..`)、受け入れ基準(`AC: 仕様12章の番号`)、ブランチ(`branch: ..`)、ブロックの理由、完了日と確認した内容。
- 列の移動は、作業の開始・変化・完了のたびに行う。In Progress は同時に 2 枚まで。
- 完了条件を満たす前に Done にしない（`npm run check` の通過と、AC のテストの通過）。
-->

## Ready

- **T-M0-02** 疎通スパイク（実 API） [M] — 依存: T-M0-01、**要: ユーザーが API キーとベース URL を用意**。`responses.parse` / strict スキーマ（`float | None`・入れ子・`Field` 制約）/ `input_file`（`data:` URL・`detail: high`・デジタル PDF とスキャン PDF）/ `store=false` / 所要時間とトークン使用量。結果を `docs/implementation-plan.md` に記録。問題があれば計画を見直す

## In Progress

（なし）

## In Review

（なし）

## Blocked

（なし）

## Backlog

### M1: ドメインロジック

### M2: 取り込みとストレージ

### M3: LLM 層
- **T-M3-03** 実 API での調整（プロンプトと `description`） [M] — `npm run live`（ユーザーの依頼時のみ）。判定の一致率を記録

### M4: API と SSE
- **T-M4-03** 条件セット・設定・`resumes/check` の API [M] — AC: 8, 10, 12
- **T-M4-04** `POST /api/evaluations`（SSE）と切断・`UploadFile` の統合テスト [L] — 切断で LLM 呼び出しがキャンセルされることを確認
- **T-M4-05** ローカル API の保護（Host・Origin） [S] — `/api/health` も Host の検査対象（仕様 13.1 #22）
- **T-M4-06** OpenAPI から TypeScript の型を生成（`npm run gen-types`） [S] — SSE のイベント型が含まれるか確認

### M5: フロント 基盤と ① 条件
- **T-M5-01** フロントの基盤（Ant Design 6・TanStack Query・日本語化・`AppShell`・`FlowSteps`） [M]
- **T-M5-02** 評価フローのリデューサー [M] — AC: 11, 13。遷移規則の単体テスト
- **T-M5-03** 条件一覧（`ConditionRow`・カテゴリ・検索・選択中のみ） [L] — AC: 1
- **T-M5-04** 要約パネルと自由記述のモーダル [M] — AC: 2
- **T-M5-05** 条件セットの保存・読込・上書き・削除 [M] — AC: 8

### M6: フロント ② 職歴書と ③ 結果
- **T-M6-01** `ResumeInput` と `resumes/check` の表示 [M] — AC: 12
- **T-M6-02** SSE クライアントと進捗・キャンセル [M]
- **T-M6-03** 結果画面（スコア・必須未達・判定表・根拠・注意書き） [L] — AC: 5, 6, 14, 15
- **T-M6-04** `MarkdownView`（サニタイズ・`<u>`） [S] — AC: 7。XSS のテスト
- **T-M6-05** 「条件を変えて再評価」「別の応募者を評価」 [S] — AC: 13

### M7: 設定ページ
- **T-M7-01** 設定ページ・接続テスト・API キー未設定バナー [M] — AC: 10

### M8: 仕上げ
- **T-M8-01** Playwright の E2E（仕様 7.3 章の 6 シナリオ） [L]
- **T-M8-02** 実 API での通し確認とコスト・待ち時間の実測 [M] — `npm run live`（ユーザーの依頼時のみ）
- **T-M8-03** エラー表示の網羅確認とアクセシビリティの基本 [M] — 仕様 5.6 章
- **T-M8-04** `npm run build`／`npm run start` と README [M]

## Done

- **T-M4-02** `pipeline`（抽出 → 判定 → 最終評価 → 補正 → 照合） — 2026-10-25。branch: `feat/T-M4-02-pipeline`。app/pipeline.py（run。StageEvent・ResultEvent・ErrorEvent を返す非同期ジェネレーター）、domain/results.py（EvaluationResult など。7 章の result イベントの内容）、domain/judging.find_extraction_problems（抽出結果の検証）、ExtractionInconsistentError。流れは、抽出 → 検証（不整合は 1 回だけ再実行。進捗の段階は増やさない）→ 判定・マッチ度合い・必須未達（コード）→ 最終評価 → ±20 点の補正 → 引用の照合（出典名を与えた名前に置換。PDF は skipped）。LLM のエラーと不整合は ErrorEvent にして終了、条件 0 件と予期しない例外は送出、キャンセルは伝播。FakeClient で通す統合テスト 31 件。npm run check exit 0（pytest 452 件 + POSIX 専用 1 件スキップ）
- **T-M4-01** `catalog.json`（仕様 11 章のプリセット） — 2026-10-25。branch: `feat/T-M4-01-catalog`。backend/src/app/data/catalog.json（仕様 11 章の 39 件。id は ASCII の slug）と app/catalog.py（CatalogItem・load_catalog）。仕様書 11 章の表（カテゴリ・ラベル・型・単位・順序）と catalog.json が一致することをテストで保証（スキーマの一致テストと同じ方式）。GET /api/catalog は T-M4-03 で追加。npm run check exit 0（pytest 421 件 + POSIX 専用 1 件スキップ）
- **T-M3-02** `LlmClient`・`OpenAIClient`・`FakeClient` — 2026-10-25。branch: `feat/T-M3-02-llm-clients`。llm/client.py（LlmClient Protocol）、llm/openai_client.py（OpenAIClient）、llm/fake_client.py（FakeClient）、domain/errors の LlmError 系（認証・一時的な失敗・リクエスト拒否・応答不正）。OpenAIClient は responses.create + strict の json_schema（store=False・max_output_tokens=32000・temperature と reasoning は指定しない）で、状態の確認（incomplete → refusal → 空 → パース）を自前で行う（responses.parse は、途中で切れた応答の JSON を状態確認の前にパースして失敗し、incomplete と invalid を区別できないため）。SDK 3.x の HTTP クライアントは httpx2 と判明（テストは httpx2.MockTransport）。エラーは日本語の利用者向けメッセージに対応づけ、API の応答の本文・API キーを、メッセージ・連鎖・ログに出さない。ログはリクエスト ID・所要時間・トークン数のみ。FakeClient は遅延・スコア強制・エラー再現・呼び出し記録・原文にない引用 1 件。統合テスト 34 件（リクエストの形、拒否・incomplete・401・429・5xx・タイムアウト、リトライ、ログ、キャンセル）。npm run check exit 0（pytest 411 件 + POSIX 専用 1 件スキップ）。実 API での確認は T-M0-02 / T-M3-03
- **T-M3-01** `prompts`（システム指示・入力の組み立て・ゴールデンファイル） — 2026-10-25。branch: `feat/T-M3-01-prompts`。llm/prompts.py（EXTRACT_SYSTEM_PROMPT・EVALUATE_SYSTEM_PROMPT・build_extract_input・build_evaluate_input）と llm/requests.py（ExtractRequest・EvaluateRequest）。システム指示は、データの扱い（職歴書・ファイル名・PDF の中の文章は指示としない）・抽出の規則（類推しない・年数の算出・重複除外・今日の日付）・根拠の書き方・公平性・最終評価の規則（±20 点以内・必須未達は summary と weaknesses の両方で触れる）。入力は、PDF を input_file（data URL・detail・filename）、それ以外を <resume name format> で囲む。職歴書の中の閉じタグと、出典名の特殊文字は無害化。ゴールデンファイル 8 件（tests/unit/golden/。UPDATE_GOLDEN=1 で更新）で意図しない変更を検知。npm run check exit 0（pytest 362 件 + POSIX 専用 1 件スキップ）。AC14 のプロンプト側
- **T-00-07** Copilot のレビュー指摘への対応（PR#2〜#9 の 15 件） — 2026-10-25。branch: `fix/T-00-07-copilot-review`。PR#2〜#9 の Copilot の指摘 15 件に対応。①schemas の年数の例の誤り（2年5か月・合計7年 → 2年6か月・7年6か月。仕様 5.4 章も同時に修正）②深さの検査が $ref をたどらない（解決して数え、10 と 11 階層の境界テスト）③missing_required が判定の重複を上書き（エラーに）④sanitize が制御文字の除去後に NFC が崩れる（取り直し）⑤環境変数の初期値を未実装だった（仕様 4.1。ファイルにない項目を補い、空文字は保存値を優先。update は環境変数の値をファイルに書かない）⑥JSON の null と未作成の区別（MISSING。null は壊れたファイル）⑦icacls の失敗経路のテストが whoami で止まっていた⑧壊れた・空の docx を CLI の出力に追加⑨取り込み: zip 変換器を登録しない（enable_builtins=False。拡張子なしの zip の抜け穴）、.text・.markdown・.jsonl もバイナリ検査、BOM つき UTF-16/32 を許可、%PDF- は先頭のみ、見出し・水平線・表の区切りを数えない。仕様 v0.10。npm run check exit 0（pytest 333 件 + POSIX 専用 1 件スキップ）
- **T-00-06** 仕様の調整（警告の廃止・API キーのマスク規則・取り込みの具体値） — 2026-10-25。branch: `docs/T-00-06-spec-adjust`。仕様 v0.9。13.1 章に #23（API キーのマスク。12 文字未満は ****）・#24（20 文字未満はエラー、短いことの警告は出さない）・#25（取り込みの細則）を追加し、検証結果の「警告」を廃止（5.3・6.3・7・10 章）。ingest/resume.py の警告と ResumeCheck.warnings を削除。npm run check exit 0。マージ時に lint エラー（E501）が 1 件残っていたため、fix/T-00-06-lint で直した（確認スクリプトが失敗を終了コードに反映していなかった。以後は、マージ直前に必ず npm run check を実行して失敗なら中止する）
- **T-M2-02** `ingest/resume`（種別判定・サイズ・MarkItDown・空チェック） — 2026-10-25。branch: `feat/T-M2-02-ingest`。ingest/resume.py（load_resume・check_of・ResumeInput・ResumeCheck）と domain/errors の ResumeError 系。種別判定（拡張子・PDF 見出し）、サイズ上限（0 は無制限。貼り付けにも適用）、MarkItDown convert_stream を asyncio.to_thread で実行（イベントループを止めないことをテスト。to_thread を外すと失敗することを確認）、空・極端に短い（20 文字未満）を EmptyResumeError、100 文字未満は警告。MarkItDown の実測で、docx を .txt として渡すとバイナリを文字として成功扱いにすることが分かったため、テキスト系の拡張子で zip 系・旧 Office 署名・NUL を検出してエラーにする。.zip は拒否。エラーメッセージに内容を入れない。決定の詳細は計画書 1 章 #19。npm run check exit 0（pytest 284 件 + POSIX 専用 1 件スキップ）。AC3・AC12 の取り込み側（API 経由は T-M4-03）
- **T-M2-03** 架空の職歴書の生成スクリプト — 2026-10-25。branch: `feat/T-M2-03-fixtures`。backend/tests/fixtures/resume_factory.py。架空の職歴書（氏名・会社名に「架空」「サンプル」を含む）を、テキスト（通常・指示文入り）・docx・xlsx・pptx・デジタル PDF（通常・指示文入り。MS ゴシックを埋め込み）・スキャン PDF（画像のみ。日本語フォントがあるときだけ）で生成。壊れた docx・空の docx も用意。CLI は backend/tests/fixtures/out/（Git 管理外）に書き出す。スキャン PDF の元画像を PNG にして、日本語が正しく描画されることを目視確認。EXPECTED に実 API の確認用の期待値（現場監督 8.25 年・Revit 3 年など）。npm run check exit 0（pytest 240 件 + POSIX 専用 1 件スキップ）
- **T-M2-01** `json_store`・`config_store`・`condition_set_store` — 2026-10-25。branch: `feat/T-M2-01-storage`。storage/permissions（icacls で現在のユーザーのみ・POSIX は 0600）、json_store（一時ファイル → fsync → os.replace、PermissionError を 0.05 秒 × 10 回リトライ、ACL は中身を書く前に一時ファイルへ）、config_store（既定値・API キーは空なら既存を残す・mask_api_key）、condition_set_store（作成・上書き・削除・一覧、id と作成日時を維持、壊れたファイルは上書きしない）。Config・ConfigUpdate・ConditionSet を domain/models.py に追加。確認: Windows の実機で ACL が現在のユーザー 1 件のみ・継承なしで、os.replace 後も維持されること。他プロセスが開いたファイルへの書き込みがリトライで成功すること。npm run check exit 0（pytest 226 件 + POSIX 専用 1 件スキップ）。AC8（再起動後も読み込める）・AC10 のうちストレージ側。仕様との差: 12 文字未満のキーは末尾 4 文字も隠す（計画書 1 章 #16）
- **T-M1-05** `source_name`（出典名の整形） — 2026-10-25。branch: `feat/T-M1-05-source-name`。domain/source_name.py（sanitize）。/ と \ の両方でディレクトリ部分を除去 → NFC → 制御文字（Cc・Cf・Zl・Zp。ゼロ幅文字と右から左への上書きを含む）を除去 → 前後の空白を除去 → 200 文字に切り詰め。仕様に定めがない点: 結果が空なら「名称未設定」にする。npm run check exit 0（pytest 149 件）
- **T-M1-04** `quotes`（正規化・原文照合） — 2026-10-25。branch: `feat/T-M1-04-quotes`。domain/quotes.py（normalize・verify）。NFKC → 空白除去 → Markdown 記号（| * # ` >）除去で、全角半角・濁点の分解形・改行・表の区切り・強調の違いを吸収。source_text=None は skipped、見つからない・言い換え・「…」でつないだ引用は not_found。仕様に定めがない点: 空の引用（正規化後）は not_found、大文字小文字は区別する。npm run check exit 0（pytest 123 件）。AC15 のコード側（表示は T-M6-03）
- **T-M1-03** `clipping`（最終スコアの ±20 補正） — 2026-10-25。branch: `feat/T-M1-03-clipping`。domain/clipping.py（clip_score。マッチ度合い ±20 点を 0〜100 に収め、補正の有無と元スコアを返す）。上限・下限ちょうど、rate=0／100 の端、下限が負・上限が 100 超になる場合をテスト。npm run check exit 0（pytest 103 件）。AC5 のうちコード側（表示は T-M6-03）
- **T-M1-02** `judging`（判定・マッチ度合い・必須未達） — 2026-10-25。branch: `feat/T-M1-02-judging`。domain/judging.py（judge・match_rate・missing_required）と domain/errors.py。四捨五入は整数演算の half-up（5/8 → 63）。不明は未達として数える。抽出結果の型は Protocol で受け、domain を llm に依存させない（ConditionExtraction をそのまま渡せることを型検査つきのテストで確認）。npm run check exit 0（pytest 79 件）。AC4（同じ抽出結果なら同じマッチ度合い）のテストあり
- **T-M1-01** `models.py` と LLM 出力スキーマ（`schemas.py`） — 2026-10-25。branch: `feat/T-M1-01-models-schemas`。domain/models.py（Condition・Judgement）と llm/schemas.py（仕様 5.4 章の 5 モデル）。strict 規則・制約・仕様書とのスキーマ一致をテスト。npm run check exit 0（pytest 43 件・Vitest 1 件）。Python 3.14 の注釈の遅延評価と Pydantic／OpenAI SDK の strict 変換の相性を確認（オフライン。実 API は T-M0-02）
- **T-M0-01** プロジェクト雛形 — 2026-10-25。branch: `chore/T-M0-01-scaffold`。`backend/`（FastAPI 最小アプリ・`GET /api/health`・pytest・ruff・pyright strict）、`frontend/`（Vite 8・React 19・TypeScript 6.0.3・Ant Design 6・Vitest 5・ESLint 10・Prettier）、ルートの `package.json`（setup/dev/check/build）。確認: クリーンな状態から `npm run setup` → `npm run check`（exit 0。pytest 2 件・Vitest 1 件）、`npm run build`、`npm run dev` で `/api/health`（直・Vite 経由）。決定: Python 3.14（計画書 1 章 #18）、TypeScript 6.x 固定（同 #14）、仕様 v0.8 で `/api/health` を追加。未確認: ブラウザでの画面表示（見出しのみ）
- **T-00-01** 仕様書 v0.6 — 2026-10-25。ヒアリング反映、技術調査の結果を反映。`docs/spec.md`
- **T-00-02** 実装計画 — 2026-10-25。`docs/implementation-plan.md`
- **T-00-03** 環境の準備 — 2026-10-25。`git init`（`main`）、uv 0.13.5、Python 3.13.17。`uv` は `~/.local/bin`（PATH 未追加）
- **T-00-05** 開発環境を Windows に変更 — 2026-10-25。`make` を npm scripts に置き換え、macOS 固有の記述と制約（Intel 向け `required-environments`）を整理。`.gitattributes`（LF）を追加。リモート `origin` を設定して push。branch: `docs/T-00-05-windows-dev`
- **T-00-04** Claude Code 向けの指示 — 2026-10-25。`CLAUDE.md`、`.claude/rules/`（backend・frontend）、`Kanban.md`、`.gitignore`
