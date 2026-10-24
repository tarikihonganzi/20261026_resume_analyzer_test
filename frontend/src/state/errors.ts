import { ApiError } from '../api/client'
import type { FlowError } from './flow'

/** 取り消し（AbortController）による中断か。画面を離れたときの中断は、エラーにしない。 */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** API のエラーを、画面の状態に持つ形（code・message）にする。 */
export function toFlowError(error: unknown): FlowError {
  if (error instanceof ApiError) return { code: error.code, message: error.message }
  return { code: 'unexpected', message: '予期しないエラーが起きました。もう一度お試しください。' }
}
