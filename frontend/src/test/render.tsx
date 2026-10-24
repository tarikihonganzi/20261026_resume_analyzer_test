import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import jaJP from 'antd/locale/ja_JP'
import type { ReactElement } from 'react'

export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={jaJP}>{ui}</ConfigProvider>
    </QueryClientProvider>,
  )
}
