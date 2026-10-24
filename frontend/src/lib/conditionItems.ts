import type { CatalogItem, Condition, ConditionKind } from '../api/types'
import type { Selection } from '../state/flow'

export const CUSTOM_CATEGORY = '自由記述'

/** 一覧に出す条件 1 件。プリセット（カタログ）と、自由記述を、同じ形にそろえる。 */
export interface ConditionItem {
  id: string
  label: string
  kind: ConditionKind
  unit: string | null
  category: string
  source: 'preset' | 'custom'
  /** 何をその条件として数えるか（補足説明。仕様 5.1）。なければ null。 */
  description: string | null
}

export function toItems(
  catalog: readonly CatalogItem[],
  customs: readonly Condition[],
): ConditionItem[] {
  return [
    ...catalog.map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      unit: item.unit,
      category: item.category,
      source: 'preset' as const,
      description: item.description ?? null,
    })),
    ...customs.map((condition) => ({
      id: condition.id,
      label: condition.label,
      kind: condition.kind,
      unit: condition.unit,
      category: CUSTOM_CATEGORY,
      source: 'custom' as const,
      description: condition.description ?? null,
    })),
  ]
}

/** カテゴリを、カタログに出てきた順に返し、最後に「自由記述」を加える。 */
export function categoriesOf(catalog: readonly CatalogItem[]): string[] {
  const categories: string[] = []
  for (const item of catalog) {
    if (!categories.includes(item.category)) categories.push(item.category)
  }
  return [...categories, CUSTOM_CATEGORY]
}

export interface Filters {
  query: string
  category: string | null
  selectedOnly: boolean
}

/** 全角・半角、大文字・小文字、空白の違いを無視するための正規化。 */
function normalizeForSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

export function filterItems(
  items: readonly ConditionItem[],
  filters: Filters,
  selections: Readonly<Record<string, Selection>>,
): ConditionItem[] {
  const query = normalizeForSearch(filters.query)
  return items.filter((item) => {
    if (filters.category !== null && item.category !== filters.category) return false
    if (filters.selectedOnly && (selections[item.id]?.mode ?? 'off') === 'off') return false
    return query === '' || normalizeForSearch(item.label).includes(query)
  })
}

export interface ConditionGroup {
  category: string
  items: ConditionItem[]
}

export function groupByCategory(items: readonly ConditionItem[]): ConditionGroup[] {
  const groups: ConditionGroup[] = []
  for (const item of items) {
    const group = groups.find((g) => g.category === item.category)
    if (group) group.items.push(item)
    else groups.push({ category: item.category, items: [item] })
  }
  return groups
}

export interface SummaryEntry {
  id: string
  /** 画面に出す文。number の条件は、最低値を添える（例: 「Revit 2.5年以上」）。 */
  text: string
}

export interface SelectionSummaryData {
  required: SummaryEntry[]
  optional: SummaryEntry[]
}

function describe(item: ConditionItem, selection: Selection): string {
  if (item.kind !== 'number' || selection.minValue === null) return item.label
  return `${item.label} ${selection.minValue.toFixed(1)}${item.unit ?? '年'}以上`
}

/** 選ばれた条件を、「必須」と「任意」に分ける。並びは、一覧の順。 */
export function summarize(
  items: readonly ConditionItem[],
  selections: Readonly<Record<string, Selection>>,
): SelectionSummaryData {
  const summary: SelectionSummaryData = { required: [], optional: [] }
  for (const item of items) {
    const selection = selections[item.id]
    if (!selection || selection.mode === 'off') continue
    const entry = { id: item.id, text: describe(item, selection) }
    if (selection.mode === 'required') summary.required.push(entry)
    else summary.optional.push(entry)
  }
  return summary
}
