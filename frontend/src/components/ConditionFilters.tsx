import { SearchOutlined } from '@ant-design/icons'
import { Checkbox, Flex, Input, Segmented } from 'antd'
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
        <Segmented<string>
          aria-label="カテゴリ"
          options={[{ label: 'すべて', value: ALL }, ...categories]}
          value={filters.category ?? ALL}
          onChange={(value) => {
            onChange({ ...filters, category: value === ALL ? null : value })
          }}
        />
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
