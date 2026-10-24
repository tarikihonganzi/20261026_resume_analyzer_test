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

    expect(screen.getByRole('heading', { name: '職歴書マッチング評価' })).toBeInTheDocument()
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

  it('設定ページでは、バナーを出さず、評価に戻るボタンを出す', async () => {
    server.use(
      http.get('*/api/settings', () =>
        HttpResponse.json({ ...defaultSettings, openai_api_key_masked: '' }),
      ),
    )
    const onNavigate = vi.fn()
    renderWithProviders(
      <AppShell view="settings" onNavigate={onNavigate}>
        <p>設定</p>
      </AppShell>,
    )

    await userEvent.click(screen.getByRole('button', { name: /評価に戻る/ }))

    expect(onNavigate).toHaveBeenCalledWith('flow')
    expect(screen.queryByText('API キーが設定されていません')).not.toBeInTheDocument()
  })
})
