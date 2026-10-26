import { Typography } from 'antd'

/** 結果の先頭に出す、応募者の氏名。読み取れなかったときは、その旨を薄い文字で出す。 */
export function ApplicantName({ name }: { name: string | null }) {
  return (
    <div>
      <Typography.Text type="secondary">応募者</Typography.Text>{' '}
      {name ? (
        <Typography.Text strong style={{ fontSize: 24 }}>
          {name}
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 18 }}>
          氏名の記載なし
        </Typography.Text>
      )}
    </div>
  )
}
