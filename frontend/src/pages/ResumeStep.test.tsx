import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { ResumeCheck } from '../api/types'
import { FlowProvider } from '../state/flow-context'
import { renderWithProviders } from '../test/render'
import { defaultSettings, server } from '../test/server'
import { FlowPage } from './FlowPage'

const catalog = [
  { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'q2', label: '2級建築士', kind: 'boolean', unit: null, category: '資格' },
]

const docxCheck: ResumeCheck = { format: 'docx', source_name: '田中.docx', char_count: 1234 }

/** ① で条件を選び、② に進んだ状態にする。 */
async function reachResumeStep(options: { keyUnset?: boolean } = {}) {
  server.use(
    http.get('*/api/catalog', () => HttpResponse.json({ items: catalog })),
    http.get('*/api/settings', () =>
      HttpResponse.json({
        ...defaultSettings,
        openai_api_key_masked: options.keyUnset ? '' : '****1234',
      }),
    ),
  )
  renderWithProviders(
    <FlowProvider>
      <FlowPage />
    </FlowProvider>,
  )
  await userEvent.click(
    within(await screen.findByRole('group', { name: '1級建築施工管理技士' })).getByText('必須'),
  )
  await userEvent.click(within(screen.getByRole('group', { name: '2級建築士' })).getByText('任意'))
  await userEvent.click(screen.getByRole('button', { name: /次へ/ }))
  await screen.findByText('評価する条件:')
}

function urlOf(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url
  return input instanceof URL ? input.href : input
}

/**
 * `/api/resumes/check` への fetch だけを、解決のタイミングを制御できる Promise に差し替える。
 * （jsdom の FormData は Node の fetch で送れず、msw で応答を遅らせると接続エラーになるため。
 * 本物のブラウザでは起きない）
 */
function controlCheckRequests() {
  const resolvers: ((response: Response) => void)[] = []
  const original = globalThis.fetch.bind(globalThis)
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = urlOf(input)
    if (!url.includes('/api/resumes/check')) return original(input, init)
    return new Promise<Response>((resolve, reject) => {
      resolvers.push(resolve)
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
  })
  return {
    resolvers,
    restore: () => {
      spy.mockRestore()
    },
  }
}

const evaluateButton = () => screen.getByRole('button', { name: '評価する' })

function checkReturns(check: ResumeCheck) {
  server.use(http.post('*/api/resumes/check', () => HttpResponse.json(check)))
}

async function uploadFile(name: string, content = 'x') {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('ファイルの入力欄がありません')
  await userEvent.upload(input, new File([content], name))
}

