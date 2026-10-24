import { Alert } from 'antd'
import type { EvaluationResult } from '../api/types'
import { requiredCount } from '../lib/result'

/** 必須条件の未達（仕様 5.5）。該当があれば目立つアラートで、条件名を列挙する。 */
export function RequiredAlert({ result }: { result: EvaluationResult }) {
  if (result.missing_required.length > 0) {
    return (
      <Alert
        type="error"
        showIcon
        title={`満たしていない必須条件があります（${String(result.missing_required.length)} 件）`}
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {result.missing_required.map((missing) => (
              <li key={missing.condition_id}>
                {missing.label}
                {missing.status === 'unknown' ? '（職歴書から確認できませんでした）' : '（未達）'}
              </li>
            ))}
          </ul>
        }
      />
    )
  }
  if (requiredCount(result) === 0) {
    return <Alert type="info" showIcon title="必須条件は設定されていません" />
  }
  return <Alert type="success" showIcon title="必須条件はすべて達成" />
}
