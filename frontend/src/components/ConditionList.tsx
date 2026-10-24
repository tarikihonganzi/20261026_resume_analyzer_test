import { Empty, Typography } from 'antd'
import type { ReactNode } from 'react'
import { groupByCategory, type ConditionItem } from '../lib/conditionItems'
import type { Mode, Selection } from '../state/flow'
import { ConditionRow } from './ConditionRow'

interface ConditionListProps {
  items: readonly ConditionItem[]
  selections: Readonly<Record<string, Selection>>
  onModeChange: (item: ConditionItem, mode: Mode) => void
  onMinValueChange: (item: ConditionItem, minValue: number | null) => void
  /** 行の右端の操作（自由記述の編集・削除）。 */
  rowActions?: (item: ConditionItem) => ReactNode
  /** カテゴリの末尾に出すもの（自由記述の「追加」ボタン）。 */
  groupFooter?: (category: string) => ReactNode
  /** 項目がなくても出すカテゴリ（自由記述）。 */
  alwaysShow?: readonly string[]
}

/** 条件の一覧。カテゴリ（資格・認定／スキル・ツール／施工図・図面／施工管理／現場事務・書類／経験年数／自由記述）ごとに、まとめて表示する。 */
export function ConditionList({
  items,
  selections,
  onModeChange,
  onMinValueChange,
  rowActions,
  groupFooter,
  alwaysShow = [],
}: ConditionListProps) {
  const groups = groupByCategory(items)
  for (const category of alwaysShow) {
    if (!groups.some((g) => g.category === category)) groups.push({ category, items: [] })
  }

  if (groups.length === 0) {
    return <Empty description="条件に一致するものがありません" />
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.category} aria-label={group.category} style={{ marginBottom: 24 }}>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>
            {group.category}
          </Typography.Title>
          <div style={{ border: '1px solid #f0f0f0', borderBottom: 'none', borderRadius: 6 }}>
            {group.items.map((item) => (
              <ConditionRow
                key={item.id}
                item={item}
                selection={selections[item.id]}
                onModeChange={(mode) => {
                  onModeChange(item, mode)
                }}
                onMinValueChange={(minValue) => {
                  onMinValueChange(item, minValue)
                }}
                actions={rowActions?.(item)}
              />
            ))}
            {groupFooter ? (
              <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
                {groupFooter(group.category)}
              </div>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  )
}
