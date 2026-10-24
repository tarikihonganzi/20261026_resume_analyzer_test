import { Alert, Button, Card, Flex, Result, Spin, Steps, Typography } from 'antd'
import type { Stage } from '../api/types'
import { useFlow } from '../state/flow-context'
import { useEvaluationRun } from './useEvaluationRun'

const STAGES: Stage[] = ['extracting', 'scoring']

/** ③ 結果。評価中は進捗とキャンセル、失敗したら原因と再実行、成功したら結果を表示する。 */
export function ResultStep() {
  const { state, dispatch } = useFlow()
  useEvaluationRun()
  const evaluation = state.evaluation

  if (evaluation.status === 'running') {
    return (
      <Card>
        <Flex vertical gap={24} align="center" role="status" aria-live="polite">
          <Spin size="large" />
          <Typography.Title level={4} style={{ margin: 0 }}>
            評価しています
          </Typography.Title>
          <Steps
            size="small"
            current={STAGES.indexOf(evaluation.stage)}
            items={[{ title: '職歴書から条件を抽出中' }, { title: '最終評価中' }]}
            style={{ maxWidth: 480 }}
          />
          <Typography.Text type="secondary">
            1〜数分かかることがあります。この画面のままお待ちください。
          </Typography.Text>
          <Button
            onClick={() => {
              dispatch({ type: 'cancelEvaluation' })
            }}
          >
            キャンセル
          </Button>
        </Flex>
      </Card>
    )
  }

  if (evaluation.status === 'error') {
    const { code, message } = evaluation.error
    return (
      <Card>
        <Result
          status="error"
          title="評価できませんでした"
          subTitle={message}
          extra={[
            <Button
              key="retry"
              type="primary"
              onClick={() => {
                dispatch({ type: 'startEvaluation' })
              }}
            >
              もう一度評価する
            </Button>,
            <Button
              key="conditions"
              onClick={() => {
                dispatch({ type: 'goTo', step: 0 })
              }}
            >
              条件に戻る
            </Button>,
          ]}
        >
          {code === 'llm_auth' ? (
            <Alert
              type="warning"
              showIcon
              title="API キーを確認してください"
              description={<a href="#/settings">設定ページを開く</a>}
            />
          ) : null}
        </Result>
      </Card>
    )
  }

  if (evaluation.status === 'done') {
    // 結果画面は T-M6-03 で作る
    return <Card>評価が完了しました（スコア {String(evaluation.result.score)}）</Card>
  }

  return null
}
