import { describe, expect, it } from 'vitest'
import type { CatalogItem, Condition } from '../api/types'
import type { Selection } from '../state/flow'
import {
  CUSTOM_CATEGORY,
  categoriesOf,
  filterItems,
  groupByCategory,
  partitionLoadable,
  summarize,
  toItems,
  type ConditionItem,
} from './conditionItems'

const catalog: CatalogItem[] = [
  { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'q2', label: '2級建築士', kind: 'boolean', unit: null, category: '資格' },
  {
    id: 's1',
    label: 'Revit（BIM）の実務経験',
    kind: 'number',
    unit: '年',
    category: 'スキル・ツール',
  },
  { id: 'e1', label: '現場監督の経験年数', kind: 'number', unit: '年', category: '経験・実績' },
]

const custom: Condition = {
  id: 'c1',
  label: '耐震診断の経験',
  kind: 'boolean',
  required: false,
  min_value: null,
  unit: null,
  source: 'custom',
  category: null,
  description: null,
}

const items = toItems(catalog, [custom])
const none: Record<string, Selection> = {}
const selected = (id: string): Record<string, Selection> => ({
  [id]: { kind: 'boolean', mode: 'optional', minValue: null },
})

const ids = (list: ConditionItem[]) => list.map((i) => i.id)

describe('toItems', () => {
  it('プリセットのあとに、自由記述を並べる。自由記述のカテゴリは「自由記述」', () => {
    expect(ids(items)).toEqual(['q1', 'q2', 's1', 'e1', 'c1'])
    expect(items[4]).toMatchObject({ source: 'custom', category: CUSTOM_CATEGORY })
    expect(items[0]).toMatchObject({ source: 'preset', category: '資格' })
  })
})

describe('categoriesOf', () => {
  it('カテゴリを、出てきた順に返し、最後に「自由記述」を加える', () => {
    expect(categoriesOf(catalog)).toEqual(['資格', 'スキル・ツール', '経験・実績', CUSTOM_CATEGORY])
  })
})

describe('filterItems', () => {
  const all = { query: '', category: null, selectedOnly: false } as const

  it('条件がなければ、すべて', () => {
    expect(ids(filterItems(items, all, none))).toEqual(['q1', 'q2', 's1', 'e1', 'c1'])
  })

  it('検索は、ラベルの部分一致', () => {
    expect(ids(filterItems(items, { ...all, query: '建築' }, none))).toEqual(['q1', 'q2'])
  })

  it('検索は、全角・半角と大文字・小文字を区別しない', () => {
    expect(ids(filterItems(items, { ...all, query: 'ｒｅｖｉｔ' }, none))).toEqual(['s1'])
    expect(ids(filterItems(items, { ...all, query: '１級' }, none))).toEqual(['q1'])
  })

  it('検索は、前後と間の空白を無視する', () => {
    expect(ids(filterItems(items, { ...all, query: '  現場 監督  ' }, none))).toEqual(['e1'])
  })

  it('カテゴリで絞り込める', () => {
    expect(ids(filterItems(items, { ...all, category: '資格' }, none))).toEqual(['q1', 'q2'])
    expect(ids(filterItems(items, { ...all, category: CUSTOM_CATEGORY }, none))).toEqual(['c1'])
  })

  it('「選択中のみ」は、「使わない」以外のものだけ', () => {
    const state = {
      ...selected('q2'),
      s1: { kind: 'number', mode: 'off', minValue: null },
    } as const

    expect(ids(filterItems(items, { ...all, selectedOnly: true }, state))).toEqual(['q2'])
  })

  it('検索・カテゴリ・選択中のみは、すべて満たすものだけ（AND）', () => {
    const state = { ...selected('q1'), ...selected('q2') }

    expect(
      ids(filterItems(items, { query: '士', category: '資格', selectedOnly: true }, state)),
    ).toEqual(['q1', 'q2'])
    expect(
      ids(filterItems(items, { query: '1級', category: '資格', selectedOnly: true }, state)),
    ).toEqual(['q1'])
    expect(
      ids(filterItems(items, { query: 'Revit', category: '資格', selectedOnly: false }, none)),
    ).toEqual([])
  })
})

