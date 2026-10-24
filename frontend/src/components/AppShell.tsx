import { ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons'
import { Alert, Button, Layout, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useSettings } from '../api/hooks'

export type View = 'flow' | 'settings'

interface AppShellProps {
  view: View
  onNavigate: (view: View) => void
  children: ReactNode
}

/** 枠: ヘッダー（タイトル・設定への入口）と、API キー未設定のバナー（仕様 5.6、6.3）。 */
export function AppShell({ view, onNavigate, children }: AppShellProps) {
  const settings = useSettings()
  const keyIsUnset = settings.data?.openai_api_key_masked === ''

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          paddingInline: 24,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          職歴書マッチング評価
        </Typography.Title>
        {view === 'flow' ? (
          <Button
            type="text"
            icon={<SettingOutlined />}
            aria-label="設定"
            onClick={() => {
              onNavigate('settings')
            }}
          >
            設定
          </Button>
        ) : (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              onNavigate('flow')
            }}
          >
            評価に戻る
          </Button>
        )}
      </Layout.Header>
      {keyIsUnset && view === 'flow' ? (
        <Alert
          banner
          type="warning"
          showIcon
          title="API キーが設定されていません"
          description="評価するには、設定ページで API キーを登録してください。"
          action={
            <Button
              size="small"
              onClick={() => {
                onNavigate('settings')
              }}
            >
              設定ページへ
            </Button>
          }
        />
      ) : null}
      <Layout.Content style={{ padding: '24px', maxWidth: 1240, width: '100%', margin: '0 auto' }}>
        {children}
      </Layout.Content>
    </Layout>
  )
}
