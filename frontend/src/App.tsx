import { useCallback, useEffect, useState } from 'react'
import { AppShell, type View } from './components/AppShell'
import { FlowPage } from './pages/FlowPage'
import { FlowProvider } from './state/flow-context'

function viewFromHash(): View {
  return window.location.hash === '#/settings' ? 'settings' : 'flow'
}

/** 画面の切り替え。評価フローと設定ページの 2 つだけなので、ハッシュで十分（再読み込みしても保たれる）。 */
function useView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(viewFromHash)

  useEffect(() => {
    const onChange = () => {
      setView(viewFromHash())
    }
    window.addEventListener('hashchange', onChange)
    return () => {
      window.removeEventListener('hashchange', onChange)
    }
  }, [])

  const navigate = useCallback((next: View) => {
    window.location.hash = next === 'settings' ? '#/settings' : '#/'
  }, [])

  return [view, navigate]
}

export default function App() {
  const [view, navigate] = useView()

  return (
    // 評価フローの状態は、設定ページに移っても保つ（FlowProvider は、画面の切り替えの外に置く）
    <FlowProvider>
      <AppShell view={view} onNavigate={navigate}>
        {view === 'settings' ? <p>設定ページ（準備中）</p> : <FlowPage />}
      </AppShell>
    </FlowProvider>
  )
}
