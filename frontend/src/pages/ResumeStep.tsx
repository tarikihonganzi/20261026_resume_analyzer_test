import { Button, Card, Flex, Tooltip, message } from 'antd'
import { useSettings } from '../api/hooks'
import { ConditionsBadge } from '../components/ConditionsBadge'
import { ResumeInput } from '../components/ResumeInput'
import { ResumeList } from '../components/ResumeList'
import { MAX_RESUMES, canEvaluate, conditionCounts, resumesStatus } from '../state/flow'
import { useFlow } from '../state/flow-context'

const PASTED_TEXT_NAME = '貼り付けテキスト'

/**
 * ② 職歴書。ファイル（複数）か貼り付けテキストを選ぶと、その場で 1 件ずつ検証し、アップロード済みの
 * 一覧に並べる（削除できる）。「評価する」で ③ へ進む。
 */
export function ResumeStep() {
  const { state, dispatch } = useFlow()
  const settings = useSettings()
  const [messageApi, contextHolder] = message.useMessage()

  const counts = conditionCounts(state)
  const keyIsUnset = settings.data?.openai_api_key_masked === ''
  const ready = canEvaluate(state)
  const status = resumesStatus(state)

  const pasted = state.resumes.find((item) => item.source.kind === 'text')
  const disabledReason = keyIsUnset
    ? '評価するには、設定ページで API キーを登録してください'
    : status === 'empty'
      ? '職歴書を選んでください'
      : status === 'checking'
        ? '職歴書を確認しています'
        : status === 'error'
          ? '使えない職歴書を削除してください'
          : undefined

  return (
    <Card>
      {contextHolder}
      <Flex vertical gap={20}>
        <ConditionsBadge
          required={counts.required}
          optional={counts.optional}
          onChange={() => {
            dispatch({ type: 'goTo', step: 0 })
          }}
        />
        <ResumeInput
          count={state.resumes.length}
          pastedText={pasted?.source.kind === 'text' ? pasted.source.text : null}
          onSelectFile={(file) => {
            dispatch({ type: 'resumeAdded', source: { kind: 'file', file }, name: file.name })
          }}
          onSelectText={(text) => {
            dispatch({
              type: 'resumeAdded',
              source: { kind: 'text', text },
              name: PASTED_TEXT_NAME,
            })
          }}
          onClearText={() => {
            if (pasted) dispatch({ type: 'resumeRemoved', id: pasted.id })
          }}
          onLimit={() => {
            void messageApi.warning(
              `職歴書は、最大 ${String(MAX_RESUMES)} 件までです。超える分は、追加しませんでした`,
            )
          }}
        />
        <ResumeList
          items={state.resumes}
          onRemove={(id) => {
            dispatch({ type: 'resumeRemoved', id })
          }}
        />
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
