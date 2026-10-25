import { Card, Col, Flex, Row, Typography } from 'antd'
import type { JudgedCondition } from '../api/types'
import { groupJudgements, valueLine, type JudgementGroup } from '../lib/result'
import { EvidenceView } from './EvidenceView'
import { ResultMark, type MarkKind } from './ResultMark'

function Item({ judged }: { judged: JudgedCondition }) {
  const kind: MarkKind =
    judged.status === 'achieved' ? 'clear' : judged.status === 'unmet' ? 'unmet' : 'unknown'
  const line = valueLine(judged)

  return (
    <li style={{ padding: '10px 0', borderTop: '1px solid #f0f0f0' }}>
      <Flex gap={8} align="flex-start">
        <ResultMark kind={kind} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Typography.Text strong>{judged.condition.label}</Typography.Text>
          {line ? (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13 }}>
              {line}
            </Typography.Text>
          ) : null}
          <EvidenceView reason={judged.reason} quotes={judged.quotes} />
        </div>
      </Flex>
    </li>
  )
}

function Column({
  label,
  mark,
  items,
}: {
  label: string
  mark: MarkKind
  items: readonly JudgedCondition[]
}) {
  return (
    <section aria-label={label}>
      <Typography.Text strong>
        <ResultMark kind={mark} /> {label}（{items.length}）
      </Typography.Text>
      {items.length === 0 ? (
        <div style={{ padding: '10px 0' }}>
          <Typography.Text type="secondary">なし</Typography.Text>
        </div>
      ) : (
        <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
          {items.map((judged) => (
            <Item key={judged.condition.id} judged={judged} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Section({ title, group }: { title: string; group: JudgementGroup }) {
  const total = group.clear.length + group.ng.length
  if (total === 0) return null

  return (
    <Card size="small" title={`${title}（${String(total)} 件）`} style={{ marginTop: 12 }}>
      <Row gutter={[32, 16]}>
        <Col xs={24} md={12}>
          <Column label="クリア" mark="clear" items={group.clear} />
        </Col>
        <Col xs={24} md={12}>
          <Column label="NG" mark="unmet" items={group.ng} />
        </Col>
      </Row>
    </Card>
  )
}

/**
 * 条件別の判定（仕様 5.5、13.1 #31）。「必須」「任意」のセクションに分け（必須が上）、各セクションを
 * 「クリア」「NG」の 2 列にして、条件を並べる。判定は、タグではなく記号（○ × △）で示す。
 */
export function JudgementSections({ conditions }: { conditions: readonly JudgedCondition[] }) {
  const groups = groupJudgements(conditions)

  return (
    <section aria-label="条件別の判定">
      <Typography.Title level={5} style={{ marginBottom: 4 }}>
        条件別の判定
      </Typography.Title>
      <Flex gap={16} wrap>
        {(
          [
            ['clear', 'クリア'],
            ['unmet', '未達'],
            ['unknown', '不明（職歴書から確認できなかった。NG の列に入ります）'],
          ] as const
        ).map(([kind, label]) => (
          <Typography.Text key={kind} type="secondary" style={{ fontSize: 12 }}>
            <ResultMark kind={kind} /> {label}
          </Typography.Text>
        ))}
      </Flex>
      <Section title="必須条件" group={groups.required} />
      <Section title="任意条件" group={groups.optional} />
    </section>
  )
}
