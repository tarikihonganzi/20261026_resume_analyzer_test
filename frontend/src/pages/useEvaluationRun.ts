import { useEffect, useEffectEvent } from 'react'
import { useCatalog } from '../api/hooks'
import { streamEvaluation } from '../api/sse'
import { isAbort, toFlowError } from '../state/errors'
import { buildConditions } from '../state/flow'
import { useFlow } from '../state/flow-context'

/**
 * 評価を実行し、進捗・結果・エラーを状態へ送る（仕様 6.1、7）。
 *
 * - 評価は、状態が `running` になったとき（評価ごとの `runId`）に、1 回だけ始める。
 * - キャンセルは、要求の取り消し（`AbortController`）だけ。画面から ③ が消える（キャンセル・離脱）と、
 *   接続が切れ、サーバーは LLM の呼び出しを止める。
 * - 通知は `runId` つきで送る。取り消したあとに届いた通知は、リデューサーが無視する。
 */
export function useEvaluationRun(): void {
  const { state, dispatch } = useFlow()
  const catalog = useCatalog()
  const runId = state.evaluation.status === 'running' ? state.evaluation.runId : null

  // 効果の依存は runId だけにしたいので、最新の条件・職歴書は、イベント関数から読む
  const start = useEffectEvent(async (id: number, signal: AbortSignal) => {
    const resume = state.resume
    if (!catalog.data || !resume) {
      dispatch({
        type: 'evaluationFailed',
        error: {
          code: 'unexpected',
          message: '評価の準備ができていません。条件の画面に戻って、やり直してください。',
        },
        runId: id,
      })
      return
    }
    try {
      const events = streamEvaluation(
        { conditions: buildConditions(catalog.data, state), resume: resume.source },
        signal,
      )
      for await (const event of events) {
        switch (event.event) {
          case 'stage':
            dispatch({ type: 'stageChanged', stage: event.data.stage, runId: id })
            break
          case 'result':
            dispatch({ type: 'evaluationSucceeded', result: event.data, runId: id })
            break
          case 'error':
            dispatch({ type: 'evaluationFailed', error: event.data, runId: id })
            break
        }
      }
    } catch (error) {
      if (isAbort(error) || signal.aborted) return
      dispatch({ type: 'evaluationFailed', error: toFlowError(error), runId: id })
    }
  })

  useEffect(() => {
    if (runId === null) return
    const controller = new AbortController()
    void start(runId, controller.signal)
    return () => {
      controller.abort()
    }
  }, [runId])
}