describe('② 職歴書', () => {
  it('選んだ条件の件数を表示し、「変更」で ① に戻れる（入力は残る）', async () => {
    await reachResumeStep()

    expect(screen.getByText('必須 1')).toBeInTheDocument()
    expect(screen.getByText('任意 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '変更' }))

    expect(await screen.findByRole('group', { name: '1級建築施工管理技士' })).toBeInTheDocument()
    expect(screen.getByText('必須（1）')).toBeInTheDocument()
  })

  it('職歴書を選ぶまでは、「評価する」を押せない', async () => {
    await reachResumeStep()

    expect(evaluateButton()).toBeDisabled()
  })

  it('ファイルを選ぶと、その場で検証して、結果（名前・形式・文字数）を表示する', async () => {
    await reachResumeStep()
    checkReturns(docxCheck)

    await uploadFile('田中.docx')

    expect(await screen.findByText('この職歴書を評価に使えます')).toBeInTheDocument()
    const result = within(screen.getByRole('alert'))
    expect(result.getByText('田中.docx')).toBeInTheDocument()
    expect(result.getByText('1234 文字')).toBeInTheDocument()
    expect(evaluateButton()).toBeEnabled()
  })

  it('PDF は、文字数を出さず、評価のときに読み取ることを案内する', async () => {
    await reachResumeStep()
    checkReturns({ format: 'pdf', source_name: '職歴書.pdf', char_count: null })

    await uploadFile('職歴書.pdf')

    expect(await screen.findByText(/評価のときに、AI が内容を読み取ります/)).toBeInTheDocument()
    expect(evaluateButton()).toBeEnabled()
  })

  it('検証中は「確認しています」を出し、まだ「評価する」を押せない', async () => {
    await reachResumeStep()
    const requests = controlCheckRequests()

    await uploadFile('田中.docx')

    expect(await screen.findByText(/を確認しています/)).toBeInTheDocument()
    expect(evaluateButton()).toBeDisabled()
    requests.resolvers[0]?.(Response.json(docxCheck))
    await screen.findByText('この職歴書を評価に使えます')
    expect(evaluateButton()).toBeEnabled()
    requests.restore()
  })

  it('読めないファイルは、その場でエラーを示し、条件が残ったまま、別のファイルを選び直せる', async () => {
    await reachResumeStep()
    server.use(
      http.post('*/api/resumes/check', () =>
        HttpResponse.json(
          { code: 'unsupported_format', message: 'このファイル形式（bin）は読み取れません。' },
          { status: 422 },
        ),
      ),
    )

    await uploadFile('壊れた.bin')

    expect(await screen.findByText('「壊れた.bin」を使えません')).toBeInTheDocument()
    expect(screen.getByText('このファイル形式（bin）は読み取れません。')).toBeInTheDocument()
    expect(evaluateButton()).toBeDisabled()

    checkReturns(docxCheck)
    await uploadFile('田中.docx')

    expect(await screen.findByText('この職歴書を評価に使えます')).toBeInTheDocument()
    expect(evaluateButton()).toBeEnabled()
  })

  it('サイズの上限を超えたときは、サーバーが返した上限の値を示す', async () => {
    await reachResumeStep()
    server.use(
      http.post('*/api/resumes/check', () =>
        HttpResponse.json(
          { code: 'file_too_large', message: 'ファイルサイズが上限（20 MB）を超えています。' },
          { status: 413 },
        ),
      ),
    )

    await uploadFile('大きい.pdf')

    expect(await screen.findByText(/上限（20 MB）/)).toBeInTheDocument()
  })

  it('テキストが得られないファイルは、「テキスト化できませんでした」を示す（仕様 5.6）', async () => {
    await reachResumeStep()
    server.use(
      http.post('*/api/resumes/check', () =>
        HttpResponse.json(
          {
            code: 'empty_text',
            message: 'テキスト化できませんでした。内容が空か、極端に短いようです。',
          },
          { status: 422 },
        ),
      ),
    )

    await uploadFile('空.docx')

    expect(await screen.findByText(/テキスト化できませんでした/)).toBeInTheDocument()
    expect(
      screen.getByText(/別のファイルを選ぶか、テキストを貼り付けてください/),
    ).toBeInTheDocument()
    expect(evaluateButton()).toBeDisabled()
  })

  it('サーバーに接続できないときも、理由を出す', async () => {
    await reachResumeStep()
    server.use(http.post('*/api/resumes/check', () => HttpResponse.error()))

    await uploadFile('田中.docx')

    expect(await screen.findByText(/サーバーに接続できませんでした/)).toBeInTheDocument()
  })

  it('テキストを貼り付けると、入力が止まってから検証する', async () => {
    await reachResumeStep()
    checkReturns({ format: 'text', source_name: '貼り付けテキスト', char_count: 300 })

    await userEvent.click(screen.getByRole('tab', { name: 'テキストを貼り付ける' }))
    await userEvent.type(
      screen.getByRole('textbox', { name: '職歴書のテキスト' }),
      '職歴の内容です。',
    )

    expect(await screen.findByText('300 文字', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(evaluateButton()).toBeEnabled()
  })

  it('テキストを全部消すと、職歴書がなくなり、「評価する」を押せなくなる', async () => {
    await reachResumeStep()
    checkReturns({ format: 'text', source_name: '貼り付けテキスト', char_count: 300 })
    await userEvent.click(screen.getByRole('tab', { name: 'テキストを貼り付ける' }))
    const box = screen.getByRole('textbox', { name: '職歴書のテキスト' })
    await userEvent.type(box, 'abc')
    await screen.findByText('300 文字', undefined, { timeout: 3000 })

    await userEvent.clear(box)

    await waitFor(
      () => {
        expect(screen.queryByText('300 文字')).not.toBeInTheDocument()
      },
      { timeout: 3000 },
    )
    expect(evaluateButton()).toBeDisabled()
  })

  it('同じ名前のファイルを選び直しても、遅れて届いた前の検証の結果を採用しない', async () => {
    await reachResumeStep()
    const requests = controlCheckRequests()

    await uploadFile('田中.docx', 'A')
    await uploadFile('田中.docx', 'B')
    await waitFor(() => {
      expect(requests.resolvers).toHaveLength(2)
    })
    // 先に B（現在）の結果が届き、そのあとで A（古い）の失敗が届く
    requests.resolvers[1]?.(Response.json({ ...docxCheck, char_count: 222 }))
    await screen.findByText('222 文字')
    requests.resolvers[0]?.(
      Response.json({ code: 'conversion_failed', message: '読み取れません' }, { status: 422 }),
    )

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.getByText('222 文字')).toBeInTheDocument()
    expect(screen.queryByText('読み取れません')).not.toBeInTheDocument()
    expect(evaluateButton()).toBeEnabled()
    requests.restore()
  })

  it('選び直すと、前のファイルの検証の要求は取り消される', async () => {
    await reachResumeStep()
    const requests = controlCheckRequests()
    const aborted: boolean[] = []
    const first = vi.mocked(globalThis.fetch)

    await uploadFile('田中.docx', 'A')
    await waitFor(() => {
      expect(requests.resolvers).toHaveLength(1)
    })
    await uploadFile('別.docx', 'B')
    await waitFor(() => {
      expect(requests.resolvers).toHaveLength(2)
    })

    const signals = first.mock.calls
      .filter(([input]) => urlOf(input).includes('/api/resumes/check'))
      .map(([, init]) => init?.signal)
    aborted.push(...signals.map((signal) => signal?.aborted ?? false))
    expect(aborted).toEqual([true, false])
    requests.restore()
  })

  it('API キーが未設定なら、「評価する」を押せない（仕様 5.6）', async () => {
    await reachResumeStep({ keyUnset: true })
    checkReturns(docxCheck)

    await uploadFile('田中.docx')
    await screen.findByText('この職歴書を評価に使えます')

    expect(evaluateButton()).toBeDisabled()
  })

  it('「戻る」で ① に戻れる', async () => {
    await reachResumeStep()

    await userEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(await screen.findByRole('group', { name: '1級建築施工管理技士' })).toBeInTheDocument()
  })

  it('① に戻って ② に進み直しても、選んだ職歴書は残っている', async () => {
    await reachResumeStep()
    checkReturns(docxCheck)
    await uploadFile('田中.docx')
    await screen.findByText('この職歴書を評価に使えます')

    await userEvent.click(screen.getByRole('button', { name: '変更' }))
    await userEvent.click(await screen.findByRole('button', { name: /次へ/ }))

    expect(await screen.findByText('この職歴書を評価に使えます')).toBeInTheDocument()
    expect(evaluateButton()).toBeEnabled()
  })

  it('「評価する」を押すと、③ に進む', async () => {
    await reachResumeStep()
    checkReturns(docxCheck)
    await uploadFile('田中.docx')
    await screen.findByText('この職歴書を評価に使えます')

    await userEvent.click(evaluateButton())

    await waitFor(() => {
      expect(screen.queryByText('評価する条件:')).not.toBeInTheDocument()
    })
  })
})
