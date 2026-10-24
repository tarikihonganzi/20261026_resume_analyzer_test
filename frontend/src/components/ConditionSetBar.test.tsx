import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Condition, ConditionSet } from '../api/types'
import { FlowProvider } from '../state/flow-context'
import { FlowPage } from '../pages/FlowPage'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'

const catalog = [
  { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'q2', label: '2級建築士', kind: 'boolean', unit: null, category: '資格' },
  { id: 's1', label: 'Revit の実務経験', kind: 'number', unit: '年', category: 'スキル・ツール' },
]

const savedConditions: Condition[] = [
  {
    id: 'q2',
    label: '2級建築士',
    kind: 'boolean',
    required: true,
    min_value: null,
    unit: null,
    source: 'preset',
    category: '資格',
    description: null,
  },
  {
    id: 's1',
    label: 'Revit の実務経験',
    kind: 'number',
    required: false,
    min_value: 2.5,
    unit: '年',
    source: 'preset',
    category: 'スキル・ツール',
    description: null,
  },
  {
    id: 'custom-1',
    label: '耐震診断の経験',
    kind: 'boolean',
    required: false,
    min_value: null,
    unit: null,
    source: 'custom',
    category: null,
    description: null,
  },
]

const savedSet: ConditionSet = {
  id: 'set-1',
  name: '現場監督',
  conditions: savedConditions,
  created_at: '2026-10-25T09:00:00+09:00',
  updated_at: '2026-10-25T09:00:00+09:00',
}

interface Calls {
  created: unknown[]
  updated: { id: string; body: unknown }[]
  deleted: string[]
}

