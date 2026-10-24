import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import jaJP from 'antd/locale/ja_JP'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root が見つかりません')

// 設定ページ・条件セットは、画面を開き直したときに最新を読む。自動の再試行はしない（エラーを早く見せる）
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={jaJP}>
        <App />
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
)
