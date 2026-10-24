import { Button, Flex, Tag, Typography } from 'antd'
import { TAG_STYLES } from './tagStyles'

interface ConditionsBadgeProps {
  required: number
  optional: number
  /** ① に戻って、条件を変える。 */
  onChange: () => void
  disabled?: boolean
}

/** ② の上部に出す、選んだ条件の件数（例: 必須 2・任意 3）と、「変更」（仕様 6.1）。 */
export function ConditionsBadge({ required, optional, onChange, disabled }: ConditionsBadgeProps) {
  return (
    <Flex align="center" gap={8}>
      <Typography.Text type="secondary">評価する条件:</Typography.Text>
      <Tag style={TAG_STYLES.error}>必須 {required}</Tag>
      <Tag style={TAG_STYLES.info}>任意 {optional}</Tag>
      <Button type="link" size="small" disabled={disabled} onClick={onChange}>
        変更
      </Button>
    </Flex>
  )
}
