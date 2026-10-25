# 職歴書マッチング評価アプリ

採用担当者が、職歴書（PDF・Word・Excel・テキスト）を、選んだ条件（資格・スキル・経験年数）に照らして評価するローカル Web アプリ。条件ごとの有無・年数を LLM が抽出し、マッチ度合いはコードで算出し、最終スコアと根拠つきの評価文を LLM が作る。個人利用で、サーバーは状態を持たない。

## 正とする文書（必要になったときに読む。丸ごと読み込まない）

- `docs/spec.md`: **仕様書。正はこれ。** 決定事項は 13.1 章。LLM の出力スキーマは 5.4 章。
- `docs/implementation-plan.md`: 実装計画（技術選定の根拠、ディレクトリ構成、M0〜M8、テスト戦略、リスク）。
- `Kanban.md`: 作業ボード。**作業の前後で必ず更新する**（下記）。

## 最重要ルール

1. **仕様書を勝手に変えない。コードと食い違ったら、先に仕様書を直す**（下記「仕様書の更新」）。
2. **Kanban.md を、作業の開始・変化・完了のたびに更新する**（下記「Kanban」）。
3. **コミット・push・PR 作成・マージは、ユーザーが依頼したときだけ行う。** ブランチの作成と、ファイルの編集は、依頼がなくても作業の一部として行ってよい。
4. **完了を主張する前に `npm run check` を実行し、結果を示す。** 実行できない場合は、できなかったと書く。
5. **実在の個人情報を使わない。** テスト用の職歴書は、すべて架空のものを `backend/tests/fixtures` の生成スクリプトで作る。職歴書の内容をログ・ディスク・コミットに残さない。

## 仕様書の更新

- 実装中に仕様と食い違う事実（API の挙動、ライブラリの制約など）を見つけたら、**実装を先に変えず、ユーザーに報告する。** 合意後に、次の順で行う。
  1. `docs/spec.md` を更新する。`バージョン` を上げ、`ステータス` の行を更新し、判断した内容を 13.1 章（決定事項）に行として追加する。
  2. 影響する章・受け入れ基準（12 章）・`docs/implementation-plan.md`・テストを、**同じブランチで**そろえる。
  3. その後に実装する。
- 明らかな誤記・リンク切れの修正は、報告なしで直してよい。
- 章番号を変えたら、`grep -n "章\|[0-9]\.[0-9]" docs/*.md` などで参照を検索して直す。
- LLM の出力スキーマの `description` は、仕様書（5.4 章）とコード（`backend/src/app/llm/schemas.py`）の両方に存在する。**片方だけ変えない。**
- 外部サービスの仕様（OpenAI、Ant Design、FastAPI など）は、記憶ではなく公式ドキュメントで確認し、調べた日付を記録する。

## Kanban

`Kanban.md` が唯一のボード。列は Backlog / Ready / In Progress / In Review / Blocked / Done。書式はファイルの冒頭に書いてある。

- 作業を始める前に、該当カードを **In Progress** に移し、ブランチ名を書く。該当カードがなければ、Backlog に追加してから、ユーザーに確認する。
- In Progress は**同時に 2 枚まで**。
- 状態が変わるたびに更新する: レビュー待ち → In Review、止まったら → Blocked（理由を書く）、完了 → Done（日付・ブランチ・確認した内容を書く）。
- **完了条件を満たす前に Done にしない。** 完了条件は、`npm run check` の通過と、カードに書いた受け入れ基準のテストの通過。
- 作業中に見つけた別の作業は、Backlog に追加するだけにして、勝手に着手しない。
- 更新するたびに、ファイル冒頭の `最終更新` の日付を直す。
- `docs/implementation-plan.md` のマイルストーンが変わったら、Kanban も合わせる。
- Kanban.md の変更は、作業と**同じコミットに含める**。

## ブランチ戦略（GitHub Flow・短命ブランチ）

