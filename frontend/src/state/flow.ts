/**
 * 評価フロー（① 条件 → ② 職歴書 → ③ 結果）の状態と、遷移の規則（仕様 6.2）。
 *
 * 規則はすべて、このリデューサーに集約する。画面（コンポーネント）は、状態を表示して、
 * アクションを送るだけにする。状態はブラウザのメモリだけに持つ（再読み込みで消える）。
 */
import type {
  CatalogItem,
  Condition,
  ConditionKind,
  EvaluationResult,
  ResumeCheck,
  Stage,
} from '../api/types'

export type Step = 0 | 1 | 2
export type Mode = 'off' | 'optional' | 'required'
export type StepStatus = 'wait' | 'process' | 'finish' | 'error'

export interface FlowError {
  code: string
  message: string
}

/** 条件ごとの選択。`minValue` は、number の条件の最低値（未入力は null）。 */
export interface Selection {
  kind: ConditionKind
  mode: Mode
  minValue: number | null
}

export type ResumeSource = { kind: 'file'; file: File } | { kind: 'text'; text: string }

export type ResumeCheckState =
  | { status: 'checking' }
  | { status: 'ok'; result: ResumeCheck }
  | { status: 'error'; error: FlowError }

export interface ResumeState {
  source: ResumeSource
  name: string
  check: ResumeCheckState
}

export type EvaluationState =
  | { status: 'idle' }
  | { status: 'running'; stage: Stage }
  | { status: 'done'; result: EvaluationResult }
  | { status: 'error'; error: FlowError }

export interface FlowState {
  step: Step
  /** クリックして移動できる、いちばん先のステップ。これより先には飛べない。 */
  furthest: Step
  selections: Record<string, Selection>
  customConditions: Condition[]
  resume: ResumeState | null
  evaluation: EvaluationState
}

export const initialState: FlowState = {
  step: 0,
  furthest: 0,
  selections: {},
  customConditions: [],
  resume: null,
  evaluation: { status: 'idle' },
}

export type Action =
  | { type: 'setMode'; id: string; kind: ConditionKind; mode: Mode }
  | { type: 'setMinValue'; id: string; minValue: number | null }
  | { type: 'addCustom'; condition: Condition }
  | { type: 'updateCustom'; condition: Condition }
  | { type: 'removeCustom'; id: string }
  | { type: 'loadConditions'; conditions: Condition[] }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goTo'; step: Step }
  | { type: 'resumeSelected'; source: ResumeSource; name: string }
  | { type: 'resumeChecked'; check: ResumeCheck; forName?: string }
  | { type: 'resumeCheckFailed'; error: FlowError; forName?: string }
  | { type: 'clearResume' }
  | { type: 'startEvaluation' }
  | { type: 'stageChanged'; stage: Stage }
  | { type: 'evaluationSucceeded'; result: EvaluationResult }
  | { type: 'evaluationFailed'; error: FlowError }
  | { type: 'cancelEvaluation' }
  | { type: 'reevaluate' }
  | { type: 'newApplicant' }

// --- 導出する値（セレクター） ---

function selectedEntries(state: FlowState): [string, Selection][] {
  return Object.entries(state.selections).filter(([, selection]) => selection.mode !== 'off')
}

export function conditionCounts(state: FlowState): { required: number; optional: number } {
  const selected = selectedEntries(state)
  return {
    required: selected.filter(([, s]) => s.mode === 'required').length,
    optional: selected.filter(([, s]) => s.mode === 'optional').length,
  }
}

function isValidMinValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

/** ① を完了できる: 1 件以上が選ばれ、number の最低値がすべて入力済み（仕様 6.2）。 */
export function isConditionsComplete(state: FlowState): boolean {
  const selected = selectedEntries(state)
  return (
    selected.length > 0 &&
    selected.every(([, s]) => s.kind === 'boolean' || isValidMinValue(s.minValue))
  )
}

