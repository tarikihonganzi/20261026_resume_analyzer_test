import { defineConfig, devices } from '@playwright/test'

// 開発中のサーバー（8000・5173）とぶつからないよう、別のポートで起動する
const apiPort = '8100'
const webPort = '5273'
const baseURL = `http://127.0.0.1:${webPort}`

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // サーバーのデータ（設定・条件セット）を共有するので、1 つずつ実行する
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node start-backend.mjs',
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { APP_API_PORT: apiPort },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // 画面は Vite 経由で開く（/api の転送と Origin の確認も、あわせて通す）
      command: 'npm run dev --prefix ../frontend',
      url: baseURL,
      env: { APP_API_PORT: apiPort, APP_WEB_PORT: webPort },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
