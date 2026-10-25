import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { renderWithProviders } from './test/render'
import { server } from './test/server'

function renderApp() {
  server.use(http.get('*/api/catalog', () => HttpResponse.json({ items: [] })))
  return renderWithProviders(<App />)
}

describe('App（画面の切り替え）', () => {
  it('既定では、評価の画面（① 条件）を開く', async () => {
    renderApp()

    expect(await screen.findByRole('region', { name: '① 条件' })).toBeInTheDocument()
  })

  it('URL のハッシュが #/settings なら、設定ページを開く', async () => {
    window.location.hash = '#/settings'
    renderApp()

    expect(await screen.findByLabelText('モデル名')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '① 条件' })).not.toBeInTheDocument()
  })

  it('「設定」と「評価に戻る」で、行き来できる。ハッシュも、それに合わせて変わる', async () => {
    renderApp()
    await screen.findByRole('region', { name: '① 条件' })

    await userEvent.click(screen.getByRole('button', { name: /設定/ }))
    expect(await screen.findByLabelText('モデル名')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/settings')

    await userEvent.click(screen.getByRole('button', { name: /評価に戻る/ }))
    expect(await screen.findByRole('region', { name: '① 条件' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
  })

  it('ブラウザの「戻る」（ハッシュの変更）にも、追随する', async () => {
    renderApp()
    await screen.findByRole('region', { name: '① 条件' })

    act(() => {
      window.location.hash = '#/settings'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(await screen.findByLabelText('モデル名')).toBeInTheDocument()
    act(() => {
      window.location.hash = '#/'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await waitFor(() => {
      expect(screen.queryByLabelText('モデル名')).not.toBeInTheDocument()
    })
  })

  it('設定ページに移っても、評価フローの入力は、消えない', async () => {
    server.use(
      http.get('*/api/catalog', () =>
        HttpResponse.json({
          items: [
            {
              id: 'q1',
              label: '1級建築施工管理技士',
              kind: 'boolean',
              unit: null,
              category: '資格',
            },
          ],
        }),
      ),
    )
    renderWithProviders(<App />)
    const group = await screen.findByRole('group', { name: '1級建築施工管理技士' })
    await userEvent.click(group.querySelector('.ant-segmented-item:nth-child(3)') as HTMLElement)
    expect(screen.getByText('必須（1）')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /設定/ }))
    await screen.findByLabelText('モデル名')
    await userEvent.click(screen.getByRole('button', { name: /評価に戻る/ }))

    expect(await screen.findByText('必須（1）')).toBeInTheDocument()
  })
})

describe('App: 評価中に設定ページへ移る', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function urlOf(input: RequestInfo | URL): string {
    if (input instanceof Request) return input.url
    return input instanceof URL ? input.href : input
  }

  it('評価の要求を取り消さず、戻ったときに、同じ評価が続いている（やり直して、費用を二重にしない）', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const original = globalThis.fetch.bind(globalThis)
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = urlOf(input)
      if (url.includes('/api/resumes/check')) {
        return Promise.resolve(
          Response.json({ format: 'docx', source_name: '田中.docx', char_count: 1234 }),
        )
      }
      if (url.includes('/api/evaluations')) {
        signals.push(init?.signal ?? undefined)
        // 応答は、終わらない（評価中のまま）
        return Promise.resolve(
          new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return original(input, init)
    })
    server.use(
      http.get('*/api/catalog', () =>
        HttpResponse.json({
          items: [
            {
              id: 'q1',
              label: '1級建築施工管理技士',
              kind: 'boolean',
              unit: null,
              category: '資格',
            },
          ],
        }),
      ),
    )
    renderWithProviders(<App />)
    const group = await screen.findByRole('group', { name: '1級建築施工管理技士' })
    await userEvent.click(group.querySelector('.ant-segmented-item:nth-child(3)') as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /次へ/ }))
    await userEvent.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement,
      new File(['x'], '田中.docx'),
    )
    await screen.findByText('1 件の書類を評価に使えます')
    await userEvent.click(screen.getByRole('button', { name: '評価する' }))
    await screen.findByText('評価しています')
    await waitFor(() => {
      expect(signals.length).toBeGreaterThan(0)
    })
    const started = signals.length

    await userEvent.click(screen.getByRole('button', { name: /設定/ }))
    await screen.findByLabelText('モデル名')

    // 設定ページを見ているあいだも、評価の要求は、取り消されない
    expect(signals.at(-1)?.aborted).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /評価に戻る/ }))

    expect(await screen.findByText('評価しています')).toBeInTheDocument()
    // 戻っても、新しい要求を、送らない
    expect(signals).toHaveLength(started)
    expect(signals.at(-1)?.aborted).toBe(false)
  })
})
