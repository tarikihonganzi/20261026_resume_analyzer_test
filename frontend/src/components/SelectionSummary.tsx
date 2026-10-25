import { ArrowRightOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Divider, Empty, Flex, Typography } from 'antd'
import type { SelectionSummaryData, SummaryEntry } from '../lib/conditionItems'

interface SelectionSummaryProps {
  summary: SelectionSummaryData
  /** 項目をクリックしたときに、一覧の該当行へ移動する。 */
  onJump: (id: string) => void
  onAddCustom: () => void
  /** ② へ進む。この列に置くので、一覧を最下部までスクロールしなくても押せる（仕様 6.1・13.1 #32）。 */
  onNext: () => void
  /** 進めない理由。進めるときは null。 */
  nextDisabledReason: string | null
}

// 必須は赤、任意は灰色の、小さな印だけで分ける（項目の文字は、ふつうの色）
const MARKER_COLORS = { required: '#cf1322', optional: '#8c8c8c' } as const

function Section({
  title,
  marker,
  entries,
  onJump,
}: {
  title: string
  marker: string
  entries: SummaryEntry[]
  onJump: (id: string) => void
}) {
  return (
    <section aria-label={title} style={{ marginBottom: 16 }}>
      <Typography.Text strong>
        <span style={{ color: marker }} aria-hidden>
          ■
        </span>{' '}
        {title}（{entries.length}）
      </Typography.Text>
      {entries.length === 0 ? (
        <div>
          <Typography.Text type="secondary">なし</Typography.Text>
        </div>
      ) : (
        <ul style={{ margin: '4px 0 0', paddingLeft: 0, listStyle: 'none' }}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <Button
                type="text"
                size="small"
                onClick={() => {
                  onJump(entry.id)
                }}
                style={{
                  height: 'auto',
                  padding: '2px 8px',
                  whiteSpace: 'normal',
                  textAlign: 'left',
                  display: 'block',
                  width: '100%',
                }}
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

/**
 * 右側の、画面に固定した要約パネル。選んだ条件を「必須」「任意」に分けて、リアルタイムで示し、
 * 下端に「次へ」を置く。選んだ条件が多いときは、一覧の部分だけをスクロールして、「次へ」は動かさない。
 */
export function SelectionSummary({
  summary,
  onJump,
  onAddCustom,
  onNext,
  nextDisabledReason,
}: SelectionSummaryProps) {
  const total = summary.required.length + summary.optional.length

  return (
    <Card
      title="選択中の条件"
      size="small"
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
    >
      <div style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 72, overflowY: 'auto' }}>
        {total === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="左の一覧で、使う条件を「任意」か「必須」にしてください"
          />
        ) : (
          <>
            <Section
              title="必須"
              marker={MARKER_COLORS.required}
              entries={summary.required}
              onJump={onJump}
            />
            <Section
              title="任意"
              marker={MARKER_COLORS.optional}
              entries={summary.optional}
              onJump={onJump}
            />
          </>
        )}
      </div>
      <Button icon={<PlusOutlined />} onClick={onAddCustom} block>
        自由記述で条件を追加
      </Button>
      <Divider style={{ margin: 0 }} />
      <Flex vertical gap={8}>
        <Button
          type="primary"
          size="large"
          block
          disabled={nextDisabledReason !== null}
          onClick={onNext}
        >
          次へ（書類を選ぶ）
          <ArrowRightOutlined />
        </Button>
        {nextDisabledReason ? (
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            {nextDisabledReason}
          </Typography.Text>
        ) : null}
      </Flex>
    </Card>
  )
}
