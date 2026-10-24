import { Alert, Button, Card, Flex, Spin } from 'antd'
import { useMemo, useState } from 'react'
import { useCatalog } from '../api/hooks'
import { ConditionFilters } from '../components/ConditionFilters'
import { ConditionList } from '../components/ConditionList'
import {
  CUSTOM_CATEGORY,
  categoriesOf,
  filterItems,
  toItems,
  type Filters,
} from '../lib/conditionItems'
import { isConditionsComplete } from '../state/flow'
import { useFlow } from '../state/flow-context'

/** ① 条件。3 状態トグルの一覧表で、使う条件を選ぶ（仕様 5.1）。 */
export function ConditionsStep() {
  const { state, dispatch } = useFlow()
  const catalog = useCatalog()
  const [filters, setFilters] = useState<Filters>({
    query: '',
    category: null,
    selectedOnly: false,
  })

  const items = useMemo(
    () => toItems(catalog.data ?? [], state.customConditions),
    [catalog.data, state.customConditions],
  )
  const visible = useMemo(
    () => filterItems(items, filters, state.selections),
    [items, filters, state.selections],
  )

  if (catalog.isPending) {
    return (
      <Flex justify="center" style={{ padding: 48 }}>
        <Spin description="条件を読み込み中" />
      </Flex>
    )
  }
  if (catalog.isError) {
    return (
      <Alert
        type="error"
        showIcon
        title="条件の一覧を読み込めませんでした"
        description={catalog.error.message}
        action={
          <Button
            size="small"
            onClick={() => {
              void catalog.refetch()
            }}
          >
            再読み込み
          </Button>
        }
      />
    )
  }

  return (
    <Card>
      <ConditionFilters
        filters={filters}
        categories={categoriesOf(catalog.data)}
        onChange={setFilters}
      />
      <ConditionList
        items={visible}
        selections={state.selections}
        onModeChange={(item, mode) => {
          dispatch({ type: 'setMode', id: item.id, kind: item.kind, mode })
        }}
        onMinValueChange={(item, minValue) => {
          dispatch({ type: 'setMinValue', id: item.id, minValue })
        }}
        alwaysShow={
          filters.category === null || filters.category === CUSTOM_CATEGORY ? [CUSTOM_CATEGORY] : []
        }
      />
      <Flex justify="flex-end" style={{ marginTop: 8 }}>
        <Button
          type="primary"
          disabled={!isConditionsComplete(state)}
          onClick={() => {
            dispatch({ type: 'next' })
          }}
        >
          次へ（職歴書）
        </Button>
      </Flex>
    </Card>
  )
}
