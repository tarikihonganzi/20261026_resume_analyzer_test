import { Alert, Button, Card, Flex, Result, Spin, Steps, Typography } from 'antd'
import type { Stage } from '../api/types'
import { ApplicantName } from '../components/ApplicantName'
import { useFlow } from '../state/flow-context'
import { ResultView } from './ResultView'
import { useEvaluationRun } from './useEvaluationRun'

// 画面の進捗の並び。サーバーが流す `stage` イベントの順と同じ
const STAGES: Stage[] = ['extracting', 'scoring']

// 設定ページで直せる失敗: 認証（API キー）と、リクエストの拒否（モデル名・ベース URL の誤り）
const SETTINGS_ERROR_CODES: ReadonlySet<string> = new Set(['llm_auth', 'llm_request'])

/** ③ 結果。評価中は進捗とキャンセル、失敗したら原因と再実行、成功したら結果を表示する。 */
export function ResultStep() {
  const { state, dispatch } = useFlow()
  useEvaluationRun()
  const evaluation = state.evaluation

  if (evaluation.status === 'running') {
    return (
      <Card>
        {/* 文字を選択できなくする。回転するアイコンの上に、選択の色やキャレットが重なって、
            見た目が崩れるのを防ぐ */}
        <Flex
          vertical
          gap={24}
          align="center"
          role="status"
          aria-live="polite"
          style={{ userSelect: 'none' }}
        >
          <Spin size="large" />
          <Typography.Title level={4} style={{ margin: 0 }}>
            評価しています
          </Typography.Title>
          <Steps
            size="small"
            current={STAGES.indexOf(evaluation.stage)}
            items={[{ title: '書類から条件を抽出中' }, { title: '最終評価中' }]}
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
              再実行
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
          {SETTINGS_ERROR_CODES.has(code) ? (
            <Alert
              type="warning"
              showIcon
              title="設定を確認してください"
              description={<a href="#/settings">設定ページを開く</a>}
            />
          ) : null}
        </Result>
      </Card>
    )
  }

  if (evaluation.status === 'done') {
    return (
      <Flex vertical gap={16}>
        {/* 左に応募者の氏名、右に操作のボタン。狭い画面では、折り返して縦に並ぶ */}
        <Flex justify="space-between" align="center" gap={8} wrap>
          <ApplicantName name={evaluation.result.applicant_name} />
          <Flex gap={8} wrap>
            <Button
              onClick={() => {
                dispatch({ type: 'reevaluate' })
              }}
            >
              条件を変えて再評価
            </Button>
            <Button
              type="primary"
              onClick={() => {
                dispatch({ type: 'newApplicant' })
              }}
            >
              別の応募者を評価
            </Button>
          </Flex>
        </Flex>
        <ResultView result={evaluation.result} />
      </Flex>
    )
  }

  // idle: 評価を始める前は、何も出さない（② から開始すると、すぐ running になる）
  return null
}
