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
- **T-M1-03** `clipping`（最終スコアの ±20 補正） [S] — AC: 5
- **T-M1-04** `quotes`（正規化・原文照合） [M] — AC: 15
- **T-M1-05** `source_name`（出典名の整形） [S] — NFC・パス除去・制御文字・200 文字

### M2: 取り込みとストレージ
- **T-M2-01** `json_store`・`config_store`・`condition_set_store` [M] — AC: 8, 10。原子的書き込み（Windows のファイルロックによる `os.replace` の失敗に備えたリトライ）・所有者のみの権限（POSIX は 0600、Windows は ACL。方法は公式ドキュメントで確認）・API キーのマスク
- **T-M2-02** `ingest/resume`（種別判定・サイズ・MarkItDown・空チェック） [M] — AC: 3, 12。`convert_stream` をスレッドプールで実行
- **T-M2-03** 架空の職歴書の生成スクリプト [M] — docx・xlsx・pptx・テキスト・デジタル PDF・スキャン PDF。実在の個人情報は使わない

### M3: LLM 層
- **T-M3-01** `prompts`（システム指示・入力の組み立て・ゴールデンファイル） [M] — AC: 14
- **T-M3-02** `LlmClient`・`OpenAIClient`・`FakeClient` [L] — リクエストの形・拒否・incomplete・401・429 の統合テスト
- **T-M3-03** 実 API での調整（プロンプトと `description`） [M] — `npm run live`（ユーザーの依頼時のみ）。判定の一致率を記録

### M4: API と SSE
- **T-M4-01** `catalog.json`（仕様 11 章のプリセット） [S]
- **T-M4-02** `pipeline`（抽出 → 判定 → 最終評価 → 補正 → 照合） [M]
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

- **T-M1-02** `judging`（判定・マッチ度合い・必須未達） — 2026-10-25。branch: `feat/T-M1-02-judging`。domain/judging.py（judge・match_rate・missing_required）と domain/errors.py。四捨五入は整数演算の half-up（5/8 → 63）。不明は未達として数える。抽出結果の型は Protocol で受け、domain を llm に依存させない（ConditionExtraction をそのまま渡せることを型検査つきのテストで確認）。npm run check exit 0（pytest 79 件）。AC4（同じ抽出結果なら同じマッチ度合い）のテストあり
- **T-M1-01** `models.py` と LLM 出力スキーマ（`schemas.py`） — 2026-10-25。branch: `feat/T-M1-01-models-schemas`。domain/models.py（Condition・Judgement）と llm/schemas.py（仕様 5.4 章の 5 モデル）。strict 規則・制約・仕様書とのスキーマ一致をテスト。npm run check exit 0（pytest 43 件・Vitest 1 件）。Python 3.14 の注釈の遅延評価と Pydantic／OpenAI SDK の strict 変換の相性を確認（オフライン。実 API は T-M0-02）
- **T-M0-01** プロジェクト雛形 — 2026-10-25。branch: `chore/T-M0-01-scaffold`。`backend/`（FastAPI 最小アプリ・`GET /api/health`・pytest・ruff・pyright strict）、`frontend/`（Vite 8・React 19・TypeScript 6.0.3・Ant Design 6・Vitest 5・ESLint 10・Prettier）、ルートの `package.json`（setup/dev/check/build）。確認: クリーンな状態から `npm run setup` → `npm run check`（exit 0。pytest 2 件・Vitest 1 件）、`npm run build`、`npm run dev` で `/api/health`（直・Vite 経由）。決定: Python 3.14（計画書 1 章 #18）、TypeScript 6.x 固定（同 #14）、仕様 v0.8 で `/api/health` を追加。未確認: ブラウザでの画面表示（見出しのみ）
- **T-00-01** 仕様書 v0.6 — 2026-10-25。ヒアリング反映、技術調査の結果を反映。`docs/spec.md`
- **T-00-02** 実装計画 — 2026-10-25。`docs/implementation-plan.md`
- **T-00-03** 環境の準備 — 2026-10-25。`git init`（`main`）、uv 0.13.5、Python 3.13.17。`uv` は `~/.local/bin`（PATH 未追加）
- **T-00-05** 開発環境を Windows に変更 — 2026-10-25。`make` を npm scripts に置き換え、macOS 固有の記述と制約（Intel 向け `required-environments`）を整理。`.gitattributes`（LF）を追加。リモート `origin` を設定して push。branch: `docs/T-00-05-windows-dev`
- **T-00-04** Claude Code 向けの指示 — 2026-10-25。`CLAUDE.md`、`.claude/rules/`（backend・frontend）、`Kanban.md`、`.gitignore`
