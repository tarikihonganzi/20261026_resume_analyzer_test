import { PlusOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Flex, Typography } from 'antd'
import type { SelectionSummaryData, SummaryEntry } from '../lib/conditionItems'

interface SelectionSummaryProps {
  summary: SelectionSummaryData
  /** 項目をクリックしたときに、一覧の該当行へ移動する。 */
  onJump: (id: string) => void
  onAddCustom: () => void
}

function Section({
  title,
  color,
  entries,
  onJump,
}: {
  title: string
  color: string
  entries: SummaryEntry[]
  onJump: (id: string) => void
}) {
  return (
    <section aria-label={title} style={{ marginBottom: 16 }}>
      <Typography.Text strong style={{ color }}>
        ■ {title}（{entries.length}）
      </Typography.Text>
      {entries.length === 0 ? (
        <div>
          <Typography.Text type="secondary">なし</Typography.Text>
        </div>
      ) : (
        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  onJump(entry.id)
                }}
                style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }}
              >
                {entry.text}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 右側の要約パネル。選んだ条件を「必須」「任意」に分けて、リアルタイムで表示する。 */
export function SelectionSummary({ summary, onJump, onAddCustom }: SelectionSummaryProps) {
  const total = summary.required.length + summary.optional.length

  return (
    <Card title="選択中の条件" size="small">
      {total === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="左の一覧で、使う条件を「任意」か「必須」にしてください"
        />
      ) : (
        <>
          <Section title="必須" color="#cf1322" entries={summary.required} onJump={onJump} />
          <Section title="任意" color="#1677ff" entries={summary.optional} onJump={onJump} />
        </>
      )}
      <Flex justify="flex-start">
        <Button type="dashed" icon={<PlusOutlined />} onClick={onAddCustom} block>
          自由記述で条件を追加
        </Button>
      </Flex>
    </Card>
  )
}
