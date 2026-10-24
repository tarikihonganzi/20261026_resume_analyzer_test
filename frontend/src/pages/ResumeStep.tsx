import { Button, Card, Flex, Tooltip } from 'antd'
import { useSettings } from '../api/hooks'
import { ConditionsBadge } from '../components/ConditionsBadge'
import { ResumeCheckResult } from '../components/ResumeCheckResult'
import { ResumeInput } from '../components/ResumeInput'
import { canEvaluate, conditionCounts } from '../state/flow'
import { useFlow } from '../state/flow-context'
import { useResumeCheck } from './useResumeCheck'

/** ② 職歴書。ファイルか貼り付けテキストを選ぶと、その場で検証する。「評価する」で ③ へ進む。 */
export function ResumeStep() {
  const { state, dispatch } = useFlow()
  const settings = useSettings()
  useResumeCheck()

  const counts = conditionCounts(state)
  const keyIsUnset = settings.data?.openai_api_key_masked === ''
  const ready = canEvaluate(state)

  const disabledReason = keyIsUnset
    ? '評価するには、設定ページで API キーを登録してください'
    : state.resume === null
      ? '職歴書を選んでください'
      : state.resume.check.status === 'checking'
        ? '職歴書を確認しています'
        : state.resume.check.status === 'error'
          ? '使える職歴書を選んでください'
          : undefined

  return (
    <Card>
      <Flex vertical gap={20}>
        <ConditionsBadge
          required={counts.required}
          optional={counts.optional}
          onChange={() => {
            dispatch({ type: 'goTo', step: 0 })
          }}
        />
        <ResumeInput
          initial={
            state.resume === null
              ? null
              : state.resume.source.kind === 'text'
                ? { kind: 'text', text: state.resume.source.text }
                : { kind: 'file' }
          }
          onSelectFile={(file) => {
            dispatch({ type: 'resumeSelected', source: { kind: 'file', file }, name: file.name })
          }}
          onSelectText={(text) => {
            dispatch({
              type: 'resumeSelected',
              source: { kind: 'text', text },
              name: '貼り付けテキスト',
            })
          }}
          onClear={() => {
            dispatch({ type: 'clearResume' })
          }}
        />
        {state.resume ? <ResumeCheckResult resume={state.resume} /> : null}
        <Flex justify="space-between">
          <Button
            onClick={() => {
              dispatch({ type: 'back' })
            }}
          >
            戻る
          </Button>
          <Tooltip title={ready && !keyIsUnset ? undefined : disabledReason}>
            <span>
              <Button
                type="primary"
                disabled={!ready || keyIsUnset}
                onClick={() => {
                  dispatch({ type: 'startEvaluation' })
                }}
              >
                評価する
              </Button>
            </span>
          </Tooltip>
        </Flex>
      </Flex>
    </Card>
  )
}
