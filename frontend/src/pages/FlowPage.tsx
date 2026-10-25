import { Flex } from 'antd'
import { useEffect, useRef } from 'react'
import { FlowSteps, type FlowStepItem } from '../components/FlowSteps'
import { conditionCounts, stepStatuses } from '../state/flow'
import { useFlow } from '../state/flow-context'
import { ConditionsStep } from './ConditionsStep'
import { ResultStep } from './ResultStep'
import { ResumeStep } from './ResumeStep'

const STEP_LABELS = ['① 条件', '② 書類', '③ 結果'] as const

/** 評価フロー（① 条件 → ② 書類 → ③ 結果）。Steps と、現在のステップの内容。 */
export function FlowPage() {
  const { state, dispatch } = useFlow()
  const [conditions, resume, result] = stepStatuses(state)
  const counts = conditionCounts(state)

  // 画面が切り替わる（ステップが変わる、評価が終わる）と、押したボタンが消える。フォーカスが
  // 失われて先頭に戻らないよう、新しい画面の領域へ移す（スクリーンリーダーには、領域の名前が読まれる）
  const region = useRef<HTMLDivElement>(null)
  const screenKey = `${String(state.step)}:${state.evaluation.status}`
  const shownScreen = useRef(screenKey)
  useEffect(() => {
    if (shownScreen.current === screenKey) return
    shownScreen.current = screenKey
    region.current?.focus()
  }, [screenKey])

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
      title: '書類',
      status: resume,
      // ファイル名は並べない（複数のファイルや、長い名前でも、表示が崩れないように。仕様 6.2）
      summary: resume === 'finish' ? 'ファイルアップロード完了' : undefined,
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
      <div
        ref={region}
        role="region"
        aria-label={STEP_LABELS[state.step]}
        // プログラムからフォーカスを移すだけの領域（操作はしない）なので、枠線は出さない
        tabIndex={-1}
        style={{ outline: 'none' }}
      >
        {state.step === 0 ? <ConditionsStep /> : null}
        {state.step === 1 ? <ResumeStep /> : null}
        {state.step === 2 ? <ResultStep /> : null}
      </div>
    </Flex>
  )
}
