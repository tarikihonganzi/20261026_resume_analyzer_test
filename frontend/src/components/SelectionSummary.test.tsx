import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SelectionSummary } from './SelectionSummary'

const summary = {
  required: [
    { id: 'q1', text: '1級建築施工管理技士' },
    { id: 'e1', text: '現場監督の経験年数 5.0年以上' },
  ],
  optional: [{ id: 's1', text: 'Revit 2.0年以上' }],
}

describe('SelectionSummary', () => {
  it('必須と任意に分けて、件数つきで表示する', () => {
    render(
      <SelectionSummary
        summary={summary}
        onJump={vi.fn()}
        onAddCustom={vi.fn()}
        onNext={vi.fn()}
        nextDisabledReason={null}
      />,
    )

    const required = screen.getByRole('region', { name: '必須' })
    const optional = screen.getByRole('region', { name: '任意' })
    expect(within(required).getByText('必須（2）')).toBeInTheDocument()
    expect(within(required).getByText('現場監督の経験年数 5.0年以上')).toBeInTheDocument()
    expect(within(optional).getByText('任意（1）')).toBeInTheDocument()
    expect(within(optional).getByText('Revit 2.0年以上')).toBeInTheDocument()
  })

  it('項目をクリックすると、その条件の id で通知する', async () => {
    const onJump = vi.fn()
    render(
      <SelectionSummary
        summary={summary}
        onJump={onJump}
        onAddCustom={vi.fn()}
        onNext={vi.fn()}
        nextDisabledReason={null}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Revit 2.0年以上' }))

    expect(onJump).toHaveBeenCalledWith('s1')
  })

  it('何も選ばれていなければ、案内を出す', () => {
    render(
      <SelectionSummary
        summary={{ required: [], optional: [] }}
        onJump={vi.fn()}
        onAddCustom={vi.fn()}
        onNext={vi.fn()}
        nextDisabledReason={null}
      />,
    )

    expect(screen.getByText(/使う条件を「任意」か「必須」にしてください/)).toBeInTheDocument()
  })

  it('片方が空なら「なし」と出す', () => {
    render(
      <SelectionSummary
        summary={{ required: [], optional: summary.optional }}
        onJump={vi.fn()}
        onAddCustom={vi.fn()}
        onNext={vi.fn()}
        nextDisabledReason={null}
      />,
    )

    expect(
      within(screen.getByRole('region', { name: '必須' })).getByText('なし'),
    ).toBeInTheDocument()
  })

  it('「自由記述で条件を追加」を押せる', async () => {
    const onAddCustom = vi.fn()
    render(
      <SelectionSummary
        summary={summary}
        onJump={vi.fn()}
        onAddCustom={onAddCustom}
        onNext={vi.fn()}
        nextDisabledReason={null}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /自由記述で条件を追加/ }))

    expect(onAddCustom).toHaveBeenCalled()
  })

  describe('「次へ」（右の固定列に置く）', () => {
    it('押すと、通知する', async () => {
      const onNext = vi.fn()
      render(
        <SelectionSummary
          summary={summary}
          onJump={vi.fn()}
          onAddCustom={vi.fn()}
          onNext={onNext}
          nextDisabledReason={null}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: /次へ/ }))

      expect(onNext).toHaveBeenCalled()
    })

    it('進めないときは、押せず、理由を、ボタンの近くに示す', () => {
      render(
        <SelectionSummary
          summary={{ required: [], optional: [] }}
          onJump={vi.fn()}
          onAddCustom={vi.fn()}
          onNext={vi.fn()}
          nextDisabledReason="条件を 1 件以上選んでください"
        />,
      )

      expect(screen.getByRole('button', { name: /次へ/ })).toBeDisabled()
      expect(screen.getByText('条件を 1 件以上選んでください')).toBeInTheDocument()
    })
  })

  it('選んだ条件の項目は、リンクの青ではなく、ふつうの文字で示す', () => {
    render(
      <SelectionSummary
        summary={summary}
        onJump={vi.fn()}
        onAddCustom={vi.fn()}
        onNext={vi.fn()}
        nextDisabledReason={null}
      />,
    )

    const item = screen.getByRole('button', { name: 'Revit 2.0年以上' })
    expect(item).not.toHaveClass('ant-btn-variant-link')
  })
})
