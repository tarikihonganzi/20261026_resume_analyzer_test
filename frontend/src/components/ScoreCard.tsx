import { Card, Flex, Statistic, Tag, Typography } from 'antd'
import type { EvaluationResult } from '../api/types'

/** 最終スコアとマッチ度合い。補正があったときは、元のスコアと補正の理由を併記する（仕様 5.5）。 */
export function ScoreCard({ result }: { result: EvaluationResult }) {
  return (
    <Card>
      <Flex gap={48} align="flex-start" wrap>
        <Flex vertical gap={4}>
          <Statistic
            title="最終スコア"
            value={result.score}
            suffix="/ 100"
            styles={{ content: { fontSize: 48, fontWeight: 600 } }}
          />
          {result.clipped ? (
            <Flex gap={8} align="center" wrap>
              <Tag color="orange">補正あり</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                AI の元のスコアは {result.original_score} 点。マッチ度合いから ±20
                点の範囲に収めました。
              </Typography.Text>
            </Flex>
          ) : null}
        </Flex>
        <Statistic
          title="マッチ度合い"
          value={result.match_rate}
          suffix="%"
          styles={{ content: { fontSize: 48 } }}
        />
      </Flex>
    </Card>
  )
}
