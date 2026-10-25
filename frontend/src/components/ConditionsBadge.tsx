import { Button, Flex, Typography } from 'antd'

interface ConditionsBadgeProps {
  required: number
  optional: number
  /** ① に戻って、条件を変える。 */
  onChange: () => void
  disabled?: boolean
}

/** ② の上部に出す、選んだ条件の件数と、「変更」（仕様 6.1）。タグにせず、ふつうの 1 行にする。 */
export function ConditionsBadge({ required, optional, onChange, disabled }: ConditionsBadgeProps) {
  return (
    <Flex align="center" gap={8}>
      <Typography.Text type="secondary">評価する条件:</Typography.Text>
      <Typography.Text>
        必須 {required} 件・任意 {optional} 件
      </Typography.Text>
      <Button type="link" size="small" disabled={disabled} onClick={onChange}>
        変更
      </Button>
    </Flex>
  )
}