function renderPage(sets: ConditionSet[] = [savedSet]): Calls {
  const calls: Calls = { created: [], updated: [], deleted: [] }
  server.use(
    http.get('*/api/catalog', () => HttpResponse.json({ items: catalog })),
    http.get('*/api/condition-sets', () => HttpResponse.json({ sets })),
    http.post('*/api/condition-sets', async ({ request }) => {
      const body = (await request.json()) as { name: string; conditions: Condition[] }
      calls.created.push(body)
      return HttpResponse.json(
        { ...savedSet, id: 'set-new', name: body.name, conditions: body.conditions },
        { status: 201 },
      )
    }),
    http.put('*/api/condition-sets/:id', async ({ request, params }) => {
      const body = (await request.json()) as { name: string; conditions: Condition[] }
      calls.updated.push({ id: String(params.id), body })
      return HttpResponse.json({ ...savedSet, ...body })
    }),
    http.delete('*/api/condition-sets/:id', ({ params }) => {
      calls.deleted.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderWithProviders(
    <FlowProvider>
      <FlowPage />
    </FlowProvider>,
  )
  return calls
}

const row = (name: string) => screen.getByRole('group', { name })
/** 行で選ばれている状態（Segmented の、選択中の項目の文字）。 */
const selectedMode = (name: string) =>
  row(name).querySelector('.ant-segmented-item-selected')?.textContent

const dialogTextbox = async () => within(await screen.findByRole('dialog')).getByRole('textbox')

async function loadSavedSet() {
  await userEvent.click(await screen.findByRole('combobox', { name: '保存済みの条件セット' }))
  await userEvent.click(
    await screen.findByText('現場監督', { selector: '.ant-select-item-option-content' }),
  )
}

describe('条件セット（受け入れ基準 8）', () => {
  it('保存済みのセットを選ぶと、選択・最低値・自由記述が復元される', async () => {
    renderPage()

    await loadSavedSet()

    expect(await screen.findByText('■ 必須（1）')).toBeInTheDocument()
    expect(screen.getByText('■ 任意（2）')).toBeInTheDocument()
    expect(selectedMode('2級建築士')).toBe('必須')
    expect(selectedMode('Revit の実務経験')).toBe('任意')
    expect(within(row('Revit の実務経験')).getByRole('spinbutton')).toHaveValue('2.5')
    expect(selectedMode('1級建築施工管理技士')).toBe('使わない')
    const custom = await screen.findByRole('region', { name: '自由記述' })
    expect(within(custom).getByText('耐震診断の経験')).toBeInTheDocument()
  })

  it('保存済みがなければ、選べず、案内を出す', async () => {
    renderPage([])

    expect(await screen.findByText('保存済みのセットはありません')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '保存済みの条件セット' })).toBeDisabled()
  })

  it('条件がそろっていないうちは、保存できない', async () => {
    renderPage()
    await screen.findByText('1級建築施工管理技士')

    expect(screen.getByRole('button', { name: /名前を付けて保存/ })).toBeDisabled()
  })

  it('名前を付けて保存すると、いまの条件が送られる', async () => {
    const calls = renderPage()
    await userEvent.click(
      within(await screen.findByRole('group', { name: '1級建築施工管理技士' })).getByText('必須'),
    )
    await userEvent.click(within(row('Revit の実務経験')).getByText('任意'))
    await userEvent.type(within(row('Revit の実務経験')).getByRole('spinbutton'), '2')

    await userEvent.click(screen.getByRole('button', { name: /名前を付けて保存/ }))
    await userEvent.type(await dialogTextbox(), '  新しいセット ')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(calls.created).toHaveLength(1)
    })
    expect(calls.created[0]).toMatchObject({
      name: '新しいセット',
      conditions: [
        { id: 'q1', required: true, min_value: null, source: 'preset' },
        { id: 's1', required: false, min_value: 2, unit: '年' },
      ],
    })
    expect(await screen.findByText('「新しいセット」を保存しました')).toBeInTheDocument()
  })

  it('名前が空なら、保存できない', async () => {
    renderPage()
    await userEvent.click(
      within(await screen.findByRole('group', { name: '1級建築施工管理技士' })).getByText('任意'),
    )

    await userEvent.click(screen.getByRole('button', { name: /名前を付けて保存/ }))

    expect(await screen.findByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('読み込んだセットを、上書き保存できる（id と名前は同じ）', async () => {
    const calls = renderPage()
    await loadSavedSet()
    await userEvent.click(within(row('1級建築施工管理技士')).getByText('必須'))

    await userEvent.click(screen.getByRole('button', { name: '上書き保存' }))
    await userEvent.click(await screen.findByRole('button', { name: '上書き' }))

    await waitFor(() => {
      expect(calls.updated).toHaveLength(1)
    })
    expect(calls.updated[0]?.id).toBe('set-1')
    expect(calls.updated[0]?.body).toMatchObject({ name: '現場監督' })
    const conditions = (calls.updated[0]?.body as { conditions: Condition[] }).conditions
    expect(conditions.map((c) => c.id)).toEqual(['q1', 'q2', 's1', 'custom-1'])
  })

  it('読み込んだセットを、削除できる', async () => {
    const calls = renderPage()
    await loadSavedSet()

    await userEvent.click(screen.getByRole('button', { name: '条件セットを削除' }))
    await userEvent.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(calls.deleted).toEqual(['set-1'])
    })
  })

  it('読み込む前は、上書き・削除のボタンを出さない', async () => {
    renderPage()
    await screen.findByText('1級建築施工管理技士')

    expect(screen.queryByRole('button', { name: '上書き保存' })).not.toBeInTheDocument()
  })

  it('保存に失敗したら、サーバーのメッセージを出す', async () => {
    renderPage()
    server.use(
      http.post('*/api/condition-sets', () =>
        HttpResponse.json(
          { code: 'storage_error', message: '保存ファイルを書き込めません' },
          { status: 500 },
        ),
      ),
    )
    await userEvent.click(
      within(await screen.findByRole('group', { name: '1級建築施工管理技士' })).getByText('任意'),
    )
    await userEvent.click(screen.getByRole('button', { name: /名前を付けて保存/ }))
    await userEvent.type(await dialogTextbox(), 'x')

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('保存ファイルを書き込めません')).toBeInTheDocument()
  })
})
