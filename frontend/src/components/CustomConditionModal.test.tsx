import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Condition } from '../api/types'
import { renderWithProviders } from '../test/render'
import { CustomConditionModal } from './CustomConditionModal'

function setup(initial?: Condition) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  renderWithProviders(
    <CustomConditionModal open initial={initial} onSubmit={onSubmit} onCancel={onCancel} />,
  )
  return { onSubmit, onCancel }
}

const existing: Condition = {
  id: 'custom-1',
  label: '耐震診断の経験',
  kind: 'number',
  required: true,
  min_value: 3,
  unit: '年',
  source: 'custom',
  category: null,
}

describe('CustomConditionModal', () => {
  it('名前を入れて「追加」すると、boolean の自由記述の条件になる', async () => {
    const { onSubmit } = setup()

    await userEvent.type(screen.getByRole('textbox'), '  耐震診断の経験  ')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        label: '耐震診断の経験',
        kind: 'boolean',
        required: false,
        min_value: null,
        unit: null,
        source: 'custom',
        category: null,
      }),
    )
    const [condition] = onSubmit.mock.calls[0] as [Condition]
    expect(condition.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('名前が空（空白だけ）なら、追加できず、入力を促す', async () => {
    const { onSubmit } = setup()

    await userEvent.type(screen.getByRole('textbox'), '   ')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(await screen.findByText('条件の名前を入力してください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('「年数」を選ぶと最低値の入力欄が出て、未入力なら追加できない', async () => {
    const { onSubmit } = setup()
    await userEvent.type(screen.getByRole('textbox'), 'BIM の経験')

    await userEvent.click(screen.getByRole('radio', { name: '年数（経験年数など）' }))
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(await screen.findByText('最低値を入力してください')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('「年数」で最低値を入れると、number の条件（単位は年）になる', async () => {
    const { onSubmit } = setup()
    await userEvent.type(screen.getByRole('textbox'), 'BIM の経験')
    await userEvent.click(screen.getByRole('radio', { name: '年数（経験年数など）' }))

    await userEvent.type(screen.getByRole('spinbutton'), '2.5')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'number', min_value: 2.5, unit: '年' }),
    )
  })

  it('「有無」に戻すと、最低値は送らない', async () => {
    const { onSubmit } = setup()
    await userEvent.type(screen.getByRole('textbox'), 'X')
    await userEvent.click(screen.getByRole('radio', { name: '年数（経験年数など）' }))
    await userEvent.type(screen.getByRole('spinbutton'), '4')
    await userEvent.click(screen.getByRole('radio', { name: '有無（保有しているか）' }))

    await userEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'boolean', min_value: null, unit: null }),
    )
  })

  it('編集では、元の値が入っていて、id と必須の指定を保ったまま保存できる', async () => {
    const { onSubmit } = setup(existing)

    expect(screen.getByRole('textbox')).toHaveValue('耐震診断の経験')
    expect(await screen.findByRole('spinbutton')).toHaveValue('3.0')
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), '耐震改修の経験')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSubmit).toHaveBeenCalledWith({ ...existing, label: '耐震改修の経験' })
  })

  it('キャンセルできる', async () => {
    const { onSubmit, onCancel } = setup()

    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
