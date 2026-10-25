import { render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialState } from './flow'
import { FlowProvider, useFlow } from './flow-context'

function Probe() {
  useFlow()
  return null
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFlow', () => {
  it('FlowProvider の外で使うと、分かりやすいエラーにする', () => {
    // React が、エラーを console に出すので、テストの出力を汚さない
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<Probe />)).toThrow('FlowProvider の中で使います')
  })

  it('FlowProvider の中では、初期の状態と dispatch を返す', () => {
    const { result } = renderHook(() => useFlow(), { wrapper: FlowProvider })

    expect(result.current.state).toEqual(initialState)
    expect(typeof result.current.dispatch).toBe('function')
  })
})
