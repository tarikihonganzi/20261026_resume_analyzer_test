/**
 * 評価フロー（① 条件 → ② 書類 → ③ 結果）の状態と、遷移の規則（仕様 6.2）。
 *
 * 規則はすべて、このリデューサーに集約する。画面（コンポーネント）は、状態を表示して、
 * アクションを送るだけにする。状態はブラウザのメモリだけに持つ（再読み込みで消える）。
 */
import type { ResumeSource } from '../api/sse'
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

export type { ResumeSource }

export type ResumeCheckState =
  | { status: 'checking' }
  | { status: 'ok'; result: ResumeCheck }
  | { status: 'error'; error: FlowError }

/** 1 回の評価に渡せる書類の数（仕様 5.3）。 */
export const MAX_RESUMES = 5

/** アップロード済みの書類 1 件（ファイル、または貼り付けテキスト）。 */
export interface ResumeItem {
  /**
   * 追加するたびに、リデューサーが付ける、一意な ID。検証の結果は、この ID が一致するときだけ
   * 採用する（名前では、同名のファイルの選び直しや、貼り付けテキスト同士を区別できない）。
   */
  id: number
  source: ResumeSource
  name: string
  check: ResumeCheckState
}

export type EvaluationState =
  | { status: 'idle' }
  /** `runId`: 開始するたびに付ける、一意な評価の ID。通知は、この ID が一致するときだけ採用する。 */
  | { status: 'running'; stage: Stage; runId: number }
  | { status: 'done'; result: EvaluationResult }
  | { status: 'error'; error: FlowError }

export interface FlowState {
  step: Step
  /** クリックして移動できる、いちばん先のステップ。これより先には飛べない。 */
  furthest: Step
  selections: Record<string, Selection>
  customConditions: Condition[]
  /** アップロード済みの書類（1 人の応募者の分。最大 5 件）。 */
  resumes: ResumeItem[]
  evaluation: EvaluationState
  /** ID の採番用。増えるだけで、戻らない（古い通知の ID と、新しい要求の ID が重ならないように）。 */
  counters: { check: number; run: number }
}