- `main` は常に `npm run check` が通る状態に保つ。`main` で直接作業しない（最初のスキャフォールドのコミットのみ例外）。
- **1 カード = 1 ブランチ = 1 マージ。** ブランチ名は `<type>/<カード ID>-<kebab-case の説明>`。例: `feat/T-M1-02-judging`、`docs/T-00-05-spec-update`。
  - `type`: `feat`、`fix`、`refactor`、`test`、`docs`、`chore`。
- ブランチは `main` から作る（`git switch -c`）。寿命は 1〜2 日を目安にし、長くなるカードは分割する。
- コミットメッセージは Conventional Commits: `type(scope): 件名`。`scope` は `backend`、`frontend`、`e2e`、`docs`、`kanban` など。件名は日本語でよい。1 コミットは 1 つの論理的な変更にする。
- マージは squash（`main` 上の履歴を、1 カード 1 コミットにする）。リモートがあれば PR（`gh pr create`）、なければローカルで `git merge --squash`。マージ前に `npm run check` が通ること、Kanban.md が Done になっていることを確認する。
- マージ後はブランチを削除する。マイルストーンが完了したら、注釈つきタグ（例: `m1-domain`）を付ける。
- 仕様変更を伴う実装は、同じブランチの**最初のコミットで仕様書を更新**する。
- 禁止: `main` への force push、`--no-verify`、確認なしの `git reset --hard` や履歴の書き換え。

## 環境（推測できないこと）

- **開発・実行環境は Windows**（2026-10-25 に macOS から変更）。シェルは Git Bash か PowerShell。`make` は使えないので、タスクの入口は npm scripts にする。パスは `/` 区切りで書く。
- macOS（Intel）は対象外。`onnxruntime`（MarkItDown → magika の依存）が 1.24.1 以降で macOS x86_64 の wheel を配布していないため。
- `uv` は Windows では `winget install --id=astral-sh.uv -e`（または公式の PowerShell インストーラー）で導入する。導入後は新しいターミナルを開いて `uv --version` で確認する。
- Python は `uv` が管理する 3.14（`uv python install 3.14`。3.15 は MarkItDown が未対応のため使わない）。Node は 24.x（Windows では `fnm install 24`。PowerShell のプロファイルに `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression` を入れる）、パッケージ管理は `npm`（pnpm・yarn は使わない）。
- 改行は LF に統一する（`.gitattributes`）。プロンプトのゴールデンファイルが、改行の違いで失敗しないようにするため。
- 社内の OpenAI API を使う。API キーとベース URL は、アプリの設定ページか環境変数で与える（コードやリポジトリに書かない）。

## コマンド（ルートの `package.json` の npm scripts。`live` は後続のカードで追加する）

- `npm run setup`: 依存の導入（ルートと `frontend/`・`e2e/` の `npm ci`、`backend/` の `uv sync`）。
- `npm run dev`: バックエンド（127.0.0.1:8000）と Vite（5173）を `concurrently` で起動。Vite が `/api` をバックエンドへ転送する。**止めるときは、`uvicorn --reload` が起動する子プロセス（Python の `multiprocessing` のワーカー）が残ることがある。残るとポートと `backend/.venv` のファイルを掴み続けるので、`Get-CimInstance Win32_Process` で親 PID を確認して止める。**
- `npm run check`: lint・型検査・単体・統合・フロントのテスト。`check:backend`（ruff・pyright・pytest）と `check:frontend`（ESLint・Prettier・tsc・Vitest）に分けて実行もできる。**ネットワークと API 費用を使わない。**
- `npm run e2e`: Playwright（偽の LLM で起動したサーバーに対して実行）。開発用とは別のポート（API 8100・Vite 5273）で、バックエンドと Vite を自動で起動・停止し、データは毎回まっさらにする。ブラウザは初回だけ `npm run install:browsers --prefix e2e` で入れる。`npm run check` には含めない。
- `npm run coverage`: カバレッジの測定（バックエンドは pytest-cov、行＋分岐。フロントは Vitest の v8）。しきい値（バックエンド 98%、フロントは文 98%・分岐 94%）を下回ると失敗する。HTML は `coverage/` に出る（Git に入れない）。`npm run check` には含めない。
- `npm run live`: 実 API のテスト。**費用がかかるので、ユーザーが依頼したときだけ実行する。**
- `npm run build`: フロントを型検査してビルドする。
- `npm run start`: ビルドして、FastAPI が画面と API を 1 プロセスで配信する（127.0.0.1:8000。`scripts/start.mjs`）。`npm run start:demo` は、他の PC からのアクセスを許す**デモモード**（0.0.0.0・`APP_ALLOW_REMOTE=1`。デモのときだけ）。
- npm scripts の中身は、`cmd.exe` でも `sh` でも動く書き方にする（`&&` と引数だけ。シェル固有の構文を避ける）。
- 単体のテストを優先して実行する（例: `uv run --directory backend pytest tests/unit/test_judging.py -q`）。全体は区切りで実行する。

