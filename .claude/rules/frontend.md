---
paths:
  - "frontend/**"
  - "e2e/**"
---

# フロントエンド（React + TypeScript）の規則

## 全般

- React 19、TypeScript、Vite、パッケージ管理は `npm`。ESLint（`react-hooks` を含む）と Prettier に従う。`any` を使わない。
- サーバー状態（プリセット、条件セット、設定）は TanStack Query。評価フローの状態は `useReducer` + Context。外部の状態管理ライブラリを足さない。
- 画面の遷移規則（完了済みのステップにのみ戻れる、評価中は戻れない、など。仕様 6.2 章）は、リデューサーに集約し、**純粋関数としてテストする。**
- ステップ順は **① 条件 → ② 職歴書 → ③ 結果**。職歴書の現物はブラウザの画面状態にだけ持ち、再評価のたびに送り直す。

## Ant Design 6

- **v6 の新しい API 名を使う。** Steps は `items[].content`（`description` ではない）、`titlePlacement`、`orientation`。サイズは `large`／`medium`／`small`。`*Style`／`*ClassName` ではなく `styles.*`／`classNames.*`。
- 日本語化は `ConfigProvider` の `locale`（`ja_JP`）。
- 年数の入力は `InputNumber`（`min=0`、`step=0.5`、`precision=1`）。表示は小数第 1 位。

## SSE の受信（`src/api/sse.ts`）

- `fetch` で POST し、`res.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())` で読む（`EventSource` は POST を使えない）。
- キャンセルは `AbortController`。ストリームに入る前の HTTP エラー（422・413 など）は JSON として読む。
- イベントは `stage`・`result`・`error`。型は OpenAPI からの生成物（`types.gen.ts`）を使う。手で書き直さない。

## Markdown の表示

- `react-markdown` + `remark-gfm` + `rehype-raw` + `rehype-sanitize`。サニタイズの設定は `defaultSchema` に `u` を足したものだけ。**これ以上、許可するタグを増やさない。**
- 引用（`quotes[].text`）は Markdown として解釈せず、プレーンテキストで表示する。
- XSS のテスト（`<script>`、`onerror` が除去されること、`<u>` と太字が残ること）を、`lib/` の単体テストに必ず置く。

## テスト

- Vitest + Testing Library。API は `msw` で差し替える。Ant Design は jsdom で `matchMedia` などの補完が要る。補完はテストのセットアップに置く。
- E2E（Playwright）は、`APP_LLM_MODE=fake` で起動したサーバーに対して実行する。実 API を使わない。
- UI を変えたら、`make dev` で実際に開いて確認する。
