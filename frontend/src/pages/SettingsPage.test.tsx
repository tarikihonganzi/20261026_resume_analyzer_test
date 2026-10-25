import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { SettingsView } from '../api/types'
import App from '../App'
import { renderWithProviders } from '../test/render'
import { defaultSettings, server } from '../test/server'
import { SettingsPage } from './SettingsPage'

const saved: SettingsView = {
  openai_api_key_masked: '****1234',
  openai_base_url: 'https://llm.example.invalid/v1',
  model: 'gpt-5.5',
  max_file_size_mb: 20,
}

/** 保存済みの設定を返し、PUT を記録する（保存の内容を、次の GET にも反映する）。 */
function mockSettings(initial: SettingsView = saved) {
  let current = initial
  const puts: unknown[] = []
  const tests: unknown[] = []
  server.use(
    http.get('*/api/settings', () => HttpResponse.json(current)),
    http.put('*/api/settings', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      puts.push(body)
      current = {
        openai_api_key_masked:
          typeof body.openai_api_key === 'string' ? '****7890' : current.openai_api_key_masked,
        openai_base_url: (body.openai_base_url as string | undefined) ?? current.openai_base_url,
        model: (body.model as string | undefined) ?? current.model,
        max_file_size_mb: (body.max_file_size_mb as number | undefined) ?? current.max_file_size_mb,
      }
      return HttpResponse.json(current)
    }),
  )
  return { puts, tests }
}

const keyInput = () => screen.getByLabelText('API キー')
const urlInput = () => screen.getByLabelText('ベース URL')
const modelInput = () => screen.getByLabelText('モデル名')
const saveButton = () => screen.getByRole('button', { name: '保存' })
const testButton = () => screen.getByRole('button', { name: '接続テスト' })

async function renderPage(initial?: SettingsView) {
  const recorded = mockSettings(initial)
  renderWithProviders(<SettingsPage />)
  await screen.findByLabelText('モデル名')
  return recorded
}

