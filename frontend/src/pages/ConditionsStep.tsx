import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Flex, Popconfirm, Row, Spin } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCatalog } from '../api/hooks'
import type { Condition } from '../api/types'
import { ConditionFilters } from '../components/ConditionFilters'
import { ConditionList } from '../components/ConditionList'
import { ConditionSetBar } from '../components/ConditionSetBar'
import { CustomConditionModal } from '../components/CustomConditionModal'
import { SelectionSummary } from '../components/SelectionSummary'
import {
  CUSTOM_CATEGORY,
  categoriesOf,
  filterItems,
  summarize,
  toItems,
  type Filters,
} from '../lib/conditionItems'
import { buildConditions, isConditionsComplete } from '../state/flow'
import { useFlow } from '../state/flow-context'

const NO_FILTER: Filters = { query: '', category: null, selectedOnly: false }

type CustomDialog = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; condition: Condition }

/** ① 条件。3 状態トグルの一覧表で、使う条件を選ぶ（仕様 5.1）。右に、選んだ条件の要約を出す。 */
export function ConditionsStep() {
  const { state, dispatch } = useFlow()
  const catalog = useCatalog()
  const [filters, setFilters] = useState<Filters>(NO_FILTER)
  const [dialog, setDialog] = useState<CustomDialog>({ mode: 'closed' })
  // 絞り込みで隠れていた行へ移動するとき、行が現れるのを待つための id
  const pendingJump = useRef<string | null>(null)

  const items = useMemo(
    () => toItems(catalog.data ?? [], state.customConditions),
    [catalog.data, state.customConditions],
  )
  const visible = useMemo(
    () => filterItems(items, filters, state.selections),
    [items, filters, state.selections],
  )
  const summary = useMemo(() => summarize(items, state.selections), [items, state.selections])

  const scrollToRow = (id: string): boolean => {
    const row = document.getElementById(`condition-${id}`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return row !== null
  }

  // 要約の項目をクリックしたとき: 絞り込みで隠れていたら外し、行が現れたら移動する
  useEffect(() => {
    if (pendingJump.current !== null && scrollToRow(pendingJump.current)) {
      pendingJump.current = null
    }
  }, [visible])

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

  const customCondition = (id: string) => state.customConditions.find((c) => c.id === id)

  return (
    <>
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={17}>
          <Card>
            <ConditionSetBar
              conditions={buildConditions(catalog.data, state)}
              canSave={isConditionsComplete(state)}
              onLoad={(conditions) => {
                dispatch({ type: 'loadConditions', conditions })
              }}
            />
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
              rowActions={(item) => {
                const condition = item.source === 'custom' ? customCondition(item.id) : undefined
                if (!condition) return null
                return (
                  <Flex gap={4}>
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      aria-label={`${item.label}を編集`}
                      onClick={() => {
                        setDialog({ mode: 'edit', condition })
                      }}
                    />
                    <Popconfirm
                      title="この条件を削除しますか？"
                      okText="削除"
                      cancelText="キャンセル"
                      onConfirm={() => {
                        dispatch({ type: 'removeCustom', id: item.id })
                      }}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={`${item.label}を削除`}
                      />
                    </Popconfirm>
                  </Flex>
                )
              }}
              groupFooter={(category) =>
                category === CUSTOM_CATEGORY ? (
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setDialog({ mode: 'add' })
                    }}
                  >
                    自由記述で条件を追加
                  </Button>
                ) : null
              }
              alwaysShow={
                filters.category === null || filters.category === CUSTOM_CATEGORY
                  ? [CUSTOM_CATEGORY]
                  : []
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
        </Col>
        <Col xs={24} lg={7}>
          <div style={{ position: 'sticky', top: 16 }}>
            <SelectionSummary
              summary={summary}
              onJump={(id) => {
                if (scrollToRow(id)) return
                pendingJump.current = id
                setFilters(NO_FILTER)
              }}
              onAddCustom={() => {
                setDialog({ mode: 'add' })
              }}
            />
          </div>
        </Col>
      </Row>
      <CustomConditionModal
        open={dialog.mode !== 'closed'}
        initial={dialog.mode === 'edit' ? dialog.condition : undefined}
        onCancel={() => {
          setDialog({ mode: 'closed' })
        }}
        onSubmit={(condition) => {
          dispatch({ type: dialog.mode === 'edit' ? 'updateCustom' : 'addCustom', condition })
          setDialog({ mode: 'closed' })
        }}
      />
    </>
  )
}
