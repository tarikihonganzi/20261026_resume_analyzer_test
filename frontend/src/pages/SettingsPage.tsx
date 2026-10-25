import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Space,
  Spin,
  Typography,
  message,
} from 'antd'
import { api } from '../api/client'
import { queryKeys, useSettings } from '../api/hooks'
import type { SettingsView } from '../api/types'
import {
  buildSettingsUpdate,
  initialFormValues,
  isValidBaseUrl,
  type SettingsFormValues,
} from '../lib/settings'
import { toFlowError } from '../state/errors'

/** 設定ページ（仕様 6.3）。API キー・ベース URL・モデル名・最大ファイルサイズ。 */
export function SettingsPage() {
  const settings = useSettings()
  if (settings.isPending)
    return <Spin size="large" style={{ display: 'block', margin: '64px auto' }} />
  // 読み込みの失敗は、画面上部のバナー（再試行つき）で示す
  if (settings.isError) return null
  return <SettingsForm saved={settings.data} />
}

function SettingsForm({ saved }: { saved: SettingsView }) {
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const [form] = Form.useForm<SettingsFormValues>()
  // 最初の描画では、まだ値が読めないことがある
  const watched = Form.useWatch([], form) as SettingsFormValues | undefined
  const values = watched ?? initialFormValues(saved)

  const update = buildSettingsUpdate(values, saved)
  const keyIsSaved = saved.openai_api_key_masked !== ''
  const hasKey = keyIsSaved || values.apiKey.trim() !== ''

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.settings, next)
      // 保存したキーは、入力欄に残さない（画面にも出さない）
      form.setFieldValue('apiKey', '')
      void messageApi.success('保存しました。次の評価から反映されます。')
    },
  })

  const test = useMutation({
    mutationFn: api.testConnection,
  })

  const runTest = async () => {
    try {
      await form.validateFields(['baseUrl', 'model'])
    } catch {
      return
    }
    const current = form.getFieldsValue()
    test.mutate({
      openai_api_key: current.apiKey.trim() === '' ? null : current.apiKey.trim(),
      openai_base_url: current.baseUrl.trim(),
      model: current.model.trim(),
    })
  }

  return (
    <Card style={{ maxWidth: 640, margin: '0 auto' }}>
      {contextHolder}
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        設定
      </Typography.Title>
      <Form<SettingsFormValues>
        form={form}
        layout="vertical"
        initialValues={initialFormValues(saved)}
        onValuesChange={() => {
          // 値を変えたら、前の接続テストの結果と、保存のエラーは古くなる
          test.reset()
          save.reset()
        }}
        onFinish={() => {
          if (update) save.mutate(update)
        }}
      >
        <Form.Item
          name="apiKey"
          label="API キー"
          extra={
            keyIsSaved
              ? `保存済み: ${saved.openai_api_key_masked}。変更するときだけ、新しいキーを入力してください。`
              : '未設定です。評価するには、API キーを入力して保存してください。'
          }
        >
          <Input.Password
            autoComplete="new-password"
            spellCheck={false}
            placeholder={keyIsSaved ? '変更しない' : 'API キーを入力'}
          />
        </Form.Item>
        <Form.Item
          name="baseUrl"
          label="ベース URL"
          extra="社内エンドポイントの URL。"
          rules={[
            {
              validator: (_, value: string | undefined) =>
                isValidBaseUrl(value ?? '')
                  ? Promise.resolve()
                  : Promise.reject(
                      new Error('http:// または https:// で始まる URL を入力してください'),
                    ),
            },
          ]}
        >
          <Input spellCheck={false} placeholder="https://" />
        </Form.Item>
        <Form.Item
          name="model"
          label="モデル名"
          rules={[
            {
              validator: (_, value: string | undefined) =>
                (value ?? '').trim() !== ''
                  ? Promise.resolve()
                  : Promise.reject(new Error('モデル名を入力してください')),
            },
          ]}
        >
          <Input spellCheck={false} />
        </Form.Item>
        {/* 単位（MB）を横に並べるため、名前は内側の項目に付け、ラベルは外側から結び付ける */}
        <Form.Item
          label="最大ファイルサイズ"
          htmlFor="maxFileSizeMb"
          extra="職歴書ファイルの上限です。0 のときは、制限しません。"
        >
          <Space.Compact>
            <Form.Item
              name="maxFileSizeMb"
              noStyle
              rules={[
                {
                  required: true,
                  type: 'number',
                  min: 0,
                  message: '0 以上の整数を入力してください',
                },
              ]}
            >
              <InputNumber min={0} precision={0} step={1} style={{ width: 120 }} />
            </Form.Item>
            <Space.Addon>MB</Space.Addon>
          </Space.Compact>
        </Form.Item>

        <Flex gap={8} wrap>
          <Button
            htmlType="submit"
            type="primary"
            loading={save.isPending}
            disabled={update === null}
          >
            保存
          </Button>
          <Button
            loading={test.isPending}
            disabled={!hasKey}
            onClick={() => {
              void runTest()
            }}
          >
            接続テスト
          </Button>
        </Flex>

        <Flex vertical gap={12} style={{ marginTop: 16 }} aria-live="polite">
          {save.isError ? (
            <Alert type="error" showIcon title={toFlowError(save.error).message} />
          ) : null}
          {test.isError ? (
            <Alert type="error" showIcon title={toFlowError(test.error).message} />
          ) : null}
          {test.data ? (
            <Alert
              type={test.data.ok ? 'success' : 'error'}
              showIcon
              title={test.data.ok ? '接続できました' : '接続できませんでした'}
              description={test.data.ok ? undefined : test.data.message}
            />
          ) : null}
        </Flex>
      </Form>
    </Card>
  )
}
