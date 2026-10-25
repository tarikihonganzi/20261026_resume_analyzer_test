import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { defaultSettings, server } from '../test/server'
import { renderWithProviders } from '../test/render'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('タイトルと、設定への入口を表示する', () => {
    renderWithProviders(
      <AppShell view="flow" onNavigate={vi.fn()}>
        <p>本文</p>
      </AppShell>,
    )

    expect(screen.getByRole('heading', { name: 'マッチング評価' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /設定/ })).toBeInTheDocument()
    expect(screen.getByText('本文')).toBeInTheDocument()
  })

  it('API キーが未設定なら、バナーを出して、設定ページへ誘導する', async () => {
    server.use(
      http.get('*/api/settings', () =>
        HttpResponse.json({ ...defaultSettings, openai_api_key_masked: '' }),
      ),
    )
    const onNavigate = vi.fn()
    renderWithProviders(
      <AppShell view="flow" onNavigate={onNavigate}>
        <p>本文</p>
      </AppShell>,
    )

    expect(await screen.findByText('API キーが設定されていません')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '設定ページへ' }))
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('API キーが設定済みなら、バナーを出さない', async () => {
    renderWithProviders(
      <AppShell view="flow" onNavigate={vi.fn()}>
        <p>本文</p>
      </AppShell>,
    )

    await waitFor(() => {
      expect(screen.queryByText('API キーが設定されていません')).not.toBeInTheDocument()
    })
  })

  it('設定ページにも、バナーを出す（仕様 6.3「全画面の上部」）。誘導のボタンは出さない', async () => {
    server.use(
      http.get('*/api/settings', () =>
        HttpResponse.json({ ...defaultSettings, openai_api_key_masked: '' }),
      ),
    )
    renderWithProviders(
      <AppShell view="settings" onNavigate={vi.fn()}>
        <p>設定</p>
      </AppShell>,
    )

    expect(await screen.findByText('API キーが設定されていません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '設定ページへ' })).not.toBeInTheDocument()
  })

  it('設定ページでは、評価に戻るボタンから戻れる', async () => {
    const onNavigate = vi.fn()
    renderWithProviders(
      <AppShell view="settings" onNavigate={onNavigate}>
        <p>設定</p>
      </AppShell>,
    )

    await userEvent.click(screen.getByRole('button', { name: /評価に戻る/ }))

    expect(onNavigate).toHaveBeenCalledWith('flow')
  })

  it('設定を取得できなかったら、理由を出し、再試行できる（サーバーが復旧すれば直る）', async () => {
    let healthy = false
    server.use(
      http.get('*/api/settings', () =>
        healthy
          ? HttpResponse.json({ ...defaultSettings, openai_api_key_masked: '' })
          : HttpResponse.json(
              { code: 'storage_error', message: '設定ファイルを読めません' },
              { status: 500 },
            ),
      ),
    )
    renderWithProviders(
      <AppShell view="flow" onNavigate={vi.fn()}>
        <p>本文</p>
      </AppShell>,
    )

    expect(await screen.findByText('設定を読み込めませんでした')).toBeInTheDocument()
    expect(screen.getByText('設定ファイルを読めません')).toBeInTheDocument()

    healthy = true
    await userEvent.click(screen.getByRole('button', { name: '再試行' }))

    expect(await screen.findByText('API キーが設定されていません')).toBeInTheDocument()
    expect(screen.queryByText('設定を読み込めませんでした')).not.toBeInTheDocument()
  })
})

describe('AppShell: 設定を読み込めないとき', () => {
  it('理由と「再試行」を出し、押すと、もう一度読み込む', async () => {
    let fails = true
    server.use(
      http.get('*/api/settings', () =>
        fails
          ? HttpResponse.json(
              { code: 'storage_error', message: '設定を読めません' },
              { status: 500 },
            )
          : HttpResponse.json({ ...defaultSettings, openai_api_key_masked: '' }),
      ),
    )
    renderWithProviders(
      <AppShell view="flow" onNavigate={vi.fn()}>
        <p>本文</p>
      </AppShell>,
    )
    expect(await screen.findByText('設定を読み込めませんでした')).toBeInTheDocument()
    expect(screen.getByText('設定を読めません')).toBeInTheDocument()
    fails = false

    await userEvent.click(screen.getByRole('button', { name: '再試行' }))

    expect(await screen.findByText('API キーが設定されていません')).toBeInTheDocument()
    expect(screen.queryByText('設定を読み込めませんでした')).not.toBeInTheDocument()
  })
})
