import { Button, Flex, Tag, Typography } from 'antd'
import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import type { VerifiedQuote } from '../api/types'
import { TAG_STYLES } from './tagStyles'

interface EvidenceViewProps {
  reason: string
  quotes: readonly VerifiedQuote[]
}

const VERIFIED_NOTES: Partial<
  Record<VerifiedQuote['verified'], { label: string; style: CSSProperties }>
> = {
  not_found: { label: '原文で確認できず', style: TAG_STYLES.warning },
  skipped: { label: '未照合', style: TAG_STYLES.neutral },
}

function QuoteItem({ quote }: { quote: VerifiedQuote }) {
  const note = VERIFIED_NOTES[quote.verified]
  return (
    <li style={{ marginBottom: 8 }}>
      <Flex gap={8} align="center" wrap>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {quote.source_name}
          {quote.location ? `（${quote.location}）` : ''}
        </Typography.Text>
        {note ? <Tag style={note.style}>{note.label}</Tag> : null}
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

/** 根拠（仕様 5.5）。`reason` を小さく表示し、「引用を見る」で引用を展開する。 */
export function EvidenceView({ reason, quotes }: EvidenceViewProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const hasReason = reason.trim() !== ''

  if (!hasReason && quotes.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        根拠が出力されませんでした
      </Typography.Text>
    )
  }

  return (
    <Flex vertical gap={4} align="flex-start">
      {hasReason ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {reason}
        </Typography.Text>
      ) : null}
      {quotes.length > 0 ? (
        <>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto' }}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => {
              setOpen(!open)
            }}
          >
            {open ? '引用を隠す' : `引用を見る（${String(quotes.length)}）`}
          </Button>
          {open ? (
            <ul id={listId} style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {quotes.map((quote, index) => (
                <QuoteItem key={index} quote={quote} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </Flex>
  )
}
