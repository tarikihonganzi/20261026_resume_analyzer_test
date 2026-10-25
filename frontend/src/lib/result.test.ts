import { describe, expect, it } from 'vitest'
import type { Condition, EvaluationResult, JudgedCondition } from '../api/types'
import {
  formatYears,
  groupJudgements,
  requiredStatus,
  summarizeJudgements,
  valueLine,
} from './result'

function condition(overrides: Partial<Condition>): Condition {
  return {
    id: 'c',
    label: '条件',
    kind: 'boolean',
    required: false,
    min_value: null,
    unit: null,
    source: 'preset',
    category: null,
    description: null,
    ...overrides,
  }
}

function judged(c: Partial<Condition>, extra: Partial<JudgedCondition> = {}): JudgedCondition {
  return {
    condition: condition(c),
    status: 'achieved',
    has_skill: null,
    years: null,
    reason: '',
    quotes: [],
    ...extra,
  }
}

const labels = (list: readonly JudgedCondition[]) => list.map((j) => j.condition.label)

describe('groupJudgements（必須／任意 × クリア／NG）', () => {
  const conditions = [
    judged({ label: '任意・達成', required: false }, { status: 'achieved' }),
    judged({ label: '必須・達成', required: true }, { status: 'achieved' }),
    judged({ label: '必須・未達', required: true }, { status: 'unmet' }),
    judged({ label: '任意・不明', required: false }, { status: 'unknown' }),
    judged({ label: '必須・不明', required: true }, { status: 'unknown' }),
    judged({ label: '任意・未達', required: false }, { status: 'unmet' }),
    judged({ label: '必須・達成 2', required: true }, { status: 'achieved' }),
  ]

  it('必須と任意に分け、それぞれを、クリア（達成）と NG（未達・不明）に分ける', () => {
    const groups = groupJudgements(conditions)

    expect(labels(groups.required.clear)).toEqual(['必須・達成', '必須・達成 2'])
    expect(labels(groups.required.ng)).toEqual(['必須・未達', '必須・不明'])
    expect(labels(groups.optional.clear)).toEqual(['任意・達成'])
    expect(labels(groups.optional.ng)).toEqual(['任意・不明', '任意・未達'])
  })

  it('並びは、渡された順（一覧の順）のまま', () => {
    const groups = groupJudgements([...conditions].reverse())

    expect(labels(groups.required.ng)).toEqual(['必須・不明', '必須・未達'])
  })

  it('条件がなくても、空のグループを返す', () => {
    expect(groupJudgements([])).toEqual({
      required: { clear: [], ng: [] },
      optional: { clear: [], ng: [] },
    })
  })
})

describe('summarizeJudgements', () => {
  it('達成した条件の数と、全体の数を返す', () => {
    const result = summarizeJudgements([
      judged({}, { status: 'achieved' }),
      judged({}, { status: 'unmet' }),
      judged({}, { status: 'unknown' }),
      judged({}, { status: 'achieved' }),
    ])

    expect(result).toEqual({ achieved: 2, total: 4 })
  })
})

describe('valueLine（条件の下に出す、抽出値の 1 行）', () => {
  const years = { kind: 'number', unit: '年', min_value: 5 } as const

  it('number は、年数（小数第 1 位）と、必要な最低値', () => {
    expect(valueLine(judged(years, { status: 'unmet', years: 4 }))).toBe('4.0年（必要: 5.0年以上）')
    expect(valueLine(judged(years, { status: 'achieved', years: 8.25 }))).toBe(
      '8.3年（必要: 5.0年以上）',
    )
  })

  it('number で、最低値がなければ、年数だけ', () => {
    expect(valueLine(judged({ kind: 'number', unit: '年' }, { years: 3 }))).toBe('3.0年')
  })

  it('number で、年数が読み取れなかったら、「記載なし」', () => {
    expect(valueLine(judged(years, { status: 'unmet', years: null }))).toBe('年数の記載なし')
  })

  it('不明は、「書類から確認できませんでした」（boolean も number も）', () => {
    expect(valueLine(judged({}, { status: 'unknown' }))).toBe('書類から確認できませんでした')
    expect(valueLine(judged(years, { status: 'unknown' }))).toBe('書類から確認できませんでした')
  })

  it('boolean の達成・未達は、1 行を足さない', () => {
    expect(valueLine(judged({}, { status: 'achieved', has_skill: true }))).toBeNull()
    expect(valueLine(judged({}, { status: 'unmet', has_skill: false }))).toBeNull()
  })
})

describe('formatYears', () => {
  it('小数第 1 位まで', () => {
    expect(formatYears(10)).toBe('10.0')
  })
})

describe('requiredStatus（必須条件の状況）', () => {
  const result = (missing: EvaluationResult['missing_required'], required: boolean[]) =>
    ({
      missing_required: missing,
      conditions: required.map((r) => judged({ required: r })),
    }) as EvaluationResult

  it('必須の条件がなければ、none', () => {
    expect(requiredStatus(result([], [false, false]))).toEqual({ kind: 'none' })
  })

  it('必須がすべてクリアなら、clear', () => {
    expect(requiredStatus(result([], [true, false]))).toEqual({ kind: 'clear' })
  })

  it('未達（不明を含む）があれば、ng と、条件名・件数', () => {
    const missing = [
      { condition_id: 'a', label: '1級建築施工管理技士', status: 'unmet' },
      { condition_id: 'b', label: '現場監督の経験年数', status: 'unknown' },
    ] as const

    expect(requiredStatus(result([...missing], [true, true]))).toEqual({
      kind: 'ng',
      count: 2,
      labels: ['1級建築施工管理技士', '現場監督の経験年数'],
    })
  })
})
