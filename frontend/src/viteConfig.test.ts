import { describe, expect, it } from 'vitest'
import config from '../vite.config'

describe('vite.config（開発時の API の転送）', () => {
  it('/api を、元の Host を保ったまま、バックエンドへ転送する', () => {
    // 文字列で書く（`'/api': 'http://...'`）と、changeOrigin が有効になり、Host がバックエンドの
    // ものに書き換わる。Origin は画面のままなので、バックエンドの Origin の確認で、POST・PUT・
    // DELETE が 403 になる
    const proxy = config.server?.proxy?.['/api']

    expect(proxy).toBeTypeOf('object')
    expect(proxy).toMatchObject({ target: 'http://127.0.0.1:8000', changeOrigin: false })
  })

  it('開発サーバーは 127.0.0.1 だけで待ち受ける', () => {
    expect(config.server?.host).toBe('127.0.0.1')
  })
})
