import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { isAbort, toFlowError } from './errors'

describe('isAbort', () => {
  it('取り消し（AbortError）だけを、中断として扱う', () => {
    expect(isAbort(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbort(new DOMException('x', 'NetworkError'))).toBe(false)
    expect(isAbort(new Error('AbortError'))).toBe(false)
    expect(isAbort('AbortError')).toBe(false)
    expect(isAbort(null)).toBe(false)
  })
})

describe('toFlowError', () => {
  it('API のエラーは、コードとメッセージを、そのまま持つ', () => {
    expect(toFlowError(new ApiError(422, 'llm_auth', 'API キーを確認してください'))).toEqual({
      code: 'llm_auth',
      message: 'API キーを確認してください',
    })
  })

  it('想定外の例外は、内容を出さずに、定型のメッセージにする', () => {
    const result = toFlowError(new Error('sk-secret-key の詳細'))

    expect(result.code).toBe('unexpected')
    expect(result.message).not.toContain('sk-secret')
    expect(toFlowError('文字列')).toEqual(result)
    expect(toFlowError(undefined)).toEqual(result)
  })
})