export const initialState: FlowState = {
  step: 0,
  furthest: 0,
  selections: {},
  customConditions: [],
  resumes: [],
  evaluation: { status: 'idle' },
  counters: { check: 0, run: 0 },
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
  | { type: 'resumeAdded'; source: ResumeSource; name: string }
  | { type: 'resumeRemoved'; id: number }
  | { type: 'resumeChecked'; check: ResumeCheck; id: number }
  | { type: 'resumeCheckFailed'; error: FlowError; id: number }
  | { type: 'startEvaluation' }
  | { type: 'stageChanged'; stage: Stage; runId: number }
  | { type: 'evaluationSucceeded'; result: EvaluationResult; runId: number }
  | { type: 'evaluationFailed'; error: FlowError; runId: number }
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

/** 書類全体の状態。1 件でも確認中なら checking、使えないものがあれば error、すべて使えれば ok。 */
export function resumesStatus(state: FlowState): 'empty' | 'checking' | 'error' | 'ok' {
  if (state.resumes.length === 0) return 'empty'
  if (state.resumes.some((item) => item.check.status === 'error')) return 'error'
  if (state.resumes.some((item) => item.check.status === 'checking')) return 'checking'
  return 'ok'
}

/** ② で「評価する」を押せる: 職歴書の検証に成功していて、条件がそろっている。 */
export function canEvaluate(state: FlowState): boolean {
  return (
    resumesStatus(state) === 'ok' &&
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
      description: item.description ?? null,
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

  const resumes = resumesStatus(state)
  let resume: StepStatus = 'wait'
  if (resumes === 'error') resume = 'error'
  else if (state.step === 1) resume = 'process'
  else if (resumes === 'ok') resume = 'finish'

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

/** 検証の結果が、いま一覧にある書類のもので、まだ検証中か。 */
function isCurrentCheck(state: FlowState, id: number): boolean {
  return state.resumes.some((item) => item.id === id && item.check.status === 'checking')
}

function withCheck(state: FlowState, id: number, check: ResumeCheckState): FlowState {
  return {
    ...state,
    resumes: state.resumes.map((item) => (item.id === id ? { ...item, check } : item)),
  }
}

/** 評価の通知が、いま実行中の評価のものか（キャンセルした評価や、前の評価の通知を無視する）。 */
function isCurrentRun(state: FlowState, runId: number): boolean {
  return state.evaluation.status === 'running' && state.evaluation.runId === runId
}

/**
 * 職歴書を差し替える・取り除くとき: 前の職歴書の評価結果を捨て、③ へ進めなくする。
 * ③ にいる場合は ② に戻す（別の応募者の結果が、表示され続けないように）。
 */
function discardEvaluation(state: FlowState): FlowState {
  return {
    ...state,
    step: state.step === 2 ? 1 : state.step,
    furthest: Math.min(state.furthest, 1) as Step,
    evaluation: { status: 'idle' },
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

    case 'resumeAdded': {
      if (state.evaluation.status === 'running') return state
      // 貼り付けテキストは 1 件だけ。入力し直すと、前のテキストを置き換える
      const kept =
        action.source.kind === 'text'
          ? state.resumes.filter((item) => item.source.kind !== 'text')
          : state.resumes
      if (kept.length >= MAX_RESUMES) return state
      const id = state.counters.check + 1
      return {
        ...discardEvaluation(state),
        resumes: [
          ...kept,
          { id, source: action.source, name: action.name, check: { status: 'checking' } },
        ],
        counters: { ...state.counters, check: id },
      }
    }

    case 'resumeRemoved': {
      if (state.evaluation.status === 'running') return state
      return {
        ...discardEvaluation(state),
        resumes: state.resumes.filter((item) => item.id !== action.id),
      }
    }

    case 'resumeChecked':
      if (!isCurrentCheck(state, action.id)) return state
      return withCheck(state, action.id, { status: 'ok', result: action.check })

    case 'resumeCheckFailed':
      if (!isCurrentCheck(state, action.id)) return state
      return withCheck(state, action.id, { status: 'error', error: action.error })

    case 'startEvaluation': {
      const canStart =
        state.evaluation.status !== 'running' &&
        (state.step === 1 || state.evaluation.status === 'error') &&
        resumesStatus(state) === 'ok' &&
        isConditionsComplete(state)
      if (!canStart) return state
      const runId = state.counters.run + 1
      return {
        ...state,
        step: 2,
        furthest: 2,
        evaluation: { status: 'running', stage: 'extracting', runId },
        counters: { ...state.counters, run: runId },
      }
    }

    case 'stageChanged':
      if (!isCurrentRun(state, action.runId)) return state
      return {
        ...state,
        evaluation: { status: 'running', stage: action.stage, runId: action.runId },
      }

    case 'evaluationSucceeded':
      if (!isCurrentRun(state, action.runId)) return state
      return { ...state, evaluation: { status: 'done', result: action.result } }

    case 'evaluationFailed':
      if (!isCurrentRun(state, action.runId)) return state
      return { ...state, evaluation: { status: 'error', error: action.error } }

    case 'cancelEvaluation':
      if (state.evaluation.status !== 'running') return state
      return { ...state, step: 1, furthest: 1, evaluation: { status: 'idle' } }

    // 「条件を変えて再評価」: ① に戻る。職歴書は残る（再評価のときに、もう一度送る）
    case 'reevaluate':
      return afterConditionsChanged({ ...state, step: 0, evaluation: { status: 'idle' } })

    // 「別の応募者を評価」: 職歴書だけを捨てて、条件を残して ② に戻る
    case 'newApplicant':
      return { ...state, step: 1, furthest: 1, resumes: [], evaluation: { status: 'idle' } }
  }
}
