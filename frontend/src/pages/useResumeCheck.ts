import { useEffect } from 'react'
import { api } from '../api/client'
import { isAbort, toFlowError } from '../state/errors'
import { useFlow } from '../state/flow-context'

/**
 * 職歴書を選んだ直後に、サーバーで検証する（仕様 5.3、6.1）。
 *
 * 結果は、選ぶたびに付く検証の要求 ID（`checkId`）つきで、状態へ送る。選び直したあとに、前の職歴書の
 * 結果が届いても、リデューサーが無視する。画面を離れたら要求を取り消すが、検証中のままなので、
 * 戻ってくれば、もう一度確認する。
 */
export function useResumeCheck(): void {
  const { state, dispatch } = useFlow()
  const resume = state.resume
  const checkId = resume?.checkId
  const source = resume?.source
  const checking = resume?.check.status === 'checking'

  useEffect(() => {
    if (!checking || checkId === undefined || !source) return
    const controller = new AbortController()
    const input = source.kind === 'file' ? { file: source.file } : { text: source.text }
    api
      .checkResume(input, controller.signal)
      .then((check) => {
        dispatch({ type: 'resumeChecked', check, checkId })
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        dispatch({ type: 'resumeCheckFailed', error: toFlowError(error), checkId })
      })
    return () => {
      controller.abort()
    }
  }, [checking, checkId, source, dispatch])
}
