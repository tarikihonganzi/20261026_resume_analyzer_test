import { ConfigProvider } from 'antd'
import jaJP from 'antd/locale/ja_JP'

export default function App() {
  return (
    <ConfigProvider locale={jaJP}>
      <h1>職歴書マッチング評価</h1>
    </ConfigProvider>
  )
}
