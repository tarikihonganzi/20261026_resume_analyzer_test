import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// E2E（e2e/）は、開発中のサーバーとぶつからないよう、別のポートで起動する
const apiPort = process.env.APP_API_PORT ?? '8000'
const webPort = Number(process.env.APP_WEB_PORT ?? '5173')

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    // 使用中なら、別のポートに逃げず、失敗させる（転送先・Origin の前提が崩れるため）
    strictPort: true,
    // 開発時は /api をバックエンドへ転送する（利用時は FastAPI が同じオリジンで配信する）
    // 文字列で書くと changeOrigin が有効になり、Host がバックエンド（127.0.0.1:8000）に書き換わる。
    // Origin は画面のまま（127.0.0.1:5173）なので、バックエンドの Origin の確認で 403 になる。
    // 元の Host を保つ（仕様 10・13.1 #20）
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: {
    // 同じ PC（または社内ネットワーク）から配信するので、転送量は問題にならない。警告を出さない
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // `npm run coverage` で測る。しきい値は、下回ったら失敗にして、テストが減るのを防ぐ
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // OpenAPI から生成した型（手で書いていない）
        'src/api/types.gen.ts',
        // 起動の配線だけ（React を画面に取り付ける）。ここに、ロジックは置かない
        'src/main.tsx',
      ],
      reporter: ['text-summary', 'text', 'html', 'lcov'],
      reportsDirectory: '../coverage/frontend',
      thresholds: { statements: 98, branches: 94, functions: 98, lines: 98 },
    },
  },
})
