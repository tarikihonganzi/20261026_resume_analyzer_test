import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { SettingsView } from '../api/types'

export const defaultSettings: SettingsView = {
  openai_api_key_masked: '****1234',
  openai_base_url: '',
  model: 'gpt-5.5',
  max_file_size_mb: 0,
}

/** 既定の応答。テストごとに `server.use(...)` で上書きする。 */
export const server = setupServer(
  http.get('*/api/settings', () => HttpResponse.json(defaultSettings)),
  http.get('*/api/catalog', () => HttpResponse.json({ items: [] })),
  http.get('*/api/condition-sets', () => HttpResponse.json({ sets: [] })),
)
