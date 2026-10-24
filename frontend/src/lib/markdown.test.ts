import { describe, expect, it } from 'vitest'
import { sanitizeSchema } from './markdown'

describe('sanitizeSchema（許可するタグ）', () => {
  const tags = sanitizeSchema.tagNames ?? []

  it('下線の <u> と、評価の文章に使うタグを許可する', () => {
    for (const tag of ['u', 'strong', 'em', 'p', 'ul', 'ol', 'li', 'table', 'a', 'h1', 'code']) {
      expect(tags).toContain(tag)
    }
  })

  it('画像とフォームの部品を許可しない（職歴書の内容が、外部へ送られるのを防ぐ）', () => {
    for (const tag of ['img', 'picture', 'source', 'input']) {
      expect(tags).not.toContain(tag)
    }
  })

  it('実行・埋め込み・見た目の変更ができるタグを許可しない', () => {
    for (const tag of ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'link']) {
      expect(tags).not.toContain(tag)
    }
  })

  it('リンクの URL は、http・https・mailto などに限る（javascript: は許可しない）', () => {
    const protocols = sanitizeSchema.protocols?.href ?? []

    expect(protocols).toContain('https')
    expect(protocols).not.toContain('javascript')
    expect(protocols).not.toContain('data')
  })
})
