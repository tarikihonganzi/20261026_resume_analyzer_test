import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FlowSteps, type FlowStepItem } from './FlowSteps'

const items = (
  overrides: Partial<FlowStepItem>[] = [],
): [FlowStepItem, FlowStepItem, FlowStepItem] => [
  { title: '① 条件', status: 'finish', summary: '必須 2・任意 3', ...overrides[0] },
  { title: '② 職歴書', status: 'process', ...overrides[1] },
  { title: '③ 結果', status: 'wait', ...overrides[2] },
]

describe('FlowSteps', () => {
  it('各ステップの名前と、完了したステップの要約を表示する', () => {
    render(<FlowSteps items={items()} current={1} reachable={1} onSelect={vi.fn()} />)

    expect(screen.getByText('① 条件')).toBeInTheDocument()
    expect(screen.getByText('② 職歴書')).toBeInTheDocument()
    expect(screen.getByText('③ 結果')).toBeInTheDocument()
    expect(screen.getByText('必須 2・任意 3')).toBeInTheDocument()
  })

  it('完了済みのステップをクリックして戻れる', async () => {
    const onSelect = vi.fn()
    render(<FlowSteps items={items()} current={1} reachable={1} onSelect={onSelect} />)

    await userEvent.click(screen.getByText('① 条件'))

    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('未到達のステップへは飛べない', async () => {
    const onSelect = vi.fn()
    render(<FlowSteps items={items()} current={1} reachable={1} onSelect={onSelect} />)

    await userEvent.click(screen.getByText('③ 結果'))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('評価中（locked）は、どこへも移動できない', async () => {
    const onSelect = vi.fn()
    render(<FlowSteps items={items()} current={2} reachable={2} locked onSelect={onSelect} />)

    await userEvent.click(screen.getByText('① 条件'))
    await userEvent.click(screen.getByText('② 職歴書'))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('エラーのステップを、エラー状態で表示する', () => {
    const { container } = render(
      <FlowSteps
        items={items([{}, { status: 'finish' }, { status: 'error' }])}
        current={2}
        reachable={2}
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelector('.ant-steps-item-error')).not.toBeNull()
  })
})
