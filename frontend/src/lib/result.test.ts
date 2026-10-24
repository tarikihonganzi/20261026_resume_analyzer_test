import { describe, expect, it } from 'vitest'
import type { Condition, EvaluationResult, JudgedCondition } from '../api/types'
import { formatExtracted, formatRequirement, formatYears, requiredCount } from './result'

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

describe('formatExtracted', () => {
  it('boolean は、あり／なし／（読み取れない）', () => {
    expect(formatExtracted(judged({}, { has_skill: true }))).toBe('あり')
    expect(formatExtracted(judged({}, { has_skill: false }))).toBe('なし')
    expect(formatExtracted(judged({}, { has_skill: null }))).toBe('—')
  })

  it('number は、小数第 1 位までの年数に単位をつける', () => {
    const c = { kind: 'number', unit: '年' } as const
    expect(formatExtracted(judged(c, { years: 5 }))).toBe('5.0年')
    expect(formatExtracted(judged(c, { years: 2.25 }))).toBe('2.3年')
    expect(formatExtracted(judged(c, { years: 0 }))).toBe('0.0年')
    expect(formatExtracted(judged(c, { years: null }))).toBe('—')
  })

  it('単位がなくても、年数だけを返す', () => {
    expect(formatExtracted(judged({ kind: 'number' }, { years: 3 }))).toBe('3.0')
  })
})

describe('formatRequirement', () => {
  it('number の最低値を「以上」で示す。boolean や最低値なしは null', () => {
    expect(formatRequirement(judged({ kind: 'number', unit: '年', min_value: 5 }))).toBe(
      '5.0年以上',
    )
    expect(formatRequirement(judged({ kind: 'number', unit: '年', min_value: null }))).toBeNull()
    expect(formatRequirement(judged({ kind: 'boolean' }))).toBeNull()
  })
})

describe('formatYears', () => {
  it('小数第 1 位まで', () => {
    expect(formatYears(10)).toBe('10.0')
  })
})

describe('requiredCount', () => {
  it('必須の条件の数を数える', () => {
    const result = {
      conditions: [
        judged({ required: true }),
        judged({ required: false }),
        judged({ required: true }),
      ],
    } as EvaluationResult
    expect(requiredCount(result)).toBe(2)
  })
})
