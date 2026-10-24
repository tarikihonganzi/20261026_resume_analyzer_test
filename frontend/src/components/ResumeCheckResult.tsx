import { FileTextOutlined } from '@ant-design/icons'
import { Alert, Descriptions, Flex, Spin, Typography } from 'antd'
import type { ResumeState } from '../state/flow'

/** 職歴書を選んだ直後の、検証の結果（仕様 5.3）。読めないファイルは、その場でエラーにする。 */
export function ResumeCheckResult({ resume }: { resume: ResumeState }) {
  const { check } = resume

  if (check.status === 'checking') {
    return (
      <Flex align="center" gap={12} style={{ padding: '12px 0' }}>
        <Spin />
        <Typography.Text>「{resume.name}」を確認しています…</Typography.Text>
      </Flex>
    )
  }

  if (check.status === 'error') {
    return (
      <Alert
        type="error"
        showIcon
        title={`「${resume.name}」を使えません`}
        description={
          <>
            <div>{check.error.message}</div>
            <div>
              別のファイルを選ぶか、テキストを貼り付けてください（条件の入力は、そのまま残っています）。
            </div>
          </>
        }
      />
    )
  }

  const { result } = check
  const isPdf = result.char_count === null
  return (
    <Alert
      type="success"
      showIcon
      icon={<FileTextOutlined />}
      title="この職歴書を評価に使えます"
      description={
        <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
          <Descriptions.Item label="名前">{result.source_name}</Descriptions.Item>
          <Descriptions.Item label="形式">{result.format}</Descriptions.Item>
          <Descriptions.Item label="文字数">
            {isPdf
              ? 'PDF のため、確認していません（評価のときに、AI が内容を読み取ります）'
              : `${String(result.char_count)} 文字`}
          </Descriptions.Item>
        </Descriptions>
      }
    />
  )
}
