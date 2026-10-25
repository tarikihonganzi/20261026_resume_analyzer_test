import { Flex, Typography } from 'antd'
import type { EvaluationResult } from '../api/types'
import { CommentsCard } from '../components/CommentsCard'
import { JudgementSections } from '../components/JudgementSections'
import { ScoreCard } from '../components/ScoreCard'

/**
 * ③ の結果。仕様 5.5 の順に表示する（最終スコア・必須条件の状況 → AI の評価コメント → 条件別の
 * 判定 → 注意書き）。
 */
export function ResultView({ result }: { result: EvaluationResult }) {
  return (
    <Flex vertical gap={16}>
      <ScoreCard result={result} />
      <CommentsCard
        summary={result.summary}
        strengths={result.strengths}
        weaknesses={result.weaknesses}
      />
      <JudgementSections conditions={result.conditions} />
      <Typography.Text type="secondary" style={{ fontSize: 14 }}>
        本結果は判断材料です。最終的な判断は人が行ってください。
      </Typography.Text>
    </Flex>
  )
}
