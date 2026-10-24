import { Flex } from 'antd'
import { FlowSteps, type FlowStepItem } from '../components/FlowSteps'
import { conditionCounts, stepStatuses } from '../state/flow'
import { useFlow } from '../state/flow-context'
import { ConditionsStep } from './ConditionsStep'

/** 評価フロー（① 条件 → ② 職歴書 → ③ 結果）。Steps と、現在のステップの内容。 */
export function FlowPage() {
  const { state, dispatch } = useFlow()
  const [conditions, resume, result] = stepStatuses(state)
  const counts = conditionCounts(state)

  const items: [FlowStepItem, FlowStepItem, FlowStepItem] = [
    {
      title: '条件',
      status: conditions,
      summary:
        state.step > 0 || state.furthest > 0
          ? `必須 ${String(counts.required)}・任意 ${String(counts.optional)}`
          : undefined,
    },
    {
      title: '職歴書',
      status: resume,
      summary: state.resume?.check.status === 'ok' ? state.resume.name : undefined,
    },
    { title: '結果', status: result },
  ]

  return (
    <Flex vertical gap={24}>
      <FlowSteps
        items={items}
        current={state.step}
        reachable={state.furthest}
        locked={state.evaluation.status === 'running'}
        onSelect={(step) => {
          dispatch({ type: 'goTo', step })
        }}
      />
      {state.step === 0 ? <ConditionsStep /> : <p>この画面は、これから作ります。</p>}
    </Flex>
  )
}
