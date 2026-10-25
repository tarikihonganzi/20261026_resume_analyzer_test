import { describe, expect, it } from 'vitest'
import type { CatalogItem, Condition, EvaluationResult, ResumeCheck } from '../api/types'
import {
  buildConditions,
  canEvaluate,
  conditionCounts,
  initialState,
  isConditionsComplete,
  reducer,
  resumesStatus,
  stepStatuses,
  type Action,
  type FlowState,
} from './flow'

const catalog: CatalogItem[] = [
  { id: 'qual-1', label: '1級建築施工管理技士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'qual-2', label: '2級建築士', kind: 'boolean', unit: null, category: '資格' },
  { id: 'skill-revit', label: 'Revit', kind: 'number', unit: '年', category: 'スキル・ツール' },
]

const custom: Condition = {
  id: 'custom-1',
  label: '耐震診断の経験',
  kind: 'boolean',
  required: false,
  min_value: null,
  unit: null,
  source: 'custom',
  category: '自由記述',
  description: null,
}

const check: ResumeCheck = { format: 'docx', source_name: '田中.docx', char_count: 300 }
const result = { score: 80 } as EvaluationResult

function run(actions: Action[], from: FlowState = initialState): FlowState {
  return actions.reduce(reducer, from)
}

const select = (id: string, kind: 'boolean' | 'number', mode: 'optional' | 'required'): Action => ({
  type: 'setMode',
  id,
  kind,
  mode,
})

/** ① を完了して、② にいる状態。 */
const atResume = () => run([select('qual-1', 'boolean', 'required'), { type: 'next' }])

/** ② で職歴書の検証が成功した状態。 */
const withCheckedResume = () =>
  run(
    [
      { type: 'resumeAdded', source: { kind: 'text', text: '本文' }, name: '貼り付けテキスト' },
      { type: 'resumeChecked', check, id: 1 },
    ],
    atResume(),
  )

describe('初期状態', () => {
  it('① にいて、何も選ばれていない', () => {
    expect(initialState.step).toBe(0)
    expect(conditionCounts(initialState)).toEqual({ required: 0, optional: 0 })
    expect(initialState.resumes).toEqual([])
    expect(initialState.evaluation.status).toBe('idle')
  })
})

describe('条件の選択', () => {
  it('「使わない・任意・必須」を切り替えられる', () => {
    const state = run([
      select('qual-1', 'boolean', 'required'),
      select('qual-2', 'boolean', 'optional'),
    ])

    expect(conditionCounts(state)).toEqual({ required: 1, optional: 1 })
  })

  it('「使わない」に戻すと、数えない', () => {
    const state = run([
      select('qual-1', 'boolean', 'required'),
      { type: 'setMode', id: 'qual-1', kind: 'boolean', mode: 'off' },
    ])

    expect(conditionCounts(state)).toEqual({ required: 0, optional: 0 })
  })

  it('最低値を設定できる。小数も、0 も入る', () => {
    const state = run([
      select('skill-revit', 'number', 'optional'),
      { type: 'setMinValue', id: 'skill-revit', minValue: 2.5 },
    ])

    expect(state.selections['skill-revit']?.minValue).toBe(2.5)
    expect(
      reducer(state, { type: 'setMinValue', id: 'skill-revit', minValue: 0 }).selections[
        'skill-revit'
      ]?.minValue,
    ).toBe(0)
  })

  it('選んでいない条件の最低値は、変えても何も起きない', () => {
    expect(reducer(initialState, { type: 'setMinValue', id: 'x', minValue: 1 })).toBe(initialState)
  })
})

describe('① を完了できる条件（仕様 6.2）', () => {
  it('1 件も選ばれていなければ、完了できない', () => {
    expect(isConditionsComplete(initialState)).toBe(false)
    expect(reducer(initialState, { type: 'next' })).toBe(initialState)
  })

  it('boolean の条件が 1 件あれば、完了できる', () => {
    expect(isConditionsComplete(run([select('qual-1', 'boolean', 'optional')]))).toBe(true)
  })

  it('number の条件は、最低値が入力済みのときだけ完了できる', () => {
    const withoutMin = run([select('skill-revit', 'number', 'required')])
    const withMin = reducer(withoutMin, { type: 'setMinValue', id: 'skill-revit', minValue: 3 })

    expect(isConditionsComplete(withoutMin)).toBe(false)
    expect(isConditionsComplete(withMin)).toBe(true)
  })

  it('最低値が 0 でも、入力済みとして扱う', () => {
    const state = run([
      select('skill-revit', 'number', 'optional'),
      { type: 'setMinValue', id: 'skill-revit', minValue: 0 },
    ])

    expect(isConditionsComplete(state)).toBe(true)
  })

  it('「使わない」の number 条件の、未入力の最低値は、邪魔をしない', () => {
    const state = run([
      select('skill-revit', 'number', 'optional'),
      { type: 'setMode', id: 'skill-revit', kind: 'number', mode: 'off' },
      select('qual-1', 'boolean', 'optional'),
    ])

    expect(isConditionsComplete(state)).toBe(true)
  })

  it('負の最低値は、入力済みとして認めない', () => {
    const state = run([
      select('skill-revit', 'number', 'optional'),
      { type: 'setMinValue', id: 'skill-revit', minValue: -1 },
    ])

    expect(isConditionsComplete(state)).toBe(false)
  })

  it('完了すると ② に進み、① に戻れる', () => {
    const state = atResume()

    expect(state.step).toBe(1)
    expect(state.furthest).toBe(1)
  })
})

describe('自由記述の条件', () => {
  it('追加すると、「任意」で選ばれた状態になる', () => {
    const state = reducer(initialState, { type: 'addCustom', condition: custom })

    expect(conditionCounts(state)).toEqual({ required: 0, optional: 1 })
    expect(state.customConditions).toEqual([custom])
  })

  it('編集できる。選択の状態（必須など）は保たれる', () => {
    const added = run([
      { type: 'addCustom', condition: custom },
      { type: 'setMode', id: custom.id, kind: 'boolean', mode: 'required' },
    ])

    const edited = reducer(added, {
      type: 'updateCustom',
      condition: { ...custom, label: '耐震診断・改修の経験' },
    })

    expect(edited.customConditions[0]?.label).toBe('耐震診断・改修の経験')
    expect(conditionCounts(edited)).toEqual({ required: 1, optional: 0 })
  })

  it('型を number に変えると、最低値の入力が必要になる', () => {
    const added = reducer(initialState, { type: 'addCustom', condition: custom })

    const edited = reducer(added, {
      type: 'updateCustom',
      condition: { ...custom, kind: 'number', min_value: null, unit: '年' },
    })

    expect(isConditionsComplete(edited)).toBe(false)
  })

  it('削除すると、選択からも消える', () => {
    const added = reducer(initialState, { type: 'addCustom', condition: custom })

    const removed = reducer(added, { type: 'removeCustom', id: custom.id })

    expect(removed.customConditions).toEqual([])
    expect(removed.selections[custom.id]).toBeUndefined()
    expect(conditionCounts(removed)).toEqual({ required: 0, optional: 0 })
  })
})

describe('buildConditions（評価に送る条件）', () => {
  it('選ばれたものだけを、プリセット → 自由記述の順で、必須・最低値つきで返す', () => {
    const state = run([
      select('skill-revit', 'number', 'optional'),
      { type: 'setMinValue', id: 'skill-revit', minValue: 2.5 },
      select('qual-1', 'boolean', 'required'),
      { type: 'addCustom', condition: custom },
    ])

    const conditions = buildConditions(catalog, state)

    expect(conditions.map((c) => c.id)).toEqual(['qual-1', 'skill-revit', 'custom-1'])
    expect(conditions[0]).toMatchObject({ required: true, min_value: null, source: 'preset' })
    expect(conditions[1]).toMatchObject({ required: false, min_value: 2.5, unit: '年' })
    expect(conditions[2]).toMatchObject({ required: false, source: 'custom' })
  })

  it('boolean の条件には、最低値を付けない', () => {
    const state = run([select('qual-1', 'boolean', 'optional')])

    expect(buildConditions(catalog, state)[0]?.min_value).toBeNull()
  })

  it('カタログにない id の選択は、送らない', () => {
    const state = run([select('unknown', 'boolean', 'optional')])

    expect(buildConditions(catalog, state)).toEqual([])
  })
})

describe('ステップの移動（仕様 6.2・受け入れ基準 11）', () => {
  it('未到達のステップへは飛べない', () => {
    expect(reducer(initialState, { type: 'goTo', step: 2 })).toBe(initialState)
    expect(reducer(initialState, { type: 'goTo', step: 1 })).toBe(initialState)
  })

  it('完了済みのステップには戻れて、入力が保たれる', () => {
    const state = reducer(withCheckedResume(), { type: 'goTo', step: 0 })

    expect(state.step).toBe(0)
    expect(conditionCounts(state)).toEqual({ required: 1, optional: 0 })
    expect(state.resumes[0]?.check.status).toBe('ok')
  })

  it('戻ったあと、到達済みのステップへは進める', () => {
    const state = run(
      [
        { type: 'goTo', step: 0 },
        { type: 'goTo', step: 1 },
      ],
      withCheckedResume(),
    )

    expect(state.step).toBe(1)
  })

  it('現在のステップへの移動は、何も起こさない', () => {
    const state = atResume()

    expect(reducer(state, { type: 'goTo', step: 1 })).toBe(state)
  })

  it('「戻る」は、ひとつ前のステップへ', () => {
    expect(reducer(atResume(), { type: 'back' }).step).toBe(0)
    expect(reducer(initialState, { type: 'back' })).toBe(initialState)
  })
})

describe('② 職歴書', () => {
  it('選ぶと、検証中になる。検証に成功すると、評価できる', () => {
    const selected = reducer(atResume(), {
      type: 'resumeAdded',
      source: { kind: 'text', text: '本文' },
      name: '貼り付けテキスト',
    })
    expect(selected.resumes[0]?.check.status).toBe('checking')
    expect(canEvaluate(selected)).toBe(false)

    expect(canEvaluate(reducer(selected, { type: 'resumeChecked', check, id: 1 }))).toBe(true)
  })

  it('検証に失敗すると、評価できない。別のファイルを選び直せる', () => {
    const failed = run(
      [
        {
          type: 'resumeAdded',
          source: { kind: 'file', file: new File(['x'], 'a.bin') },
          name: 'a.bin',
        },
        {
          type: 'resumeCheckFailed',
          error: { code: 'unsupported_format', message: '読み取れません' },
          id: 1,
        },
      ],
      atResume(),
    )

    expect(failed.resumes[0]?.check).toEqual({
      status: 'error',
      error: { code: 'unsupported_format', message: '読み取れません' },
    })
    expect(canEvaluate(failed)).toBe(false)
    expect(failed.step).toBe(1)
    expect(conditionCounts(failed)).toEqual({ required: 1, optional: 0 })

    // 使えない書類は、一覧に残る。削除すると、選び直せる
    const removed = reducer(failed, { type: 'resumeRemoved', id: 1 })
    expect(removed.resumes).toEqual([])
    const retried = reducer(removed, {
      type: 'resumeAdded',
      source: { kind: 'text', text: 'ok' },
      name: '貼り付けテキスト',
    })
    expect(retried.resumes[0]?.check.status).toBe('checking')
  })

  it('古い検証結果は、新しく選んだ職歴書に影響しない', () => {
    const state = run(
      [
        { type: 'resumeAdded', source: { kind: 'text', text: 'A' }, name: 'A' },
        { type: 'resumeAdded', source: { kind: 'text', text: 'B' }, name: 'B' },
        { type: 'resumeChecked', check: { ...check, source_name: 'A' }, id: 1 },
      ],
      atResume(),
    )

    // 貼り付けテキストは 1 件だけなので、B が A を置き換える
    expect(state.resumes.map((item) => item.name)).toEqual(['B'])
    expect(state.resumes[0]?.check.status).toBe('checking')
  })

  it('取り除ける', () => {
    expect(reducer(withCheckedResume(), { type: 'resumeRemoved', id: 1 }).resumes).toEqual([])
  })

  it('職歴書がないと、評価を始められない', () => {
    expect(reducer(atResume(), { type: 'startEvaluation' })).toEqual(atResume())
  })
})

describe('③ 評価', () => {
  const running = () => reducer(withCheckedResume(), { type: 'startEvaluation' })

  it('始めると、③ に進み、「抽出中」から始まる', () => {
    const state = running()

    expect(state.step).toBe(2)
    expect(state.evaluation).toMatchObject({ status: 'running', stage: 'extracting' })
  })

  it('進捗は、抽出中 → 最終評価中', () => {
    const state = reducer(running(), { type: 'stageChanged', stage: 'scoring', runId: 1 })

    expect(state.evaluation).toMatchObject({ status: 'running', stage: 'scoring' })
  })

  it('評価中は、ほかのステップへ戻れない', () => {
    const state = running()

    expect(reducer(state, { type: 'goTo', step: 0 })).toBe(state)
    expect(reducer(state, { type: 'goTo', step: 1 })).toBe(state)
    expect(reducer(state, { type: 'back' })).toBe(state)
  })

  it('成功すると、結果を持つ', () => {
    const state = reducer(running(), { type: 'evaluationSucceeded', result, runId: 1 })

    expect(state.evaluation).toEqual({ status: 'done', result })
    expect(stepStatuses(state)[2]).toBe('finish')
  })

  it('失敗すると、エラーを持ち、③ がエラー状態になる。条件・職歴書は残る', () => {
    const error = { code: 'llm_unavailable', message: '混み合っています' }

    const state = reducer(running(), { type: 'evaluationFailed', error, runId: 1 })

    expect(state.evaluation).toEqual({ status: 'error', error })
    expect(stepStatuses(state)[2]).toBe('error')
    expect(state.resumes[0]?.check.status).toBe('ok')
    expect(conditionCounts(state)).toEqual({ required: 1, optional: 0 })
  })

  it('失敗したあとは、「再実行」で、もう一度始められる', () => {
    const failed = reducer(running(), {
      type: 'evaluationFailed',
      error: { code: 'x', message: 'y' },
      runId: 1,
    })

    const again = reducer(failed, { type: 'startEvaluation' })

    expect(again.evaluation).toMatchObject({ status: 'running', stage: 'extracting' })
  })

  it('評価中の二重の開始は、無視する', () => {
    const state = running()

    expect(reducer(state, { type: 'startEvaluation' })).toBe(state)
  })

  it('失敗後は、条件に戻れる（仕様 6.2「条件に戻る」）', () => {
    const failed = reducer(running(), {
      type: 'evaluationFailed',
      error: { code: 'x', message: 'y' },
      runId: 1,
    })

    const state = reducer(failed, { type: 'goTo', step: 0 })

    expect(state.step).toBe(0)
    expect(state.evaluation.status).toBe('idle')
  })

  it('キャンセルすると、② に戻り、職歴書と条件は残る', () => {
    const state = reducer(running(), { type: 'cancelEvaluation' })

    expect(state.step).toBe(1)
    expect(state.evaluation.status).toBe('idle')
    expect(state.resumes[0]?.check.status).toBe('ok')
    expect(canEvaluate(state)).toBe(true)
  })

  it('評価の終了後に遅れて届いたイベントは、無視する', () => {
    const done = reducer(running(), { type: 'evaluationSucceeded', result, runId: 1 })

    expect(reducer(done, { type: 'stageChanged', stage: 'extracting', runId: 1 })).toBe(done)
    expect(
      reducer(done, { type: 'evaluationFailed', error: { code: 'x', message: 'y' }, runId: 1 }),
    ).toBe(done)
  })

  it('キャンセル後に届いた結果は、無視する', () => {
    const cancelled = reducer(running(), { type: 'cancelEvaluation' })

    expect(reducer(cancelled, { type: 'evaluationSucceeded', result, runId: 1 })).toBe(cancelled)
  })
})

describe('結果画面からの操作（受け入れ基準 13）', () => {
  const done = () =>
    run(
      [{ type: 'startEvaluation' }, { type: 'evaluationSucceeded', result, runId: 1 }],
      withCheckedResume(),
    )

  it('「条件を変えて再評価」は、① に戻る。職歴書は残る', () => {
    const state = reducer(done(), { type: 'reevaluate' })

    expect(state.step).toBe(0)
    expect(state.evaluation.status).toBe('idle')
    expect(state.resumes[0]?.check.status).toBe('ok')
    expect(conditionCounts(state)).toEqual({ required: 1, optional: 0 })
  })

  it('「条件を変えて再評価」のあと、条件を変えて ②→評価 に進める', () => {
    const state = run(
      [
        { type: 'reevaluate' },
        select('qual-2', 'boolean', 'optional'),
        { type: 'next' },
        { type: 'startEvaluation' },
      ],
      done(),
    )

    expect(state.evaluation.status).toBe('running')
    expect(conditionCounts(state)).toEqual({ required: 1, optional: 1 })
  })

  it('「別の応募者を評価」は、職歴書だけを捨てて、条件を残して ② に戻る', () => {
    const state = reducer(done(), { type: 'newApplicant' })

    expect(state.step).toBe(1)
    expect(state.resumes).toEqual([])
    expect(state.evaluation.status).toBe('idle')
    expect(conditionCounts(state)).toEqual({ required: 1, optional: 0 })
    expect(state.furthest).toBe(1)
  })

  it('「別の応募者を評価」のあと、新しい職歴書を置いて、すぐ評価できる', () => {
    const state = run(
      [
        { type: 'newApplicant' },
        {
          type: 'resumeAdded',
          source: { kind: 'text', text: '別の人' },
          name: '貼り付けテキスト',
        },
        { type: 'resumeChecked', check, id: 2 },
        { type: 'startEvaluation' },
      ],
      done(),
    )

    expect(state.evaluation).toMatchObject({ status: 'running' })
  })
})

describe('条件を変えたときの、後ろのステップの扱い', () => {
  it('結果が出たあとに条件を変えると、結果は古くなるので消える', () => {
    const done = run(
      [{ type: 'startEvaluation' }, { type: 'evaluationSucceeded', result, runId: 1 }],
      withCheckedResume(),
    )

    const edited = run([{ type: 'goTo', step: 0 }, select('qual-2', 'boolean', 'optional')], done)

    expect(edited.evaluation.status).toBe('idle')
    expect(edited.furthest).toBe(1)
    expect(edited.resumes[0]?.check.status).toBe('ok')
  })

  it('条件が不完全になると、② へは進めない', () => {
    const state = run(
      [
        { type: 'goTo', step: 0 },
        { type: 'setMode', id: 'qual-1', kind: 'boolean', mode: 'off' },
      ],
      withCheckedResume(),
    )

    expect(state.furthest).toBe(0)
    expect(reducer(state, { type: 'goTo', step: 1 })).toBe(state)
  })
})

describe('保存済みの条件セットの読み込み（受け入れ基準 8）', () => {
  it('選択と自由記述を、読み込んだ内容に置き換える', () => {
    const before = run([
      select('qual-1', 'boolean', 'required'),
      { type: 'addCustom', condition: custom },
    ])
    const loaded: Condition[] = [
      {
        id: 'skill-revit',
        label: 'Revit',
        kind: 'number',
        required: true,
        min_value: 2,
        unit: '年',
        source: 'preset',
        category: 'スキル・ツール',
        description: null,
      },
      { ...custom, id: 'custom-2', label: '別の自由記述', required: true },
    ]

    const state = reducer(before, { type: 'loadConditions', conditions: loaded })

    expect(conditionCounts(state)).toEqual({ required: 2, optional: 0 })
    expect(state.selections['qual-1']).toBeUndefined()
    expect(state.customConditions.map((c) => c.id)).toEqual(['custom-2'])
    expect(buildConditions(catalog, state).map((c) => [c.id, c.min_value])).toEqual([
      ['skill-revit', 2],
      ['custom-2', null],
    ])
  })

  it('読み込みのあと、後ろのステップは、条件が完了していれば保たれる', () => {
    const state = reducer(withCheckedResume(), {
      type: 'loadConditions',
      conditions: [{ ...custom, required: false }],
    })

    expect(state.evaluation.status).toBe('idle')
    expect(isConditionsComplete(state)).toBe(true)
  })
})

describe('Steps の状態と要約（受け入れ基準 11）', () => {
  it('① にいるとき: 進行中・未着手・未着手', () => {
    expect(stepStatuses(initialState)).toEqual(['process', 'wait', 'wait'])
  })

  it('② にいるとき: 完了・進行中・未着手', () => {
    expect(stepStatuses(atResume())).toEqual(['finish', 'process', 'wait'])
  })

  it('② の検証が失敗したら、② がエラー', () => {
    const failed = run(
      [
        { type: 'resumeAdded', source: { kind: 'text', text: 'x' }, name: 'x' },
        { type: 'resumeCheckFailed', error: { code: 'x', message: 'y' }, id: 1 },
      ],
      atResume(),
    )

    expect(stepStatuses(failed)[1]).toBe('error')
  })

  it('評価中は ③ が進行中', () => {
    const state = reducer(withCheckedResume(), { type: 'startEvaluation' })

    expect(stepStatuses(state)).toEqual(['finish', 'finish', 'process'])
  })

  it('① に戻っても、検証が済んだ ② は完了のまま', () => {
    expect(stepStatuses(reducer(withCheckedResume(), { type: 'goTo', step: 0 }))).toEqual([
      'process',
      'finish',
      'wait',
    ])
  })
})

describe('補足説明を評価に送る（仕様 13.1 #27）', () => {
  const described: CatalogItem[] = [
    {
      id: 'q1',
      label: '品質管理',
      kind: 'boolean',
      unit: null,
      category: '経験',
      description: '検査への立会い・試験の記録を数える',
    },
    { id: 'q2', label: '原価管理', kind: 'boolean', unit: null, category: '経験' },
  ]

  it('プリセットの補足説明を、そのまま送る。ない条件は null', () => {
    const state = run([select('q1', 'boolean', 'required'), select('q2', 'boolean', 'optional')])

    const conditions = buildConditions(described, state)

    expect(conditions.map((c) => c.description)).toEqual([
      '検査への立会い・試験の記録を数える',
      null,
    ])
  })

  it('自由記述の補足説明を、そのまま送る', () => {
    const state = reducer(initialState, {
      type: 'addCustom',
      condition: { ...custom, description: '診断報告書の作成までを数える' },
    })

    expect(buildConditions([], state)[0]?.description).toBe('診断報告書の作成までを数える')
  })

  it('自由記述の補足説明は、編集しても、条件セットを読み込んでも失われない', () => {
    const added = reducer(initialState, {
      type: 'addCustom',
      condition: { ...custom, description: '最初の説明' },
    })
    const edited = reducer(added, {
      type: 'updateCustom',
      condition: { ...custom, description: '直した説明' },
    })
    const reloaded = reducer(initialState, {
      type: 'loadConditions',
      conditions: buildConditions([], edited),
    })

    expect(buildConditions([], reloaded)[0]?.description).toBe('直した説明')
  })
})

// --- Copilot のレビュー（PR#24）: 通知の照合と、職歴書の差し替え ---

describe('検証の要求の ID（同名・同じ貼り付けテキストの選び直し）', () => {
  const select = (text: string): Action => ({
    type: 'resumeAdded',
    source: { kind: 'text', text },
    name: '貼り付けテキスト',
  })

  it('同じ名前の職歴書を選び直しても、前の検証の結果は、新しい職歴書に適用されない', () => {
    const state = run(
      [select('A'), select('B'), { type: 'resumeChecked', check, id: 1 }],
      atResume(),
    )

    expect(state.resumes[0]?.id).toBe(2)
    expect(state.resumes[0]?.check.status).toBe('checking')
    expect(canEvaluate(state)).toBe(false)
  })

  it('前の検証の失敗も、新しい職歴書には適用されない', () => {
    const state = run(
      [
        select('A'),
        select('B'),
        { type: 'resumeCheckFailed', error: { code: 'x', message: 'y' }, id: 1 },
      ],
      atResume(),
    )

    expect(state.resumes[0]?.check.status).toBe('checking')
  })

  it('現在の検証の結果は、採用される', () => {
    const state = run(
      [select('A'), select('B'), { type: 'resumeChecked', check, id: 2 }],
      atResume(),
    )

    expect(state.resumes[0]?.check.status).toBe('ok')
  })

  it('検証が済んだあとに、同じ ID の結果が重ねて届いても、無視する', () => {
    const checked = run([select('A'), { type: 'resumeChecked', check, id: 1 }], atResume())

    const again = reducer(checked, {
      type: 'resumeCheckFailed',
      error: { code: 'x', message: 'y' },
      id: 1,
    })

    expect(again).toBe(checked)
  })

  it('職歴書を取り除いたあとに届いた結果は、無視する', () => {
    const state = run(
      [select('A'), { type: 'resumeRemoved', id: 1 }, { type: 'resumeChecked', check, id: 1 }],
      atResume(),
    )

    expect(state.resumes).toEqual([])
  })

  it('取り除いて選び直すと、ID は前のものと重ならない', () => {
    const state = run([select('A'), { type: 'resumeRemoved', id: 1 }, select('B')], atResume())

    expect(state.resumes[0]?.id).toBe(2)
  })
})

describe('評価の実行 ID（キャンセル・再実行のあとに遅れて届く通知）', () => {
  const cancelledThenRestarted = () =>
    run(
      [{ type: 'startEvaluation' }, { type: 'cancelEvaluation' }, { type: 'startEvaluation' }],
      withCheckedResume(),
    )

  it('開始のたびに、新しい実行 ID が付く', () => {
    const state = cancelledThenRestarted()

    expect(state.evaluation).toMatchObject({ status: 'running', runId: 2 })
  })

  it('キャンセルした評価（A）の通知は、あとから始めた評価（B）に適用されない', () => {
    const running = cancelledThenRestarted()

    expect(reducer(running, { type: 'stageChanged', stage: 'scoring', runId: 1 })).toBe(running)
    expect(reducer(running, { type: 'evaluationSucceeded', result, runId: 1 })).toBe(running)
    expect(
      reducer(running, { type: 'evaluationFailed', error: { code: 'x', message: 'y' }, runId: 1 }),
    ).toBe(running)
  })

  it('A の通知を無視したあと、B の結果は、正しく採用される', () => {
    const state = run(
      [
        { type: 'evaluationSucceeded', result: { score: 1 } as EvaluationResult, runId: 1 },
        { type: 'evaluationSucceeded', result, runId: 2 },
      ],
      cancelledThenRestarted(),
    )

    expect(state.evaluation).toEqual({ status: 'done', result })
  })

  it('失敗した評価を再実行すると、前の実行の通知は無視される', () => {
    const state = run(
      [
        { type: 'startEvaluation' },
        { type: 'evaluationFailed', error: { code: 'x', message: 'y' }, runId: 1 },
        { type: 'startEvaluation' },
        { type: 'evaluationFailed', error: { code: 'old', message: 'old' }, runId: 1 },
      ],
      withCheckedResume(),
    )

    expect(state.evaluation).toMatchObject({ status: 'running', runId: 2 })
  })
})

describe('職歴書を差し替える・取り除くと、前の応募者の結果は消える', () => {
  const done = () =>
    run(
      [{ type: 'startEvaluation' }, { type: 'evaluationSucceeded', result, runId: 1 }],
      withCheckedResume(),
    )
  const backToResume = () => reducer(done(), { type: 'goTo', step: 1 })

  it('評価のあと ② に戻って別の職歴書を選ぶと、評価結果を捨て、③ へは進めない', () => {
    const state = reducer(backToResume(), {
      type: 'resumeAdded',
      source: { kind: 'text', text: '別の人' },
      name: '貼り付けテキスト',
    })

    expect(state.evaluation.status).toBe('idle')
    expect(state.furthest).toBe(1)
    expect(reducer(state, { type: 'goTo', step: 2 })).toBe(state)
  })

  it('評価のあと ② に戻って職歴書を取り除くと、評価結果を捨て、③ へは進めない', () => {
    const state = reducer(backToResume(), { type: 'resumeRemoved', id: 1 })

    expect(state.resumes).toEqual([])
    expect(state.evaluation.status).toBe('idle')
    expect(state.furthest).toBe(1)
    expect(reducer(state, { type: 'goTo', step: 2 })).toBe(state)
  })

  it('同じ職歴書の ② の確認（戻って、進む）だけなら、結果は残る', () => {
    const state = run(
      [
        { type: 'goTo', step: 1 },
        { type: 'goTo', step: 2 },
      ],
      done(),
    )

    expect(state.evaluation.status).toBe('done')
  })

  it('③ にいるときに取り除かれても、③ の結果を出し続けない（② に戻る）', () => {
    const state = reducer(done(), { type: 'resumeRemoved', id: 1 })

    expect(state.step).toBe(1)
    expect(state.evaluation.status).toBe('idle')
  })

  it('評価中は、職歴書の差し替え・取り除きを受け付けない', () => {
    const running = reducer(withCheckedResume(), { type: 'startEvaluation' })

    expect(reducer(running, { type: 'resumeRemoved', id: 1 })).toBe(running)
    expect(
      reducer(running, {
        type: 'resumeAdded',
        source: { kind: 'text', text: 'x' },
        name: 'x',
      }),
    ).toBe(running)
  })
})

// --- 複数の書類（仕様 5.3。13.1 #30） ---

describe('複数の職歴書', () => {
  const file = (name: string): Action => ({
    type: 'resumeAdded',
    source: { kind: 'file', file: new File(['x'], name) },
    name,
  })
  const ok = (id: number): Action => ({ type: 'resumeChecked', check, id })
  const names = (state: FlowState) => state.resumes.map((item) => item.name)

  it('ファイルを、続けて追加できる。ID は、追加のたびに増える', () => {
    const state = run([file('a.pdf'), file('b.docx')], atResume())

    expect(names(state)).toEqual(['a.pdf', 'b.docx'])
    expect(state.resumes.map((item) => item.id)).toEqual([1, 2])
  })

  it('同じ名前のファイルも、別の書類として並ぶ', () => {
    expect(names(run([file('a.pdf'), file('a.pdf')], atResume()))).toEqual(['a.pdf', 'a.pdf'])
  })

  it('最大 5 件まで。6 件目は追加しない', () => {
    const state = run(
      ['1', '2', '3', '4', '5', '6'].map((n) => file(`${n}.pdf`)),
      atResume(),
    )

    expect(names(state)).toEqual(['1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf'])
  })

  it('貼り付けテキストも、1 件に数える。ファイルが 5 件あると、追加しない', () => {
    const full = run(
      ['1', '2', '3', '4', '5'].map((n) => file(`${n}.pdf`)),
      atResume(),
    )

    const state = reducer(full, {
      type: 'resumeAdded',
      source: { kind: 'text', text: 'x' },
      name: '貼り付けテキスト',
    })

    expect(state).toBe(full)
  })

  it('貼り付けテキストは 1 件だけ。入力し直すと、前のテキストを置き換え、ファイルは残る', () => {
    const state = run(
      [
        file('a.pdf'),
        { type: 'resumeAdded', source: { kind: 'text', text: 'A' }, name: '貼り付けテキスト' },
        { type: 'resumeAdded', source: { kind: 'text', text: 'B' }, name: '貼り付けテキスト' },
      ],
      atResume(),
    )

    expect(state.resumes.map((item) => [item.name, item.source.kind])).toEqual([
      ['a.pdf', 'file'],
      ['貼り付けテキスト', 'text'],
    ])
    expect(state.resumes[1]?.source).toEqual({ kind: 'text', text: 'B' })
  })

  it('1 件ずつ取り除ける。残りの書類は、そのまま', () => {
    const state = run(
      [file('a.pdf'), file('b.pdf'), ok(1), ok(2), { type: 'resumeRemoved', id: 1 }],
      atResume(),
    )

    expect(names(state)).toEqual(['b.pdf'])
    expect(state.resumes[0]?.check.status).toBe('ok')
  })

  describe('全体の状態と、評価できるか', () => {
    it('書類がなければ empty。評価できない', () => {
      expect(resumesStatus(atResume())).toBe('empty')
      expect(canEvaluate(atResume())).toBe(false)
    })

    it('1 件でも確認中なら checking。評価できない', () => {
      const state = run([file('a.pdf'), file('b.pdf'), ok(1)], atResume())

      expect(resumesStatus(state)).toBe('checking')
      expect(canEvaluate(state)).toBe(false)
    })

    it('1 件でも使えなければ error。削除すると、評価できる', () => {
      const failed = run(
        [
          file('a.pdf'),
          file('b.bin'),
          ok(1),
          { type: 'resumeCheckFailed', error: { code: 'x', message: 'y' }, id: 2 },
        ],
        atResume(),
      )

      expect(resumesStatus(failed)).toBe('error')
      expect(canEvaluate(failed)).toBe(false)
      expect(stepStatuses(failed)[1]).toBe('error')

      const fixed = reducer(failed, { type: 'resumeRemoved', id: 2 })
      expect(resumesStatus(fixed)).toBe('ok')
      expect(canEvaluate(fixed)).toBe(true)
    })

    it('すべて使えれば ok。② は、戻ったあとも完了', () => {
      const state = run([file('a.pdf'), file('b.pdf'), ok(1), ok(2)], atResume())

      expect(resumesStatus(state)).toBe('ok')
      expect(canEvaluate(state)).toBe(true)
      expect(stepStatuses(reducer(state, { type: 'goTo', step: 0 }))[1]).toBe('finish')
    })
  })

  it('削除した書類の、遅れて届いた検証結果は、無視する', () => {
    const state = run([file('a.pdf'), { type: 'resumeRemoved', id: 1 }, ok(1)], atResume())

    expect(state.resumes).toEqual([])
  })

  it('書類を増やす・減らすと、前の評価結果を捨てて、③ には進めなくなる', () => {
    const done = reducer(reducer(withCheckedResume(), { type: 'startEvaluation' }), {
      type: 'evaluationSucceeded',
      result: { score: 1 } as EvaluationResult,
      runId: 1,
    })
    const backToResume = reducer(done, { type: 'goTo', step: 1 })

    const added = reducer(backToResume, file('c.pdf'))
    const removed = reducer(backToResume, { type: 'resumeRemoved', id: 1 })

    for (const state of [added, removed]) {
      expect(state.evaluation).toEqual({ status: 'idle' })
      expect(state.furthest).toBe(1)
    }
  })

  it('評価中は、書類を追加も削除もできない', () => {
    const running = reducer(withCheckedResume(), { type: 'startEvaluation' })

    expect(reducer(running, file('c.pdf'))).toBe(running)
    expect(reducer(running, { type: 'resumeRemoved', id: 1 })).toBe(running)
  })

  it('「別の応募者を評価」で、書類をすべて捨てる。条件は残る', () => {
    const state = reducer(run([file('a.pdf'), file('b.pdf'), ok(1), ok(2)], atResume()), {
      type: 'newApplicant',
    })

    expect(state.resumes).toEqual([])
    expect(conditionCounts(state)).toEqual({ required: 1, optional: 0 })
    expect(state.step).toBe(1)
  })
})