/** ② で「評価する」を押せる: 職歴書の検証に成功していて、条件がそろっている。 */
export function canEvaluate(state: FlowState): boolean {
  return (
    state.resume?.check.status === 'ok' &&
    isConditionsComplete(state) &&
    state.evaluation.status !== 'running'
  )
}

/** 評価に送る条件。プリセット（カタログの順）→ 自由記述の順。 */
export function buildConditions(catalog: readonly CatalogItem[], state: FlowState): Condition[] {
  const conditions: Condition[] = []
  for (const item of catalog) {
    const selection = state.selections[item.id]
    if (!selection || selection.mode === 'off') continue
    conditions.push({
      id: item.id,
      label: item.label,
      kind: item.kind,
      required: selection.mode === 'required',
      min_value: item.kind === 'number' ? selection.minValue : null,
      unit: item.unit,
      source: 'preset',
      category: item.category,
    })
  }
  for (const custom of state.customConditions) {
    const selection = state.selections[custom.id]
    if (!selection || selection.mode === 'off') continue
    conditions.push({
      ...custom,
      required: selection.mode === 'required',
      min_value: custom.kind === 'number' ? selection.minValue : null,
    })
  }
  return conditions
}

export function stepStatuses(state: FlowState): [StepStatus, StepStatus, StepStatus] {
  const conditions: StepStatus = state.step === 0 ? 'process' : 'finish'

  let resume: StepStatus = 'wait'
  if (state.resume?.check.status === 'error') resume = 'error'
  else if (state.step === 1) resume = 'process'
  else if (state.resume?.check.status === 'ok') resume = 'finish'

  let result: StepStatus = 'wait'
  switch (state.evaluation.status) {
    case 'running':
      result = 'process'
      break
    case 'done':
      result = 'finish'
      break
    case 'error':
      result = 'error'
      break
    case 'idle':
      break
  }
  return [conditions, resume, result]
}

// --- 遷移 ---

/** 条件が変わったあと: 古くなった結果を捨て、到達できるステップを見直す。 */
function afterConditionsChanged(state: FlowState): FlowState {
  // ③ は、条件が変わると古くなる。② へ進めるのは、条件がそろっていて、到達済みのときだけ
  const furthest: Step = isConditionsComplete(state) && state.furthest >= 1 ? 1 : 0
  return {
    ...state,
    furthest,
    evaluation: state.evaluation.status === 'running' ? state.evaluation : { status: 'idle' },
  }
}

function withSelection(state: FlowState, id: string, selection: Selection): FlowState {
  return afterConditionsChanged({
    ...state,
    selections: { ...state.selections, [id]: selection },
  })
}

function selectionFromCondition(condition: Condition): Selection {
  return {
    kind: condition.kind,
    mode: condition.required ? 'required' : 'optional',
    minValue: condition.kind === 'number' ? condition.min_value : null,
  }
}

