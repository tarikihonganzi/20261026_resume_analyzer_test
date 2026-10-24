import { Flex, Typography } from 'antd'
import type { EvaluationResult } from '../api/types'
import { JudgementTable } from '../components/JudgementTable'
import { PointList } from '../components/PointList'
import { RequiredAlert } from '../components/RequiredAlert'
import { ScoreCard } from '../components/ScoreCard'

/** ③ の結果。仕様 5.5 の順に表示する（スコア → 必須未達 → 判定表 → 概要 → 良い点 → 悪い点 → 注意書き）。 */
export function ResultView({ result }: { result: EvaluationResult }) {
  return (
    <Flex vertical gap={16}>
      <ScoreCard result={result} />
      <RequiredAlert result={result} />
      <div>
        <Typography.Title level={5}>条件別の判定</Typography.Title>
        <JudgementTable conditions={result.conditions} />
      </div>
      <PointList title="評価の概要" points={[result.summary]} />
      <PointList title="良かった点" points={result.strengths} />
      <PointList title="悪かった点" points={result.weaknesses} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        本結果は判断材料です。最終的な判断は人が行ってください。
      </Typography.Text>
    </Flex>
  )
}
