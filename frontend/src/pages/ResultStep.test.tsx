import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlowProvider } from '../state/flow-context'
import { makeResult } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { defaultSettings, server } from '../test/server'
import { FlowPage } from './FlowPage'

const catalog = [
  { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'q2', label: '2級建築士', kind: 'boolean', unit: null, category: '資格' },
]

const encoder = new TextEncoder()
const result = makeResult({ score: 80 })

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function urlOf(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url
  return input instanceof URL ? input.href : input
}

const isEvaluation = (input: RequestInfo | URL) => urlOf(input).includes('/api/evaluations')

/**
 * `/api/evaluations` への fetch だけを差し替える。
 * （jsdom の FormData は Node の fetch で送れないため。本物のブラウザでは起きない）
 */
function replaceEvaluationFetch(respond: (init: RequestInit | undefined) => Promise<Response>) {
  const original = globalThis.fetch.bind(globalThis)
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    isEvaluation(input) ? respond(init) : original(input, init),
  )
}

/** ストリームの流れを、テストから制御する。 */
function controlEvaluation() {
  const requests: { signal: AbortSignal | undefined; form: FormData }[] = []
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
  replaceEvaluationFetch((init) => {
    requests.push({ signal: init?.signal ?? undefined, form: init?.body as FormData })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.push(controller)
      },
    })
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
  })
  return {
    requests,
    send(index: number, event: string, data: unknown) {
      controllers[index]?.enqueue(encoder.encode(sse(event, data)))
    },
  }
}

async function reachEvaluation() {
  server.use(
    http.get('*/api/catalog', () => HttpResponse.json({ items: catalog })),
    http.get('*/api/settings', () =>
      HttpResponse.json({ ...defaultSettings, openai_api_key_masked: '****1234' }),
    ),
    http.post('*/api/resumes/check', () =>
      HttpResponse.json({ format: 'docx', source_name: '田中.docx', char_count: 1234 }),
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
  await userEvent.click(screen.getByRole('button', { name: /次へ/ }))
  const input = await waitFor(() => {
    const element = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!element) throw new Error('ファイルの入力欄がありません')
    return element
  })
  await userEvent.upload(input, new File(['x'], '田中.docx'))
  await screen.findByText('この職歴書を評価に使えます')
}

const startEvaluation = () => userEvent.click(screen.getByRole('button', { name: '評価する' }))

async function startAndWaitForRequest(evaluation: ReturnType<typeof controlEvaluation>) {
  await reachEvaluation()
  await startEvaluation()
  await waitFor(() => {
    expect(evaluation.requests).toHaveLength(1)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('③ 評価の進捗とエラー', () => {
  it('評価を始めると、選んだ条件とファイルを送り、「抽出中」→「最終評価中」と進む', async () => {
    const evaluation = controlEvaluation()

    await startAndWaitForRequest(evaluation)

    expect(await screen.findByText('評価しています')).toBeInTheDocument()
    const form = evaluation.requests[0]?.form
    const conditions = JSON.parse(form?.get('conditions') as string) as { id: string }[]
    expect(conditions.map((c) => c.id)).toEqual(['q1'])
    expect((form?.get('file') as File).name).toBe('田中.docx')

    const current = () =>
      screen.getByRole('status').querySelector('.ant-steps-item-process')?.textContent
    expect(current()).toContain('抽出中')
    evaluation.send(0, 'stage', { stage: 'scoring' })
    await waitFor(() => {
      expect(current()).toContain('最終評価中')
    })
  })

  it('キャンセルすると、要求を取り消し、② に戻る（職歴書は残る）', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(evaluation.requests[0]?.signal?.aborted).toBe(true)
    expect(await screen.findByText('この職歴書を評価に使えます')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '評価する' })).toBeEnabled()
  })

  it('キャンセルしたあとに届いた結果は、無視する', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    evaluation.send(0, 'result', result)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByText(/最終スコア/)).not.toBeInTheDocument()
    expect(screen.getByText('この職歴書を評価に使えます')).toBeInTheDocument()
  })

  it('結果を受け取ると、結果を表示する', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    evaluation.send(0, 'result', result)

    expect(await screen.findByText(/最終スコア/)).toBeInTheDocument()
  })

  it('サーバーがエラーを返したら、原因を示し、「もう一度評価する」で新しい要求を送る', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    evaluation.send(0, 'error', { code: 'llm_unavailable', message: 'AI が混み合っています。' })

    expect(await screen.findByText('評価できませんでした')).toBeInTheDocument()
    expect(screen.getByText('AI が混み合っています。')).toBeInTheDocument()
    expect(screen.queryByText('API キーを確認してください')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'もう一度評価する' }))

    await waitFor(() => {
      expect(evaluation.requests).toHaveLength(2)
    })
    expect(await screen.findByText('評価しています')).toBeInTheDocument()
  })

  it('API キーの認証エラーでは、設定ページへのリンクを出す', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    evaluation.send(0, 'error', { code: 'llm_auth', message: 'API キーが正しくありません。' })

    const link = await screen.findByRole('link', { name: '設定ページを開く' })
    expect(link).toHaveAttribute('href', '#/settings')
  })

  it('「条件に戻る」で ① に戻る', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)
    evaluation.send(0, 'error', { code: 'llm_unavailable', message: '混み合っています。' })

    await userEvent.click(await screen.findByRole('button', { name: '条件に戻る' }))

    expect(await screen.findByRole('group', { name: '1級建築施工管理技士' })).toBeInTheDocument()
  })

  it('ストリームが始まる前の失敗（413）も、サーバーのメッセージで表示する', async () => {
    replaceEvaluationFetch(() =>
      Promise.resolve(
        Response.json(
          { code: 'file_too_large', message: 'ファイルサイズが上限（20 MB）を超えています。' },
          { status: 413 },
        ),
      ),
    )
    await reachEvaluation()

    await startEvaluation()

    expect(
      await screen.findByText('ファイルサイズが上限（20 MB）を超えています。'),
    ).toBeInTheDocument()
  })

  it('結果が来ないままストリームが閉じたら、「途中で終わった」と表示する', async () => {
    replaceEvaluationFetch(() =>
      Promise.resolve(
        new Response(sse('stage', { stage: 'extracting' }), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    await reachEvaluation()

    await startEvaluation()

    expect(await screen.findByText(/評価が途中で終わりました/)).toBeInTheDocument()
  })
})
