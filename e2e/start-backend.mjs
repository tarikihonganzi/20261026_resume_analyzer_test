// E2E 用のバックエンドを起動する（偽の LLM・毎回まっさらなデータ）。
// Playwright の webServer から呼ばれる。終了すると、子プロセス（uvicorn）も止める。
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '.data')
const port = process.env.APP_API_PORT ?? '8100'

// 前回の設定・条件セットが残っていると、テストの前提が崩れる
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const child = spawn(
  'uv',
  [
    'run',
    '--directory',
    resolve(here, '../backend'),
    'uvicorn',
    'app.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    port,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      APP_LLM_MODE: 'fake',
      // 進捗の表示とキャンセルを確かめられるよう、段階ごとに待つ
      APP_FAKE_DELAY_SEC: process.env.APP_FAKE_DELAY_SEC ?? '1.0',
      APP_DATA_DIR: dataDir,
      // 実際のキー・URL が環境にあっても、E2E には持ち込まない
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: '',
    },
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
