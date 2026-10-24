import { Steps } from 'antd'

export type StepStatus = 'wait' | 'process' | 'finish' | 'error'

export interface FlowStepItem {
  title: string
  status: StepStatus
  /** 完了したステップの要約（例: 「必須 2・任意 3」）。 */
  summary?: string
}

interface FlowStepsProps {
  items: readonly [FlowStepItem, FlowStepItem, FlowStepItem]
  current: 0 | 1 | 2
  /** クリックして移動できる、いちばん先のステップ。これより先には飛べない。 */
  reachable: number
  /** 評価中などで、移動できないとき。 */
  locked?: boolean
  onSelect: (step: 0 | 1 | 2) => void
}

/** 画面上部のステップ表示（仕様 6.2）。完了済みのステップには、クリックして戻れる。 */
export function FlowSteps({ items, current, reachable, locked = false, onSelect }: FlowStepsProps) {
  return (
    <Steps
      current={current}
      onChange={(next) => {
        if (next === 0 || next === 1 || next === 2) onSelect(next)
      }}
      items={items.map((item, index) => ({
        title: item.title,
        content: item.summary,
        status: item.status,
        disabled: locked || index > reachable || index === current,
      }))}
    />
  )
}
