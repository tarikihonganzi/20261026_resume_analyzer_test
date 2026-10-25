import { Flex, InputNumber, Segmented, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import type { ConditionItem } from '../lib/conditionItems'
import type { Mode, Selection } from '../state/flow'
import { TAG_STYLES } from './tagStyles'

interface ConditionRowProps {
  item: ConditionItem
  selection: Selection | undefined
  onModeChange: (mode: Mode) => void
  onMinValueChange: (minValue: number | null) => void
  /** 自由記述の「編集」「削除」など、行の右端に出す操作。 */
  actions?: ReactNode
}

const MODE_OPTIONS: { label: string; value: Mode }[] = [
  { label: '使わない', value: 'off' },
  { label: '任意', value: 'optional' },
  { label: '必須', value: 'required' },
]

const MODE_COLORS: Record<Mode, string> = {
  off: 'transparent',
  optional: '#0958d9',
  required: '#cf1322',
}

/** 最低値が入力済み（0 以上）か。number の条件を選んだのに、未入力のとき、行を強調する。 */
export function isMinValueMissing(item: ConditionItem, selection: Selection | undefined): boolean {
  if (item.kind !== 'number' || !selection || selection.mode === 'off') return false
  return selection.minValue === null || selection.minValue < 0
}

/** 条件 1 件の行。「使わない／任意／必須」の切り替えと、number の条件の最低値（仕様 5.1）。 */
export function ConditionRow({
  item,
  selection,
  onModeChange,
  onMinValueChange,
  actions,
}: ConditionRowProps) {
  const mode: Mode = selection?.mode ?? 'off'
  const showMinValue = item.kind === 'number' && mode !== 'off'
  const missing = isMinValueMissing(item, selection)

  return (
    <div
      id={`condition-${item.id}`}
      role="group"
      aria-label={item.label}
      style={{
        padding: '14px 16px 14px 16px',
        borderLeft: `3px solid ${MODE_COLORS[mode]}`,
        borderBottom: '1px solid #f0f0f0',
        background: mode === 'off' ? undefined : '#fafcff',
      }}
    >
      <Flex align="center" justify="space-between" gap={12} wrap>
        <Flex vertical gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Flex align="center" gap={8}>
            <Typography.Text strong={mode !== 'off'}>{item.label}</Typography.Text>
            {item.source === 'custom' ? <Tag style={TAG_STYLES.custom}>独自</Tag> : null}
          </Flex>
          {item.description ? (
            <Typography.Paragraph
              type="secondary"
              style={{ margin: 0, fontSize: 14 }}
              ellipsis={{ rows: 2, tooltip: item.description }}
            >
              {item.description}
            </Typography.Paragraph>
          ) : null}
        </Flex>
        <Flex align="center" gap={8}>
          {actions}
          <Segmented<Mode>
            size="large"
            options={MODE_OPTIONS}
            value={mode}
            onChange={onModeChange}
            aria-label={`${item.label}の使い方`}
          />
        </Flex>
      </Flex>
      {showMinValue ? (
        <Flex align="center" gap={8} style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">最低</Typography.Text>
          <InputNumber
            aria-label={`${item.label}の最低${item.unit ?? ''}`}
            min={0}
            step={0.5}
            precision={1}
            value={selection?.minValue ?? null}
            status={missing ? 'error' : undefined}
            onChange={(value) => {
              onMinValueChange(typeof value === 'number' ? value : null)
            }}
            style={{ width: 96 }}
          />
          <Typography.Text type="secondary">{item.unit ?? '年'}</Typography.Text>
          {missing ? (
            <Typography.Text type="danger">最低値を入力してください</Typography.Text>
          ) : null}
        </Flex>
      ) : null}
    </div>
  )
}
