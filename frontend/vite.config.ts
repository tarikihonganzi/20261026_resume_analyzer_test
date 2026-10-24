import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 開発時は /api をバックエンドへ転送する（利用時は FastAPI が同じオリジンで配信する）
    // 文字列で書くと changeOrigin が有効になり、Host がバックエンド（127.0.0.1:8000）に書き換わる。
    // Origin は画面のまま（127.0.0.1:5173）なので、バックエンドの Origin の確認で 403 になる。
    // 元の Host を保つ（仕様 10・13.1 #20）
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