describe('groupByCategory', () => {
  it('カテゴリごとに、並び順を保ってまとめる。空のカテゴリは出さない', () => {
    const groups = groupByCategory(
      filterItems(items, { query: '', category: null, selectedOnly: false }, none),
    )

    expect(groups.map((g) => g.category)).toEqual([
      '資格',
      'スキル・ツール',
      '経験・実績',
      CUSTOM_CATEGORY,
    ])
    expect(ids(groups[0]?.items ?? [])).toEqual(['q1', 'q2'])
    expect(groupByCategory([])).toEqual([])
  })
})

describe('summarize', () => {
  const selections: Record<string, Selection> = {
    q2: { kind: 'boolean', mode: 'required', minValue: null },
    s1: { kind: 'number', mode: 'optional', minValue: 2.5 },
    e1: { kind: 'number', mode: 'required', minValue: 5 },
    q1: { kind: 'boolean', mode: 'off', minValue: null },
    c1: { kind: 'boolean', mode: 'optional', minValue: null },
  }

  it('必須と任意に分け、一覧の順に並べる。「使わない」は出さない', () => {
    const summary = summarize(items, selections)

    expect(summary.required.map((e) => e.id)).toEqual(['q2', 'e1'])
    expect(summary.optional.map((e) => e.id)).toEqual(['s1', 'c1'])
  })

  it('number の条件には、最低値を小数第 1 位で添える', () => {
    const summary = summarize(items, selections)

    expect(summary.optional[0]?.text).toBe('Revit（BIM）の実務経験 2.5年以上')
    expect(summary.required[1]?.text).toBe('現場監督の経験年数 5.0年以上')
    expect(summary.required[0]?.text).toBe('2級建築士')
  })

  it('最低値が未入力の number の条件は、名前だけを出す', () => {
    const summary = summarize(items, { s1: { kind: 'number', mode: 'required', minValue: null } })

    expect(summary.required[0]?.text).toBe('Revit（BIM）の実務経験')
  })

  it('何も選ばれていなければ、どちらも空', () => {
    expect(summarize(items, {})).toEqual({ required: [], optional: [] })
  })
})

describe('補足説明（toItems）', () => {
  it('プリセットと自由記述の補足説明を、そのまま持つ。ないものは null', () => {
    const [first, second] = catalog
    if (!first || !second) throw new Error('テストデータが足りません')
    const described = toItems(
      [{ ...first, description: '国家資格の記載' }, second],
      [{ ...custom, description: '診断報告書の作成までを数える' }],
    )

    expect(described.map((i) => i.description)).toEqual([
      '国家資格の記載',
      null,
      '診断報告書の作成までを数える',
    ])
  })
})

describe('partitionLoadable（保存した条件セットの読み込み）', () => {
  const catalog = [
    { id: 'q1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
    { id: 's1', label: 'Revit', kind: 'number', unit: '年', category: 'スキル' },
  ] as const

  const condition = (id: string, source: 'preset' | 'custom'): Condition => ({
    id,
    label: id,
    kind: 'boolean',
    required: false,
    min_value: null,
    unit: null,
    source,
    category: null,
    description: null,
  })

  it('いまの一覧にあるプリセットと、自由記述は、読み込める', () => {
    const conditions = [condition('q1', 'preset'), condition('c1', 'custom')]

    const result = partitionLoadable(conditions, catalog)

    expect(result.loadable).toEqual(conditions)
    expect(result.skipped).toEqual([])
  })

  it('いまの一覧にないプリセットは、読み込めない条件として、分ける', () => {
    const gone = condition('removed-preset', 'preset')

    const result = partitionLoadable([condition('q1', 'preset'), gone], catalog)

    expect(result.loadable.map((c) => c.id)).toEqual(['q1'])
    expect(result.skipped).toEqual([gone])
  })

  it('自由記述は、一覧になくても、読み込める（自分で作った条件なので）', () => {
    const result = partitionLoadable([condition('custom-not-in-catalog', 'custom')], catalog)

    expect(result.skipped).toEqual([])
  })
})
