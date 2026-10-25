import { Card, Col, Flex, Row, Typography } from 'antd'
import type { EvaluationPoint } from '../api/types'
import { EvidenceView } from './EvidenceView'
import { MarkdownView } from './MarkdownView'

/** 評価コメントの小見出し（総評・良かった点・悪かった点）。太い文字と下線で、本文と区切る。 */
function SubHeading({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 18,
        fontWeight: 700,
        textAlign: 'center',
        paddingBottom: 6,
        marginBottom: 12,
        borderBottom: '2px solid #d9d9d9',
      }}
    >
      {children}
    </div>
  )
}

function Point({ point }: { point: EvaluationPoint }) {
  return (
    <div>
      <MarkdownView>{point.text}</MarkdownView>
      <EvidenceView reason={point.reason} quotes={point.quotes} />
    </div>
  )
}

function PointColumn({ title, points }: { title: string; points: readonly EvaluationPoint[] }) {
  return (
    <section aria-label={title}>
      <SubHeading>{title}</SubHeading>
      {points.length === 0 ? (
        <Typography.Text type="secondary">該当する項目はありません</Typography.Text>
      ) : (
        <Flex vertical gap={16}>
          {points.map((point, index) => (
            <Point key={index} point={point} />
          ))}
        </Flex>
      )}
    </section>
  )
}

interface CommentsCardProps {
  summary: EvaluationPoint
  strengths: readonly EvaluationPoint[]
  weaknesses: readonly EvaluationPoint[]
}

/**
 * AI の評価コメント（総評・良かった点・悪かった点。仕様 5.5）。Markdown で描画し、項目ごとに、閉じた
 * 「根拠を見る」を付ける。見落とされないよう、条件別の判定より先に置く（13.1 #31）。
 */
export function CommentsCard({ summary, strengths, weaknesses }: CommentsCardProps) {
  return (
    <Card title="AI の評価コメント">
      <Flex vertical gap={24}>
        <section aria-label="総評">
          <SubHeading>総評</SubHeading>
          <Point point={summary} />
        </section>
        <Row gutter={[32, 24]}>
          <Col xs={24} md={12}>
            <PointColumn title="良かった点" points={strengths} />
          </Col>
          <Col xs={24} md={12}>
            <PointColumn title="悪かった点" points={weaknesses} />
          </Col>
        </Row>
      </Flex>
    </Card>
  )
}
