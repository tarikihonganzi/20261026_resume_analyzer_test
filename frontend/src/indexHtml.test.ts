import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('index.html', () => {
  it('タブの名前は「マッチング評価」（「職歴書」という言葉は使わない）', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8')

    expect(html).toContain('<title>マッチング評価</title>')
    expect(html).not.toContain('職歴書')
  })
})
