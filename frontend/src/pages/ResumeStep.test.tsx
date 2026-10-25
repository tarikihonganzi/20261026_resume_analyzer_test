import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResumeCheck } from '../api/types'
import { FlowProvider } from '../state/flow-context'
import { renderWithProviders } from '../test/render'
import { defaultSettings, server } from '../test/server'
import { FlowPage } from './FlowPage'

const catalog = [
  { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'q2', label: '2級建築士', kind: 'boolean', unit: null, category: '資格' },
]

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

const okResponse = (name: string): Response =>
  Response.json({ format: 'docx', source_name: name, char_count: 1234 } satisfies ResumeCheck)

const errorResponse = (code: string, message: string, status = 422): Response =>
  Response.json({ code, message }, { status })

interface CheckRequest {
  name: string
  signal: AbortSignal | undefined
  respond: (response: Response) => void
}

/**
 * `/api/resumes/check` への fetch だけを、テストから制御できるものに差し替える。
 * 既定では、ファイル名ごとに即座に成功を返す。`hold` を指定すると、応答を保留して、あとで返せる。
 * （jsdom の FormData は Node の fetch で送れず、msw で応答を遅らせると接続エラーになるため。
 * 本物のブラウザでは起きない）
 */
function stubChecks(
  options: { hold?: boolean; reply?: (name: string) => Response | Promise<Response> } = {},
) {
  const requests: CheckRequest[] = []
  const original = globalThis.fetch.bind(globalThis)
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (!urlOf(input).includes('/api/resumes/check')) return original(input, init)
    const form = init?.body as FormData
    const file = form.get('file')
    const name = file instanceof File ? file.name : '貼り付けテキスト'
    if (!options.hold) {
      return Promise.resolve(options.reply ? options.reply(name) : okResponse(name))
    }
    return new Promise<Response>((resolve, reject) => {
      requests.push({ name, signal: init?.signal ?? undefined, respond: resolve })
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
  })
  return { requests }
}

afterEach(() => {
  vi.restoreAllMocks()
})

