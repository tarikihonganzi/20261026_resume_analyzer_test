// 利用時の起動: FastAPI が、ビルドしたフロント（frontend/dist）と API を、1 つのプロセスで配信する。
//
//   npm run start         127.0.0.1 だけで待ち受ける（通常）
//   npm run start:demo    デモモード。同じネットワークの他の PC からも開ける（仕様 13.1 #26）
//
// npm scripts に環境変数の指定（`APP_ALLOW_REMOTE=1 …`）を書くと、cmd.exe では動かないので、
// このスクリプトで指定する。
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demo = process.argv.includes('--demo')
const port = process.env.APP_PORT ?? '8000'
const host = demo ? '0.0.0.0' : '127.0.0.1'

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

console.log(`\n画面: http://127.0.0.1:${port}`)
if (demo) {
  console.log('\n【デモモード】同じネットワークの誰でも、このアプリを開き、設定の変更と評価')
  console.log('（API の費用がかかります）ができます。デモが終わったら、止めてください。')
  for (const address of lanAddresses()) console.log(`  他の PC から: http://${address}:${port}`)
}
console.log('')

const child = spawn(
  'uv',
  [
    'run',
    '--directory',
    resolve(root, 'backend'),
    'uvicorn',
    'app.main:app',
    '--host',
    host,
    '--port',
    port,
  ],
  {
    stdio: 'inherit',
    // デモモードは、このスクリプトの `--demo` でだけ有効にする（環境に残った値で、意図せず開かない）
    env: { ...process.env, APP_ALLOW_REMOTE: demo ? '1' : '' },
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
