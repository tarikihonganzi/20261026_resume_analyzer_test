import type { Condition, EvaluationResult, JudgedCondition } from '../api/types'

export function makeCondition(overrides: Partial<Condition> = {}): Condition {
  return {
    id: 'q1',
    label: '1級建築施工管理技士',
    kind: 'boolean',
    required: false,
    min_value: null,
    unit: null,
    source: 'preset',
    category: '資格・認定',
    description: null,
    ...overrides,
  }
}

export function makeJudged(overrides: Partial<JudgedCondition> = {}): JudgedCondition {
  return {
    condition: makeCondition(),
    status: 'achieved',
    has_skill: true,
    years: null,
    reason: '職歴書.docx に資格の記載があります。',
    quotes: [
      {
        source_name: '職歴書.docx',
        location: '資格欄',
        text: '1級建築施工管理技士 取得',
        verified: 'match',
      },
    ],
    ...overrides,
  }
}

/** 結果画面・ストリームのテストに使う、全項目がそろった評価結果。 */
export function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    score: 72,
    applicant_name: '架空 太郎',
    original_score: 72,
    clipped: false,
    match_rate: 70,
    missing_required: [],
    conditions: [makeJudged()],
    summary: {
      text: '**総合**して、要件を概ね満たしています。',
      reason: '主要な資格があります。',
      quotes: [],
    },
    strengths: [{ text: '大規模現場の経験', reason: '職歴書.docx に記載があります。', quotes: [] }],
    weaknesses: [{ text: 'BIM の経験が少ない', reason: '', quotes: [] }],
    ...overrides,
  }
}
