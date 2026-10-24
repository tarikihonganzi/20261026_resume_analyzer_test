import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { FlowProvider } from '../state/flow-context'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { FlowPage } from './FlowPage'

const catalog = [
  { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'q2', label: '2級建築士', kind: 'boolean', unit: null, category: '資格' },
  { id: 's1', label: 'Revit の実務経験', kind: 'number', unit: '年', category: 'スキル・ツール' },
]

function renderPage() {
  server.use(http.get('*/api/catalog', () => HttpResponse.json({ items: catalog })))
  renderWithProviders(
    <FlowProvider>
      <FlowPage />
    </FlowProvider>,
  )
}

const row = (name: string) => screen.getByRole('group', { name })
const next = () => screen.getByRole('button', { name: /次へ/ })

async function choose(name: string, mode: '任意' | '必須') {
  await userEvent.click(within(await screen.findByRole('group', { name })).getByText(mode))
}

describe('① 条件', () => {
  it('プリセットを、カテゴリごとに表示する', async () => {
    renderPage()

    expect(await screen.findByText('1級建築施工管理技士')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '資格' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'スキル・ツール' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '自由記述' })).toBeInTheDocument()
  })

  it('1 件も選ばれていないうちは、「次へ」を押せない', async () => {
    renderPage()
    await screen.findByText('1級建築施工管理技士')

    expect(next()).toBeDisabled()
  })

  it('1 件選ぶと「次へ」を押せて、Steps に件数が出る', async () => {
    renderPage()
    await choose('1級建築施工管理技士', '必須')
    await choose('2級建築士', '任意')

    expect(next()).toBeEnabled()
    await userEvent.click(next())

    expect(await screen.findByText('必須 1・任意 1')).toBeInTheDocument()
  })

  it('number の条件は、最低値を入れるまで「次へ」を押せない', async () => {
    renderPage()
    await choose('Revit の実務経験', '任意')
    expect(next()).toBeDisabled()

    await userEvent.type(within(row('Revit の実務経験')).getByRole('spinbutton'), '2')

    expect(next()).toBeEnabled()
  })

  it('検索で、一致する条件だけが残る', async () => {
    renderPage()
    await screen.findByText('1級建築施工管理技士')

    await userEvent.type(screen.getByRole('textbox', { name: '条件を検索' }), 'revit')

    expect(screen.getByText('Revit の実務経験')).toBeInTheDocument()
    expect(screen.queryByText('1級建築施工管理技士')).not.toBeInTheDocument()
  })

  it('カテゴリで絞り込める', async () => {
    renderPage()
    await screen.findByText('1級建築施工管理技士')

    await userEvent.click(
      screen.getByText('スキル・ツール', { selector: '.ant-segmented-item-label' }),
    )

    expect(screen.getByText('Revit の実務経験')).toBeInTheDocument()
    expect(screen.queryByText('2級建築士')).not.toBeInTheDocument()
  })

  it('「選択中のみ表示」で、使うと決めた条件だけが残る', async () => {
    renderPage()
    await choose('2級建築士', '任意')

    await userEvent.click(screen.getByRole('checkbox', { name: '選択中のみ表示' }))

    expect(screen.getByRole('group', { name: '2級建築士' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '1級建築施工管理技士' })).not.toBeInTheDocument()
  })

  it('条件の一覧を読み込めなかったら、理由と再読み込みのボタンを出す', async () => {
    server.use(
      http.get('*/api/catalog', () =>
        HttpResponse.json({ code: 'storage_error', message: '読み込めません' }, { status: 500 }),
      ),
    )
    renderWithProviders(
      <FlowProvider>
        <FlowPage />
      </FlowProvider>,
    )

    expect(await screen.findByText('条件の一覧を読み込めませんでした')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
    })
  })
})

describe('① 自由記述と要約パネル（受け入れ基準 2）', () => {
  it('自由記述を追加すると、「自由記述」に独自の印つきで出て、任意として要約に入る', async () => {
    renderPage()
    await screen.findByText('1級建築施工管理技士')

    await userEvent.click(
      screen.getAllByRole('button', { name: /自由記述で条件を追加/ })[0] as HTMLElement,
    )
    await userEvent.type(
      await screen.findByRole('textbox', { name: '条件の名前' }),
      '耐震診断の経験',
    )
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    const section = await screen.findByRole('region', { name: '自由記述' })
    expect(within(section).getByText('耐震診断の経験')).toBeInTheDocument()
    expect(within(section).getByText('独自')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: '任意' })).getByText('耐震診断の経験'),
    ).toBeInTheDocument()
    expect(screen.getByText('■ 任意（1）')).toBeInTheDocument()
  })

  it('選ぶと、要約にリアルタイムで反映される', async () => {
    renderPage()
    await choose('1級建築施工管理技士', '必須')
    await choose('Revit の実務経験', '任意')
    await userEvent.type(within(row('Revit の実務経験')).getByRole('spinbutton'), '2')

    expect(screen.getByText('■ 必須（1）')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: '任意' })).getByText('Revit の実務経験 2.0年以上'),
    ).toBeInTheDocument()
  })

  it('編集と削除ができる。プリセットには、編集・削除がない', async () => {
    renderPage()
    await screen.findByText('1級建築施工管理技士')
    await userEvent.click(
      screen.getAllByRole('button', { name: /自由記述で条件を追加/ })[0] as HTMLElement,
    )
    await userEvent.type(await screen.findByRole('textbox', { name: '条件の名前' }), '耐震診断')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(
      screen.queryByRole('button', { name: /1級建築施工管理技士を編集/ }),
    ).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: '耐震診断を編集' }))
    const input = await screen.findByRole('textbox', { name: '条件の名前' })
    await userEvent.clear(input)
    await userEvent.type(input, '耐震改修')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('group', { name: '耐震改修' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '耐震改修を削除' }))
    await userEvent.click(await screen.findByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: '耐震改修' })).not.toBeInTheDocument()
    })
    expect(screen.getByText(/使う条件を「任意」か「必須」にしてください/)).toBeInTheDocument()
  })
})
