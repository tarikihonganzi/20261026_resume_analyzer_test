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
  await screen.findByText('1 件の書類を評価に使えます')
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
    expect((form?.get('files') as File).name).toBe('田中.docx')

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
    expect(await screen.findByText('1 件の書類を評価に使えます')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '評価する' })).toBeEnabled()
  })

  it('キャンセルしたあとに届いた結果は、無視する', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    evaluation.send(0, 'result', result)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByText(/最終スコア/)).not.toBeInTheDocument()
    expect(screen.getByText('1 件の書類を評価に使えます')).toBeInTheDocument()
  })

  it('評価中の領域は、文字を選択できない（回転するアイコンに、選択やキャレットが重ならない）', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    expect(screen.getByRole('status')).toHaveStyle({ userSelect: 'none' })
  })

  it('結果を受け取ると、結果を表示する', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    evaluation.send(0, 'result', result)

    expect(await screen.findByText(/最終スコア/)).toBeInTheDocument()
    // 押していた「キャンセル」は消える。フォーカスを、結果の領域へ移す
    expect(screen.getByRole('region', { name: '③ 結果' })).toHaveFocus()
  })

  it('結果の先頭に、応募者の氏名を出す', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    evaluation.send(0, 'result', makeResult({ applicant_name: '架空 太郎' }))

    expect(await screen.findByText('架空 太郎')).toBeInTheDocument()
    expect(screen.getByText('応募者')).toBeInTheDocument()
  })

  it('氏名が読み取れなかったときは、「氏名の記載なし」と出す', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    evaluation.send(0, 'result', makeResult({ applicant_name: null }))

    expect(await screen.findByText('氏名の記載なし')).toBeInTheDocument()
  })

  it('サーバーがエラーを返したら、原因を示し、「再実行」で新しい要求を送る', async () => {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)

    evaluation.send(0, 'error', { code: 'llm_unavailable', message: 'AI が混み合っています。' })

    expect(await screen.findByText('評価できませんでした')).toBeInTheDocument()
    expect(screen.getByText('AI が混み合っています。')).toBeInTheDocument()
    expect(screen.queryByText('設定を確認してください')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '再実行' }))

    await waitFor(() => {
      expect(evaluation.requests).toHaveLength(2)
    })
    expect(await screen.findByText('評価しています')).toBeInTheDocument()
  })

  // 仕様 5.6: API の失敗は再試行を促し、認証・設定の誤りは設定ページへのリンクを示す
  it.each([
    [
      'llm_unavailable',
      'AI サービスの応答に時間がかかりすぎました。もう一度お試しください。',
      false,
    ],
    ['llm_response', 'AI の応答を利用できませんでした。もう一度お試しください。', false],
    [
      'extraction_inconsistent',
      'AI の抽出結果に不整合がありました。もう一度実行してください。',
      false,
    ],
    [
      'llm_auth',
      'API キーが正しくないか、権限がありません。設定ページで API キーを確認してください。',
      true,
    ],
    [
      'llm_request',
      'AI サービスがリクエストを受け付けませんでした。設定ページでモデル名とベース URL を確認してください。',
      true,
    ],
  ])(
    'エラー %s: 原因と「再実行」を示し、設定の誤りのときだけ、設定ページへのリンクを出す',
    async (code, message, hasSettingsLink) => {
      const evaluation = controlEvaluation()
      await startAndWaitForRequest(evaluation)

      evaluation.send(0, 'error', { code, message })

      expect(await screen.findByText('評価できませんでした')).toBeInTheDocument()
      expect(screen.getByText(message)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '再実行' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '条件に戻る' })).toBeInTheDocument()
      const link = screen.queryByRole('link', { name: '設定ページを開く' })
      if (hasSettingsLink) expect(link).toHaveAttribute('href', '#/settings')
      else expect(link).not.toBeInTheDocument()
    },
  )

  it('サーバーに接続できないときは、その原因を示し、再実行できる', async () => {
    replaceEvaluationFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await reachEvaluation()

    await startEvaluation()

    expect(await screen.findByText(/サーバーに接続できませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再実行' })).toBeInTheDocument()
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

describe('③ 結果からの操作（受け入れ基準 13）', () => {
  async function reachResult() {
    const evaluation = controlEvaluation()
    await startAndWaitForRequest(evaluation)
    evaluation.send(0, 'result', result)
    await screen.findByText('最終スコア（AI 算出）')
    return evaluation
  }

  it('「別の応募者を評価」で、条件を残したまま ② に戻り、職歴書は空になる', async () => {
    await reachResult()

    await userEvent.click(screen.getByRole('button', { name: '別の応募者を評価' }))

    expect(await screen.findByText('評価する条件:')).toBeInTheDocument()
    expect(screen.getByText('必須 1 件・任意 0 件')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'アップロード済みの書類' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '評価する' })).toBeDisabled()
    expect(screen.queryByText('最終スコア（AI 算出）')).not.toBeInTheDocument()
  })

  it('「条件を変えて再評価」で ① に戻り、選んだ条件が残っている。職歴書も残り、再評価で、もう一度送る', async () => {
    const evaluation = await reachResult()

    await userEvent.click(screen.getByRole('button', { name: '条件を変えて再評価' }))

    const row = await screen.findByRole('group', { name: '1級建築施工管理技士' })
    expect(row.querySelector('.ant-segmented-item-selected')?.textContent).toBe('必須')
    expect(screen.queryByText('最終スコア（AI 算出）')).not.toBeInTheDocument()

    await userEvent.click(
      within(screen.getByRole('group', { name: '2級建築士' })).getByText('任意'),
    )
    await userEvent.click(screen.getByRole('button', { name: /次へ/ }))
    expect(await screen.findByText('1 件の書類を評価に使えます')).toBeInTheDocument()
    await startEvaluation()

    await waitFor(() => {
      expect(evaluation.requests).toHaveLength(2)
    })
    const form = evaluation.requests[1]?.form
    const conditions = JSON.parse(form?.get('conditions') as string) as { id: string }[]
    expect(conditions.map((c) => c.id)).toEqual(['q1', 'q2'])
    expect((form?.get('files') as File).name).toBe('田中.docx')
  })
})
