import type { EvaluationResult, JudgedCondition } from '../api/types'

export type JudgementStatus = JudgedCondition['status']

/** 年数は小数第 1 位まで（仕様 5.5）。 */
export function formatYears(years: number): string {
  return years.toFixed(1)
}

/** 判定を、「クリア」と「NG」の列に振り分けたもの。並びは、渡された順（一覧の順）。 */
export interface JudgementGroup {
  clear: JudgedCondition[]
  ng: JudgedCondition[]
}

/**
 * 条件別の判定を、「必須」「任意」に分け、それぞれを「クリア」（達成）と「NG」（未達・不明）に
 * 振り分ける（仕様 5.5）。不明は、NG の列に置く（必須の不明は、必須条件の未達として数える）。
 */
export function groupJudgements(conditions: readonly JudgedCondition[]): {
  required: JudgementGroup
  optional: JudgementGroup
} {
  const groups = {
    required: { clear: [], ng: [] } as JudgementGroup,
    optional: { clear: [], ng: [] } as JudgementGroup,
  }
  for (const judged of conditions) {
    const group = judged.condition.required ? groups.required : groups.optional
    if (judged.status === 'achieved') group.clear.push(judged)
    else group.ng.push(judged)
  }
  return groups
}

/** 達成した条件の数と、条件の総数。 */
export function summarizeJudgements(conditions: readonly JudgedCondition[]): {
  achieved: number
  total: number
} {
  return {
    achieved: conditions.filter((judged) => judged.status === 'achieved').length,
    total: conditions.length,
  }
}

/**
 * 条件の名前の下に出す、抽出値の 1 行。boolean の達成・未達は、足す情報がないので null。
 * number は、年数（小数第 1 位）と、必要な最低値。不明は、確認できなかった旨。
 */
export function valueLine(judged: JudgedCondition): string | null {
  if (judged.status === 'unknown') return '書類から確認できませんでした'
  const { kind, unit, min_value } = judged.condition
  if (kind !== 'number') return null
  if (judged.years === null) return '年数の記載なし'
  const actual = `${formatYears(judged.years)}${unit ?? ''}`
  return min_value === null
    ? actual
    : `${actual}（必要: ${formatYears(min_value)}${unit ?? ''}以上）`
}

export type RequiredStatus =
  { kind: 'none' } | { kind: 'clear' } | { kind: 'ng'; count: number; labels: string[] }

/** 必須条件の状況。必須の条件がない場合と、すべてクリアした場合を、区別する（仕様 5.5）。 */
export function requiredStatus(result: EvaluationResult): RequiredStatus {
  if (result.missing_required.length > 0) {
    return {
      kind: 'ng',
      count: result.missing_required.length,
      labels: result.missing_required.map((missing) => missing.label),
    }
  }
  return result.conditions.some((judged) => judged.condition.required)
    ? { kind: 'clear' }
    : { kind: 'none' }
}