## 設計上の制約（破りやすいもの）

- LLM は **Responses API** だけを使う（Assistants API は終了済み、Chat Completions は使わない）。`store=false`。`temperature` と推論負荷は指定しない。
- PDF は `input_file`（`data:application/pdf;base64,…`、`detail: high`、`filename` は元のファイル名）で LLM に直接渡す。PDF 以外は MarkItDown の `convert_stream` でテキスト化する。PDF から手元でテキストを取り出さない。
- `backend/src/app/domain/` は純粋な関数だけ。LLM・HTTP・ファイル・時刻に依存させない。LLM は `LlmClient`（Protocol）越しに呼び、テストでは `FakeClient` に差し替える。
- サーバーは状態を持たない。職歴書・評価結果をサーバーに保持しない。永続化は `data/` の 2 つの JSON ファイルだけ（データベースは使わない）。`data/` と `.env` は Git に入れない。
- API キーは、レスポンス・ログ・エラーメッセージに全文を出さない。`data/config.json` は所有者のみが読み書きできるようにする（Windows では ACL。仕様 8.1 章）。
- マッチ度合いの四捨五入は half-up。Python の `round()` は偶数丸めなので使わない。
- ローカルの API は `127.0.0.1` のみで待ち受け、`Host` と `Origin` を検査する。CORS は有効にしない。

## テスト・検証

- ドメインのロジック（判定、補正、引用照合、出典名）は、**テストを先に書く。**
- UI を変えたら、実際にブラウザで動かして確認する（`npm run dev`）。型検査とテストが通るだけでは、画面が正しいことの証明にならない。
- LLM を呼ぶ部分は、通常のテストでは `FakeClient` と HTTP の差し替えで確認し、実 API は `npm run live`（依頼時のみ）で確認する。
- バグの修正は、失敗するテストを先に書いて再現してから直す。

## 進め方

- **うまくいかないことがあっても、場当たり的に回避しない。** エラーの抑制や、回避策の積み重ねをしない。公式ドキュメント・ソース・Web 検索で原因を確認し、設計の前提が誤っていたなら、仕様書と計画を見直して（ユーザーに報告して）設計からやり直す。同じ問題を 2 回直してもだめなら、手を止めて調査と再設計に切り替える。調べた事実と日付は、仕様書・計画・Kanban に残す。
- 変更が複数ファイルにわたる、またはやり方に迷うときは、先に計画を示してユーザーの確認を取る。1 文で説明できる小さな変更は、そのまま進める。
- 決められない点は推測で進めず、`AskUserQuestion` で選択肢と推奨を示して聞く。
- 返答は日本語。コードの識別子は英語。コードのコメントは、「なぜそうするか」が自明でない箇所にだけ、日本語で書く。
- 作業の終わりには、何を変えたか・何を確認したか（コマンドと結果）・何が未確認か、を短く報告する。

## コンパクト時に残すこと

変更したファイルの一覧、In Progress のカード ID とブランチ名、直近の `npm run check` の結果、ユーザーと合意した未反映の仕様変更。
