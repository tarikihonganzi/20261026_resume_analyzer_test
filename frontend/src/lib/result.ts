import type { EvaluationResult, JudgedCondition } from '../api/types'

export type JudgementStatus = JudgedCondition['status']

export const STATUS_LABELS: Record<JudgementStatus, string> = {
  achieved: '達成',
  unmet: '未達',
  unknown: '不明',
}

/** 年数は小数第 1 位まで（仕様 5.5）。 */
export function formatYears(years: number): string {
  return years.toFixed(1)
}

/**
 * 判定表の「抽出値」。boolean は「あり／なし」、number は年数（単位つき）。
 * 職歴書から読み取れなかった値（null）は、「—」にする。
 */
export function formatExtracted(judged: JudgedCondition): string {
  if (judged.condition.kind === 'number') {
    if (judged.years === null) return '—'
    return `${formatYears(judged.years)}${judged.condition.unit ?? ''}`
  }
  if (judged.has_skill === null) return '—'
  return judged.has_skill ? 'あり' : 'なし'
}

/** number の条件の、必要な最低値（例: 「5.0 年以上」）。boolean や未設定のときは null。 */
export function formatRequirement(judged: JudgedCondition): string | null {
  const { kind, min_value, unit } = judged.condition
  if (kind !== 'number' || min_value === null) return null
  return `${formatYears(min_value)}${unit ?? ''}以上`
}

/** 評価した条件のうち、必須のものの数（「必須条件はすべて達成」と「必須の条件がない」を区別する）。 */
export function requiredCount(result: EvaluationResult): number {
  return result.conditions.filter((judged) => judged.condition.required).length
}
