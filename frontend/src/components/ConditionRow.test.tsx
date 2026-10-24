import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ConditionItem } from '../lib/conditionItems'
import type { Selection } from '../state/flow'
import { ConditionRow } from './ConditionRow'

const boolean: ConditionItem = {
  id: 'q1',
  label: '1級建築施工管理技士',
  kind: 'boolean',
  unit: null,
  category: '資格',
  description: null,
  source: 'preset',
}
const number: ConditionItem = {
  id: 's1',
  label: 'Revit の実務経験',
  kind: 'number',
  unit: '年',
  category: 'スキル・ツール',
  description: null,
  source: 'preset',
}

function setup(item: ConditionItem, selection?: Selection) {
  const onModeChange = vi.fn()
  const onMinValueChange = vi.fn()
  render(
    <ConditionRow
      item={item}
      selection={selection}
      onModeChange={onModeChange}
      onMinValueChange={onMinValueChange}
    />,
  )
  return { onModeChange, onMinValueChange, row: screen.getByRole('group', { name: item.label }) }
}

describe('ConditionRow', () => {
  it('選択がなければ「使わない」になっている', () => {
    const { row } = setup(boolean)

    expect(within(row).getByRole('radio', { name: '使わない' })).toBeChecked()
  })

  it('「任意」「必須」に切り替えると、通知する', async () => {
    const { row, onModeChange } = setup(boolean)

    await userEvent.click(within(row).getByText('必須'))
    await userEvent.click(within(row).getByText('任意'))

    expect(onModeChange).toHaveBeenNthCalledWith(1, 'required')
    expect(onModeChange).toHaveBeenNthCalledWith(2, 'optional')
  })

  it('boolean の条件には、最低値の入力欄が出ない', () => {
    const { row } = setup(boolean, { kind: 'boolean', mode: 'required', minValue: null })

    expect(within(row).queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('number の条件は、「使わない」のときは入力欄が出ない', () => {
    const { row } = setup(number, { kind: 'number', mode: 'off', minValue: null })

    expect(within(row).queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('number の条件は、「任意」「必須」のとき、最低値の入力欄と単位が出る', () => {
    const { row } = setup(number, { kind: 'number', mode: 'optional', minValue: 2.5 })

    expect(within(row).getByRole('spinbutton')).toHaveValue('2.5')
    expect(within(row).getByText('年')).toBeInTheDocument()
  })

  it('最低値は、小数第 1 位まで表示する', () => {
    const { row } = setup(number, { kind: 'number', mode: 'required', minValue: 5 })

    expect(within(row).getByRole('spinbutton')).toHaveValue('5.0')
  })

  it('最低値が未入力なら、行を強調して、入力を促す', () => {
    const { row } = setup(number, { kind: 'number', mode: 'required', minValue: null })

    expect(within(row).getByText('最低値を入力してください')).toBeInTheDocument()
  })

  it('最低値が 0 なら、入力済みとして、強調しない', () => {
    const { row } = setup(number, { kind: 'number', mode: 'required', minValue: 0 })

    expect(within(row).queryByText('最低値を入力してください')).not.toBeInTheDocument()
  })

  it('最低値を入力すると、数値で通知する', async () => {
    const { row, onMinValueChange } = setup(number, {
      kind: 'number',
      mode: 'required',
      minValue: null,
    })

    await userEvent.type(within(row).getByRole('spinbutton'), '3')

    expect(onMinValueChange).toHaveBeenCalledWith(3)
  })

  it('最低値を消すと、null で通知する', async () => {
    const { row, onMinValueChange } = setup(number, {
      kind: 'number',
      mode: 'required',
      minValue: 3,
    })

    await userEvent.clear(within(row).getByRole('spinbutton'))

    expect(onMinValueChange).toHaveBeenLastCalledWith(null)
  })

  it('自由記述の条件には「独自」の印が付く', () => {
    setup({ ...boolean, source: 'custom', category: '自由記述' })

    expect(screen.getByText('独自')).toBeInTheDocument()
  })
})

describe('補足説明（仕様 5.1・13.1 #27）', () => {
  it('補足説明があれば、条件名の下に表示する', () => {
    setup({ ...boolean, description: '検査への立会い・試験の記録を数える。' })

    expect(screen.getByText('検査への立会い・試験の記録を数える。')).toBeInTheDocument()
  })

  it('補足説明がなければ、何も出さない', () => {
    const { row } = setup(boolean)

    expect(within(row).queryByText(/数える/)).not.toBeInTheDocument()
  })
})
