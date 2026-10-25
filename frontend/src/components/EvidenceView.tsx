import { Button, Flex, Typography } from 'antd'
import { useId, useState } from 'react'
import type { VerifiedQuote } from '../api/types'

interface EvidenceViewProps {
  reason: string
  quotes: readonly VerifiedQuote[]
}

// 原文との照合の注意（色つきのタグにはせず、小さな文字で示す）
const NOTE_STYLE = { fontSize: 12, color: '#873800' } as const

function QuoteItem({ quote }: { quote: VerifiedQuote }) {
  return (
    <li style={{ marginBottom: 8 }}>
      <Flex gap={8} align="center" wrap>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {quote.source_name}
          {quote.location ? `（${quote.location}）` : ''}
        </Typography.Text>
        {quote.verified === 'not_found' ? (
          <Typography.Text style={NOTE_STYLE}>原文で確認できず</Typography.Text>
        ) : null}
        {quote.verified === 'skipped' ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            未照合
          </Typography.Text>
        ) : null}
      </Flex>
      {/* 引用は原文の抜粋。Markdown として解釈せず、そのままの文字で見せる */}
      <blockquote
        style={{
          margin: '4px 0 0',
          padding: '4px 12px',
          borderLeft: '3px solid #d9d9d9',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {quote.text}
      </blockquote>
    </li>
  )
}

/**
 * 根拠（仕様 5.5）。結果の幅を取らないよう、既定では閉じておき、「根拠を見る」で `reason` と引用を
 * 開く。原文で確認できなかった引用がある項目は、閉じていても、その旨を小さく示す。
 */
export function EvidenceView({ reason, quotes }: EvidenceViewProps) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const hasReason = reason.trim() !== ''

  if (!hasReason && quotes.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        根拠が出力されませんでした
      </Typography.Text>
    )
  }

  const hasUnverified = quotes.some((quote) => quote.verified === 'not_found')

  return (
    <div>
      <Flex gap={12} align="center" wrap>
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto', fontSize: 12 }}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setOpen(!open)
          }}
        >
          {open ? '根拠を閉じる' : '根拠を見る'}
        </Button>
        {hasUnverified && !open ? (
          <Typography.Text style={NOTE_STYLE}>原文で確認できず</Typography.Text>
        ) : null}
      </Flex>
      {open ? (
        <div id={bodyId} style={{ marginTop: 4 }}>
          {hasReason ? (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              {reason}
            </Typography.Paragraph>
          ) : null}
          {quotes.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {quotes.map((quote, index) => (
                <QuoteItem key={index} quote={quote} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