export function reducer(state: FlowState, action: Action): FlowState {
  switch (action.type) {
    case 'setMode': {
      const current = state.selections[action.id]
      return withSelection(state, action.id, {
        kind: action.kind,
        mode: action.mode,
        minValue: current?.minValue ?? null,
      })
    }

    case 'setMinValue': {
      const current = state.selections[action.id]
      if (!current) return state
      return withSelection(state, action.id, { ...current, minValue: action.minValue })
    }

    case 'addCustom':
      return afterConditionsChanged({
        ...state,
        customConditions: [...state.customConditions, action.condition],
        selections: {
          ...state.selections,
          [action.condition.id]: {
            kind: action.condition.kind,
            mode: 'optional',
            minValue: action.condition.kind === 'number' ? action.condition.min_value : null,
          },
        },
      })

    case 'updateCustom': {
      const current = state.selections[action.condition.id]
      return afterConditionsChanged({
        ...state,
        customConditions: state.customConditions.map((c) =>
          c.id === action.condition.id ? action.condition : c,
        ),
        selections: {
          ...state.selections,
          [action.condition.id]: {
            kind: action.condition.kind,
            mode: current?.mode ?? 'optional',
            minValue: action.condition.kind === 'number' ? action.condition.min_value : null,
          },
        },
      })
    }

    case 'removeCustom': {
      const selections = Object.fromEntries(
        Object.entries(state.selections).filter(([id]) => id !== action.id),
      )
      return afterConditionsChanged({
        ...state,
        customConditions: state.customConditions.filter((c) => c.id !== action.id),
        selections,
      })
    }

    case 'loadConditions':
      return afterConditionsChanged({
        ...state,
        customConditions: action.conditions.filter((c) => c.source === 'custom'),
        selections: Object.fromEntries(
          action.conditions.map((c) => [c.id, selectionFromCondition(c)]),
        ),
      })

    case 'next':
      if (state.step === 0 && isConditionsComplete(state)) {
        return { ...state, step: 1, furthest: Math.max(state.furthest, 1) as Step }
      }
      return state

    case 'back':
      if (state.evaluation.status === 'running' || state.step === 0) return state
      return reducer(state, { type: 'goTo', step: (state.step - 1) as Step })

    case 'goTo': {
      if (state.evaluation.status === 'running') return state
      if (action.step === state.step || action.step > state.furthest) return state
      // 失敗した ③ から戻ると、③ は無かったことになる（結果がないので、先には進めない）
      if (state.evaluation.status === 'error') {
        return {
          ...state,
          step: action.step,
          furthest: Math.min(state.furthest, 1) as Step,
          evaluation: { status: 'idle' },
        }
      }
      return { ...state, step: action.step }
    }

    case 'resumeSelected':
      return {
        ...state,
        resume: { source: action.source, name: action.name, check: { status: 'checking' } },
      }

    case 'resumeChecked':
      // 選び直したあとに、前の職歴書の検証結果が届いても、無視する
      if (!state.resume || (action.forName !== undefined && action.forName !== state.resume.name)) {
        return state
      }
      return {
        ...state,
        resume: { ...state.resume, check: { status: 'ok', result: action.check } },
      }

    case 'resumeCheckFailed':
      if (!state.resume || (action.forName !== undefined && action.forName !== state.resume.name)) {
        return state
      }
      return {
        ...state,
        resume: { ...state.resume, check: { status: 'error', error: action.error } },
      }

    case 'clearResume':
      return { ...state, resume: null }

    case 'startEvaluation': {
      const canStart =
        state.evaluation.status !== 'running' &&
        (state.step === 1 || state.evaluation.status === 'error') &&
        state.resume?.check.status === 'ok' &&
        isConditionsComplete(state)
      if (!canStart) return state
      return {
        ...state,
        step: 2,
        furthest: 2,
        evaluation: { status: 'running', stage: 'extracting' },
      }
    }

    case 'stageChanged':
      if (state.evaluation.status !== 'running') return state
      return { ...state, evaluation: { status: 'running', stage: action.stage } }

    case 'evaluationSucceeded':
      if (state.evaluation.status !== 'running') return state
      return { ...state, evaluation: { status: 'done', result: action.result } }

    case 'evaluationFailed':
      if (state.evaluation.status !== 'running') return state
      return { ...state, evaluation: { status: 'error', error: action.error } }

    case 'cancelEvaluation':
      if (state.evaluation.status !== 'running') return state
      return { ...state, step: 1, furthest: 1, evaluation: { status: 'idle' } }

    // 「条件を変えて再評価」: ① に戻る。職歴書は残る（再評価のときに、もう一度送る）
    case 'reevaluate':
      return afterConditionsChanged({ ...state, step: 0, evaluation: { status: 'idle' } })

    // 「別の応募者を評価」: 職歴書だけを捨てて、条件を残して ② に戻る
    case 'newApplicant':
      return { ...state, step: 1, furthest: 1, resume: null, evaluation: { status: 'idle' } }
  }
}
