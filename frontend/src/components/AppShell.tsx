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
          マッチング評価
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
      {settings.isError ? (
        <Alert
          banner
          type="error"
          showIcon
          title="設定を読み込めませんでした"
          description={settings.error.message}
          action={
            <Button
              size="small"
              loading={settings.isFetching}
              onClick={() => {
                void settings.refetch()
              }}
            >
              再試行
            </Button>
          }
        />
      ) : null}
      {/* 「全画面の上部」に出す（仕様 6.3）。設定ページでは、誘導のボタンは不要 */}
      {keyIsUnset ? (
        <Alert
          banner
          type="warning"
          showIcon
          title="API キーが設定されていません"
          description={
            view === 'settings'
              ? '評価するには、API キーを入力して保存してください。'
              : '評価するには、設定ページで API キーを登録してください。'
          }
          action={
            view === 'flow' ? (
              <Button
                size="small"
                onClick={() => {
                  onNavigate('settings')
                }}
              >
                設定ページへ
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <Layout.Content style={{ padding: '24px', maxWidth: 1240, width: '100%', margin: '0 auto' }}>
        {children}
      </Layout.Content>
    </Layout>
  )
}
