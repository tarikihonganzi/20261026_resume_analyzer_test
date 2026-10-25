import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { Condition } from '../api/types'
import { FlowProvider, useFlow } from '../state/flow-context'
import { server } from '../test/server'
import { useEvaluationRun } from './useEvaluationRun'

const custom: Condition = {
  id: 'custom-1',
  label: '耐震診断の経験',
  kind: 'boolean',
  required: true,
  min_value: null,
  unit: null,
  source: 'custom',
  category: null,
  description: null,
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <FlowProvider>{children}</FlowProvider>
    </QueryClientProvider>
  )
}

/** 条件（自由記述だけ。プリセットの一覧が要らない）と、使える書類がそろい、評価が始まった状態にする。 */
function startEvaluation(result: { current: ReturnType<typeof useFlow> }) {
  act(() => {
    const { dispatch } = result.current
    dispatch({ type: 'addCustom', condition: custom })
    dispatch({ type: 'setMode', id: custom.id, kind: 'boolean', mode: 'required' })
    dispatch({ type: 'next' })
    dispatch({
      type: 'resumeAdded',
      source: { kind: 'text', text: '職歴の本文です。' },
      name: '貼り付けテキスト',
    })
  })
  act(() => {
    result.current.dispatch({
      type: 'resumeChecked',
      check: { format: 'text', source_name: '貼り付けテキスト', char_count: 8 },
      id: 1,
    })
  })
  act(() => {
    result.current.dispatch({ type: 'startEvaluation' })
  })
}

describe('useEvaluationRun（評価の準備ができていないとき）', () => {
  it('プリセットの一覧が読めていなければ、要求を送らず、準備ができていない旨のエラーにする', async () => {
    server.use(
      http.get('*/api/catalog', () =>
        HttpResponse.json({ code: 'storage_error', message: '読めません' }, { status: 500 }),
      ),
    )
    const { result } = renderHook(
      () => {
        useEvaluationRun()
        return useFlow()
      },
      { wrapper },
    )

    startEvaluation(result)

    await waitFor(() => {
      expect(result.current.state.evaluation.status).toBe('error')
    })
    expect(result.current.state.evaluation).toMatchObject({
      error: {
        code: 'unexpected',
        message: expect.stringContaining('準備ができていません') as string,
      },
    })
  })
})
