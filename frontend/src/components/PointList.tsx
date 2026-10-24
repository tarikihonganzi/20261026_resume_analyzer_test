import { Card, Flex, Typography } from 'antd'
import type { EvaluationPoint } from '../api/types'
import { EvidenceView } from './EvidenceView'
import { MarkdownView } from './MarkdownView'

interface PointListProps {
  title: string
  points: readonly EvaluationPoint[]
  /** 項目が 0 件のときの表示。 */
  emptyText?: string
}

/** 概要・良かった点・悪かった点。本文は Markdown で描画し、項目ごとに根拠をつける（仕様 5.5）。 */
export function PointList({
  title,
  points,
  emptyText = '該当する項目はありません',
}: PointListProps) {
  return (
    <Card title={title} size="small">
      {points.length === 0 ? (
        <Typography.Text type="secondary">{emptyText}</Typography.Text>
      ) : (
        <Flex vertical gap={16}>
          {points.map((point, index) => (
            <div key={index}>
              <MarkdownView>{point.text}</MarkdownView>
              <EvidenceView reason={point.reason} quotes={point.quotes} />
            </div>
          ))}
        </Flex>
      )}
    </Card>
  )
}
