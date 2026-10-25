import { SearchOutlined } from '@ant-design/icons'
import { Button, Checkbox, Flex, Input } from 'antd'
import type { Filters } from '../lib/conditionItems'

interface ConditionFiltersProps {
  filters: Filters
  categories: readonly string[]
  onChange: (filters: Filters) => void
}

const ALL = ''

/** 検索ボックス、カテゴリでの絞り込み、「選択中のみ」（仕様 5.1）。 */
export function ConditionFilters({ filters, categories, onChange }: ConditionFiltersProps) {
  return (
    <Flex vertical gap={12} style={{ marginBottom: 16 }}>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="条件を検索（例: 施工管理、Revit）"
        aria-label="条件を検索"
        value={filters.query}
        onChange={(event) => {
          onChange({ ...filters, query: event.target.value })
        }}
      />
      <Flex align="center" justify="space-between" gap={12} wrap>
        {/* 幅が固定のタブ（Segmented）だと、狭い画面で、ページが横にはみ出す。折り返すボタンにする */}
        <Flex role="group" aria-label="カテゴリ" gap={8} wrap>
          {[ALL, ...categories].map((category) => {
            const selected = (filters.category ?? ALL) === category
            return (
              <Button
                key={category}
                type={selected ? 'primary' : 'default'}
                aria-pressed={selected}
                onClick={() => {
                  onChange({ ...filters, category: category === ALL ? null : category })
                }}
              >
                {category === ALL ? 'すべて' : category}
              </Button>
            )
          })}
        </Flex>
        <Checkbox
          checked={filters.selectedOnly}
          onChange={(event) => {
            onChange({ ...filters, selectedOnly: event.target.checked })
          }}
        >
          選択中のみ表示
        </Checkbox>
      </Flex>
    </Flex>
  )
}
