// 利用時の起動: FastAPI が、ビルドしたフロント（frontend/dist）と API を、1 つのプロセスで配信する。
//
//   npm run start                    127.0.0.1 だけで待ち受ける（通常）。ポートは 8000
//   npm run start -- --port 9000     ポートを指定する（環境変数 APP_PORT でも指定できる）
//   npm run start:demo               デモモード。同じネットワークの他の PC からも開ける（仕様 10）
//   npm run start:demo -- --port 9000
//
// ポートの優先順位: `--port` ＞ 環境変数 `APP_PORT` ＞ 8000。
// npm scripts に環境変数の指定（`APP_ALLOW_REMOTE=1 …`）を書くと、cmd.exe では動かないので、
// このスクリプトで指定する。
import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demo = process.argv.includes('--demo')
const port = resolvePort(process.argv.slice(2), process.env.APP_PORT)
const host = demo ? '0.0.0.0' : '127.0.0.1'

// `--port 9000` か `--port=9000`。指定がなければ APP_PORT、それもなければ 8000。
// 数字でない値や、範囲外の値（1〜65535 以外）は、起動せずに、理由を示して終わる
function resolvePort(args, fromEnvironment) {
  const index = args.findIndex((arg) => arg === '--port' || arg.startsWith('--port='))
  let value = fromEnvironment ?? '8000'
  let source = '環境変数 APP_PORT'
  if (index !== -1) {
    value = args[index].includes('=') ? args[index].split('=')[1] : args[index + 1]
    source = '--port'
  }
  if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > 65535) {
    console.error(
      `ポート番号が正しくありません（${source}: ${String(value)}）。1〜65535 の整数で指定してください。`,
    )
    process.exit(2)
  }
  return String(Number(value))
}

// デモモードで案内する、この PC の IPv4 アドレス（ループバックは除く）
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

// uvicorn が終わったら、このスクリプトも同じ終了コードで終わる。Ctrl+C では uvicorn も止める
child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
