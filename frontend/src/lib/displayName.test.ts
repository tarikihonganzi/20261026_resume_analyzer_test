import { describe, expect, it } from 'vitest'
import { displayName } from './displayName'

describe('displayName（一覧に出すファイル名）', () => {
  it('ふつうの名前は、そのまま', () => {
    expect(displayName('田中太郎_職務経歴書.pdf')).toBe('田中太郎_職務経歴書.pdf')
  })

  it('改行・タブは、空白 1 つにして、1 行にする', () => {
    expect(displayName('田中\n太郎\r\n職務\t経歴書.pdf')).toBe('田中 太郎 職務 経歴書.pdf')
  })

  it('連続する空白は、1 つにまとめる。前後の空白は除く', () => {
    expect(displayName('  a  \n\n  b.docx  ')).toBe('a b.docx')
  })

  it('行・段落の区切り（U+2028・U+2029）も、空白にする', () => {
    expect(displayName('a b c.txt')).toBe('a b c.txt')
  })

  it('ゼロ幅文字や、表示を偽装できる方向制御の文字は、取り除く', () => {
    expect(displayName('a​b‮c.txt')).toBe('abc.txt')
  })

  it('空になるときは、名称未設定', () => {
    expect(displayName('\n\t ')).toBe('名称未設定')
    expect(displayName('')).toBe('名称未設定')
  })
})