const evaluateButton = () => screen.getByRole('button', { name: '評価する' })
const list = () => screen.queryByRole('region', { name: 'アップロード済みの職歴書' })
const listNames = () =>
  within(screen.getByRole('region', { name: 'アップロード済みの職歴書' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.ant-typography')?.textContent)

async function uploadFiles(...names: string[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('ファイルの入力欄がありません')
  await userEvent.upload(
    input,
    names.map((name) => new File(['x'], name)),
  )
}

describe('② 職歴書', () => {
  describe('見出し・戻る', () => {
    it('選んだ条件の件数を、タグではなく、ふつうの文で出し、「変更」で ① に戻れる（入力は残る）', async () => {
      await reachResumeStep()

      expect(screen.getByText('必須 1 件・任意 1 件')).toBeInTheDocument()
      expect(document.querySelector('.ant-tag')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: '変更' }))

      expect(await screen.findByRole('group', { name: '1級建築施工管理技士' })).toBeInTheDocument()
      expect(screen.getByText('必須（1）')).toBeInTheDocument()
    })

    it('「戻る」で ① に戻れる', async () => {
      await reachResumeStep()

      await userEvent.click(screen.getByRole('button', { name: '戻る' }))

      expect(await screen.findByRole('group', { name: '1級建築施工管理技士' })).toBeInTheDocument()
    })
  })

  describe('アップロード済みの一覧', () => {
    it('職歴書を選ぶまでは、一覧がなく、「評価する」を押せない', async () => {
      await reachResumeStep()

      expect(list()).toBeNull()
      expect(evaluateButton()).toBeDisabled()
    })

    it('ファイルを選ぶと、その場で検証し、名前を一覧に並べる（形式・文字数は出さない）', async () => {
      stubChecks()
      await reachResumeStep()

      await uploadFiles('田中.docx')

      expect(await screen.findByText('1 件の職歴書を評価に使えます')).toBeInTheDocument()
      expect(listNames()).toEqual(['田中.docx'])
      expect(screen.getByText('アップロード済みの職歴書（1 / 5）')).toBeInTheDocument()
      expect(screen.queryByText(/文字/)).not.toBeInTheDocument()
      expect(screen.queryByText(/形式/)).not.toBeInTheDocument()
      expect(evaluateButton()).toBeEnabled()
    })

    it('複数のファイルを、まとめても、続けても、追加できる', async () => {
      stubChecks()
      await reachResumeStep()

      await uploadFiles('職務経歴書.pdf', '履歴書.docx')
      await uploadFiles('別紙.xlsx')

      expect(await screen.findByText('3 件の職歴書を評価に使えます')).toBeInTheDocument()
      expect(listNames()).toEqual(['職務経歴書.pdf', '履歴書.docx', '別紙.xlsx'])
      expect(screen.getByText('アップロード済みの職歴書（3 / 5）')).toBeInTheDocument()
    })

    it('削除ボタンで、1 件だけ取り除ける。0 件になると、評価できない', async () => {
      stubChecks()
      await reachResumeStep()
      await uploadFiles('a.pdf', 'b.docx')
      await screen.findByText('2 件の職歴書を評価に使えます')

      await userEvent.click(screen.getByRole('button', { name: 'a.pdfを削除' }))

      expect(listNames()).toEqual(['b.docx'])
      expect(await screen.findByText('1 件の職歴書を評価に使えます')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'b.docxを削除' }))
      expect(list()).toBeNull()
      expect(evaluateButton()).toBeDisabled()
    })

    it('検証中は、その書類に「確認中…」を出し、まだ「評価する」を押せない', async () => {
      const checks = stubChecks({ hold: true })
      await reachResumeStep()

      await uploadFiles('田中.docx')

      expect(await screen.findByText('確認中…')).toBeInTheDocument()
      expect(evaluateButton()).toBeDisabled()
      checks.requests[0]?.respond(okResponse('田中.docx'))
      await screen.findByText('1 件の職歴書を評価に使えます')
      expect(screen.queryByText('確認中…')).not.toBeInTheDocument()
      expect(evaluateButton()).toBeEnabled()
    })

    it('名前が長くても、改行を含んでいても、1 行で出す（全文はホバー）', async () => {
      stubChecks()
      await reachResumeStep()
      const long = `${'長い名前'.repeat(40)}.docx`

      await uploadFiles('田中\n太郎の\r\n職務経歴書.docx', long)

      await screen.findByText('2 件の職歴書を評価に使えます')
      expect(listNames()).toEqual(['田中 太郎の 職務経歴書.docx', long])
      expect(
        screen.getByRole('button', { name: '田中 太郎の 職務経歴書.docxを削除' }),
      ).toBeInTheDocument()
    })
  })

  describe('使えない書類', () => {
    it('読めないファイルは、一覧の中で、理由を示す。条件は残り、削除すると、評価できる', async () => {
      stubChecks({
        reply: (name) =>
          name === '壊れた.bin'
            ? errorResponse('unsupported_format', 'このファイル形式（bin）は読み取れません。')
            : okResponse(name),
      })
      await reachResumeStep()

      await uploadFiles('田中.docx', '壊れた.bin')

      expect(
        await screen.findByText('使えません: このファイル形式（bin）は読み取れません。'),
      ).toBeInTheDocument()
      expect(listNames()).toEqual(['田中.docx', '壊れた.bin'])
      expect(evaluateButton()).toBeDisabled()
      expect(screen.getByText(/使えない職歴書を削除すると、評価できます/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: '壊れた.binを削除' }))

      expect(await screen.findByText('1 件の職歴書を評価に使えます')).toBeInTheDocument()
      expect(evaluateButton()).toBeEnabled()
    })

    it('サイズの上限を超えたときは、サーバーが返した上限の値を示す', async () => {
      stubChecks({
        reply: () =>
          errorResponse('file_too_large', 'ファイルサイズが上限（20 MB）を超えています。', 413),
      })
      await reachResumeStep()

      await uploadFiles('大きい.pdf')

      expect(await screen.findByText(/上限（20 MB）/)).toBeInTheDocument()
    })

    it('テキストが得られないファイルは、「テキスト化できませんでした」を示す（仕様 5.6）', async () => {
      stubChecks({
        reply: () =>
          errorResponse(
            'empty_text',
            'テキスト化できませんでした。内容が空か、極端に短いようです。',
          ),
      })
      await reachResumeStep()

      await uploadFiles('空.docx')

      expect(await screen.findByText(/テキスト化できませんでした/)).toBeInTheDocument()
      expect(evaluateButton()).toBeDisabled()
    })

    it('サーバーに接続できないときも、理由を出す', async () => {
      await reachResumeStep()
      server.use(http.post('*/api/resumes/check', () => HttpResponse.error()))

      await uploadFiles('田中.docx')

      expect(await screen.findByText(/サーバーに接続できませんでした/)).toBeInTheDocument()
    })
  })

  describe('取り消しと、古い検証結果', () => {
    it('検証中に削除すると、その書類の要求は取り消され、遅れて届いた結果は無視する', async () => {
      const checks = stubChecks({ hold: true })
      await reachResumeStep()
      await uploadFiles('a.docx', 'b.docx')
      await waitFor(() => {
        expect(checks.requests).toHaveLength(2)
      })

      await userEvent.click(screen.getByRole('button', { name: 'a.docxを削除' }))

      expect(checks.requests.map((request) => request.signal?.aborted)).toEqual([true, false])
      checks.requests[0]?.respond(errorResponse('conversion_failed', '読み取れません'))
      checks.requests[1]?.respond(okResponse('b.docx'))
      expect(await screen.findByText('1 件の職歴書を評価に使えます')).toBeInTheDocument()
      expect(screen.queryByText(/読み取れません/)).not.toBeInTheDocument()
    })

    it('同じ名前のファイルを 2 回選んでも、別の書類として、それぞれの結果を受け取る', async () => {
      const checks = stubChecks({ hold: true })
      await reachResumeStep()
      await uploadFiles('田中.docx')
      await uploadFiles('田中.docx')
      await waitFor(() => {
        expect(checks.requests).toHaveLength(2)
      })

      checks.requests[1]?.respond(okResponse('田中.docx'))
      checks.requests[0]?.respond(errorResponse('conversion_failed', '1 件目が読めません'))

      expect(await screen.findByText(/1 件目が読めません/)).toBeInTheDocument()
      expect(listNames()).toEqual(['田中.docx', '田中.docx'])
      expect(evaluateButton()).toBeDisabled()
    })
  })

  describe('上限（5 件）', () => {
    it('6 件選ぶと、5 件だけ追加し、上限を知らせる（知らせるのは 1 回）', async () => {
      stubChecks()
      await reachResumeStep()

      await uploadFiles('1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf', '6.pdf', '7.pdf')

      await screen.findByText('5 件の職歴書を評価に使えます')
      expect(listNames()).toEqual(['1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf'])
      expect(
        await screen.findAllByText(/最大 5 件までです。超える分は、追加しませんでした/),
      ).toHaveLength(1)
      expect(
        screen.getByText(/職歴書は、最大 5 件までです（削除すると、追加できます）/),
      ).toBeInTheDocument()
    })

    it('削除すると、また追加できる', async () => {
      stubChecks()
      await reachResumeStep()
      await uploadFiles('1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf')
      await screen.findByText('5 件の職歴書を評価に使えます')

      await userEvent.click(screen.getByRole('button', { name: '1.pdfを削除' }))
      await uploadFiles('6.pdf')

      expect(await screen.findByText('5 件の職歴書を評価に使えます')).toBeInTheDocument()
      expect(listNames()).toEqual(['2.pdf', '3.pdf', '4.pdf', '5.pdf', '6.pdf'])
    })
  })

  describe('テキストの貼り付け', () => {
    const paste = async (text: string) => {
      await userEvent.click(screen.getByRole('tab', { name: 'テキストを貼り付ける' }))
      await userEvent.type(screen.getByRole('textbox', { name: '職歴書のテキスト' }), text)
    }

    it('入力が止まってから検証し、「貼り付けテキスト」として一覧に並べる。ファイルと併用できる', async () => {
      stubChecks()
      await reachResumeStep()
      await uploadFiles('田中.docx')

      await paste('職歴の内容です。')

      await waitFor(
        () => {
          expect(listNames()).toEqual(['田中.docx', '貼り付けテキスト'])
        },
        { timeout: 3000 },
      )
      expect(await screen.findByText('2 件の職歴書を評価に使えます')).toBeInTheDocument()
    })

    it('テキストを全部消すと、一覧から取り除かれる', async () => {
      stubChecks()
      await reachResumeStep()
      await paste('abc')
      await screen.findByText('1 件の職歴書を評価に使えます', undefined, { timeout: 3000 })

      await userEvent.clear(screen.getByRole('textbox', { name: '職歴書のテキスト' }))

      await waitFor(
        () => {
          expect(list()).toBeNull()
        },
        { timeout: 3000 },
      )
      expect(evaluateButton()).toBeDisabled()
    })

    it('一覧から削除すると、入力欄も空になる', async () => {
      stubChecks()
      await reachResumeStep()
      await paste('abc')
      await screen.findByText('1 件の職歴書を評価に使えます', undefined, { timeout: 3000 })

      await userEvent.click(screen.getByRole('button', { name: '貼り付けテキストを削除' }))

      expect(screen.getByRole('textbox', { name: '職歴書のテキスト' })).toHaveValue('')
      expect(list()).toBeNull()
    })
  })

  describe('評価する', () => {
    it('API キーが未設定なら、「評価する」を押せない（仕様 5.6）', async () => {
      stubChecks()
      await reachResumeStep({ keyUnset: true })

      await uploadFiles('田中.docx')
      await screen.findByText('1 件の職歴書を評価に使えます')

      expect(evaluateButton()).toBeDisabled()
    })

    it('① に戻って ② に進み直しても、選んだ職歴書は残っている', async () => {
      stubChecks()
      await reachResumeStep()
      await uploadFiles('a.pdf', 'b.docx')
      await screen.findByText('2 件の職歴書を評価に使えます')

      await userEvent.click(screen.getByRole('button', { name: '変更' }))
      await userEvent.click(await screen.findByRole('button', { name: /次へ/ }))

      expect(await screen.findByText('2 件の職歴書を評価に使えます')).toBeInTheDocument()
      expect(listNames()).toEqual(['a.pdf', 'b.docx'])
      expect(evaluateButton()).toBeEnabled()
    })

    it('② が完了すると、Steps には、ファイル名ではなく「ファイルアップロード完了」と出る', async () => {
      stubChecks()
      await reachResumeStep()
      await uploadFiles('田中\n太郎.docx', 'b.docx')
      await screen.findByText('2 件の職歴書を評価に使えます')

      await userEvent.click(screen.getByRole('button', { name: '変更' }))

      expect(await screen.findByText('ファイルアップロード完了')).toBeInTheDocument()
      expect(document.querySelector('.ant-steps')?.textContent).not.toContain('太郎')
    })

    it('「評価する」を押すと、③ に進む', async () => {
      stubChecks()
      await reachResumeStep()
      await uploadFiles('田中.docx')
      await screen.findByText('1 件の職歴書を評価に使えます')

      await userEvent.click(evaluateButton())

      await waitFor(() => {
        expect(screen.queryByText('評価する条件:')).not.toBeInTheDocument()
      })
    })
  })
})