describe('設定ページ', () => {
  it('保存済みの値を表示する。API キーはマスクだけを示し、入力欄には入れない', async () => {
    await renderPage()

    expect(urlInput()).toHaveValue('https://llm.example.invalid/v1')
    expect(modelInput()).toHaveValue('gpt-5.5')
    expect(screen.getByLabelText('最大ファイルサイズ')).toHaveValue('20')
    expect(keyInput()).toHaveValue('')
    expect(keyInput()).toHaveAttribute('type', 'password')
    expect(screen.getByText(/保存済み: \*\*\*\*1234/)).toBeInTheDocument()
  })

  it('ベース URL の説明は、社内エンドポイントの URL とだけ書く（OpenAI の既定の URL には触れない）', async () => {
    await renderPage()

    expect(screen.getByText('社内エンドポイントの URL。')).toBeInTheDocument()
    expect(screen.queryByText(/OpenAI の既定/)).not.toBeInTheDocument()
  })

  it('何も変えていないあいだは、「保存」を押せない', async () => {
    await renderPage()

    expect(saveButton()).toBeDisabled()

    await userEvent.type(modelInput(), '-mini')

    expect(saveButton()).toBeEnabled()
  })

  it('変えた項目だけを保存し、成功を知らせる', async () => {
    const { puts } = await renderPage()

    await userEvent.clear(modelInput())
    await userEvent.type(modelInput(), 'gpt-5.6')
    await userEvent.click(saveButton())

    expect(await screen.findByText('保存しました。次の評価から反映されます。')).toBeInTheDocument()
    expect(puts).toEqual([{ model: 'gpt-5.6' }])
    await waitFor(() => {
      expect(saveButton()).toBeDisabled()
    })
  })

  it('API キーを入力して保存すると、マスク表示に変わり、入力欄は空に戻る（全文を残さない）', async () => {
    const { puts } = await renderPage()

    await userEvent.type(keyInput(), 'sk-secret-key-7890')
    await userEvent.click(saveButton())

    expect(await screen.findByText(/保存済み: \*\*\*\*7890/)).toBeInTheDocument()
    expect(puts).toEqual([{ openai_api_key: 'sk-secret-key-7890' }])
    expect(keyInput()).toHaveValue('')
    expect(document.body.textContent).not.toContain('sk-secret-key-7890')
  })

  it('ベース URL を空にして保存できる（SDK の既定に戻す）', async () => {
    const { puts } = await renderPage()

    await userEvent.clear(urlInput())
    await userEvent.click(saveButton())

    await screen.findByText('保存しました。次の評価から反映されます。')
    expect(puts).toEqual([{ openai_base_url: '' }])
  })

  it('最大ファイルサイズに 0 を入れて、制限なしにできる', async () => {
    const { puts } = await renderPage()

    await userEvent.clear(screen.getByLabelText('最大ファイルサイズ'))
    await userEvent.type(screen.getByLabelText('最大ファイルサイズ'), '0')
    await userEvent.click(saveButton())

    await screen.findByText('保存しました。次の評価から反映されます。')
    expect(puts).toEqual([{ max_file_size_mb: 0 }])
  })

  it('URL の形が正しくないと、保存せず、理由を示す', async () => {
    const { puts } = await renderPage()

    await userEvent.clear(urlInput())
    await userEvent.type(urlInput(), 'llm.example.invalid')
    await userEvent.click(saveButton())

    expect(
      await screen.findByText('http:// または https:// で始まる URL を入力してください'),
    ).toBeInTheDocument()
    expect(puts).toEqual([])
  })

  it('モデル名が空だと、保存せず、理由を示す', async () => {
    const { puts } = await renderPage()

    await userEvent.clear(modelInput())
    await userEvent.click(saveButton())

    expect(await screen.findByText('モデル名を入力してください')).toBeInTheDocument()
    expect(puts).toEqual([])
  })

  it('サーバーが保存を断ったら、そのメッセージを示す', async () => {
    await renderPage()
    server.use(
      http.put('*/api/settings', () =>
        HttpResponse.json(
          { code: 'validation_error', message: '設定の値が正しくありません。' },
          { status: 422 },
        ),
      ),
    )

    await userEvent.type(modelInput(), 'x')
    await userEvent.click(saveButton())

    expect(await screen.findByText('設定の値が正しくありません。')).toBeInTheDocument()
  })

  describe('接続テスト', () => {
    it('保存前の入力値で試し、成功を示す', async () => {
      await renderPage()
      let body: unknown
      server.use(
        http.post('*/api/settings/test', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ ok: true, message: '接続できました。' })
        }),
      )

      await userEvent.clear(modelInput())
      await userEvent.type(modelInput(), 'gpt-5.6')
      await userEvent.type(keyInput(), 'sk-trial-key')
      await userEvent.click(testButton())

      expect(await screen.findByText('接続できました')).toBeInTheDocument()
      expect(body).toEqual({
        openai_api_key: 'sk-trial-key',
        openai_base_url: 'https://llm.example.invalid/v1',
        model: 'gpt-5.6',
      })
    })

    it('API キーを入力していないときは、キーを送らない（サーバーが保存済みの値を使う）', async () => {
      await renderPage()
      let body: unknown
      server.use(
        http.post('*/api/settings/test', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ ok: true, message: '接続できました。' })
        }),
      )

      await userEvent.click(testButton())

      await screen.findByText('接続できました')
      expect(body).toMatchObject({ openai_api_key: null })
    })

    it('失敗したら、サーバーが返した理由を示す。入力を変えると、結果は消える', async () => {
      await renderPage()
      server.use(
        http.post('*/api/settings/test', () =>
          HttpResponse.json({ ok: false, message: 'API キーが正しくありません。' }),
        ),
      )

      await userEvent.click(testButton())

      expect(await screen.findByText('接続できませんでした')).toBeInTheDocument()
      expect(screen.getByText('API キーが正しくありません。')).toBeInTheDocument()

      await userEvent.type(modelInput(), 'x')

      expect(screen.queryByText('接続できませんでした')).not.toBeInTheDocument()
    })

    it('API キーが保存されておらず、入力もないときは、押せない', async () => {
      await renderPage({ ...saved, openai_api_key_masked: '' })

      expect(screen.getByText(/未設定です/)).toBeInTheDocument()
      expect(testButton()).toBeDisabled()

      await userEvent.type(keyInput(), 'sk-x')

      expect(testButton()).toBeEnabled()
    })
  })

  it('キーを保存すると、画面上部の「API キーが設定されていません」のバナーが消える', async () => {
    window.location.hash = '#/settings'
    mockSettings({ ...defaultSettings, openai_api_key_masked: '' })
    renderWithProviders(<App />)
    expect(await screen.findByText('API キーが設定されていません')).toBeInTheDocument()

    await userEvent.type(await screen.findByLabelText('API キー'), 'sk-secret-key-7890')
    await userEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.queryByText('API キーが設定されていません')).not.toBeInTheDocument()
    })
  })

  it('接続テストは、ベース URL やモデル名が正しくないときは、サーバーに送らず、理由を示す', async () => {
    await renderPage()
    let sent = 0
    server.use(
      http.post('*/api/settings/test', () => {
        sent += 1
        return HttpResponse.json({ ok: true, message: '' })
      }),
    )
    await userEvent.clear(urlInput())
    await userEvent.type(urlInput(), 'llm.example.invalid')

    await userEvent.click(testButton())

    expect(
      await screen.findByText('http:// または https:// で始まる URL を入力してください'),
    ).toBeInTheDocument()
    expect(sent).toBe(0)
  })

  it('読み込みに失敗したときは、設定のフォームを出さない（上部のバナーに任せる）', async () => {
    server.use(
      http.get('*/api/settings', () =>
        HttpResponse.json({ code: 'storage_error', message: '読めません' }, { status: 500 }),
      ),
    )
    renderWithProviders(<SettingsPage />)

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
    expect(screen.queryByLabelText('モデル名')).not.toBeInTheDocument()
  })
})
