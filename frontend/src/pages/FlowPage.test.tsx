import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { FlowProvider } from '../state/flow-context'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { FlowPage } from './FlowPage'

const catalog = [
  { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
]

async function renderFlow() {
  server.use(http.get('*/api/catalog', () => HttpResponse.json({ items: catalog })))
  renderWithProviders(
    <FlowProvider>
      <FlowPage />
    </FlowProvider>,
  )
  await userEvent.click(
    within(await screen.findByRole('group', { name: '1級建築施工管理技士' })).getByText('必須'),
  )
}

// キーボードで「次へ」を押すと、そのボタンが消える。フォーカスが失われて、先頭に戻らないよう、
// 切り替わった画面へフォーカスを移す（スクリーンリーダーには、画面の名前が読み上げられる）
describe('画面の切り替えと、フォーカス', () => {
  it('最初の表示では、フォーカスを奪わない', async () => {
    await renderFlow()

    expect(screen.getByRole('region', { name: '① 条件' })).not.toHaveFocus()
  })

  it('「次へ」で ② に進むと、② の領域にフォーカスが移る', async () => {
    await renderFlow()

    await userEvent.click(screen.getByRole('button', { name: /次へ/ }))

    expect(await screen.findByRole('region', { name: '② 職歴書' })).toHaveFocus()
  })

  it('「戻る」で ① に戻ると、① の領域にフォーカスが移る', async () => {
    await renderFlow()
    await userEvent.click(screen.getByRole('button', { name: /次へ/ }))
    await screen.findByRole('region', { name: '② 職歴書' })

    await userEvent.click(screen.getByRole('button', { name: '戻る' }))

    expect(await screen.findByRole('region', { name: '① 条件' })).toHaveFocus()
  })
})
