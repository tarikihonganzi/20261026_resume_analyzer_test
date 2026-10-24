import { CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { Flex, Table, Tag, Typography } from 'antd'
import type { CSSProperties, ReactNode } from 'react'
import type { JudgedCondition } from '../api/types'
import { formatExtracted, formatRequirement, STATUS_LABELS } from '../lib/result'
import { EvidenceView } from './EvidenceView'
import { TAG_STYLES } from './tagStyles'

const STATUS_TAGS: Record<JudgedCondition['status'], { style: CSSProperties; icon: ReactNode }> = {
  achieved: { style: TAG_STYLES.success, icon: <CheckCircleOutlined /> },
  unmet: { style: TAG_STYLES.error, icon: <CloseCircleOutlined /> },
  unknown: { style: TAG_STYLES.neutral, icon: <QuestionCircleOutlined /> },
}

/** 条件別の判定表（仕様 5.5）。色だけに頼らず、アイコンと文字でも判定を示す。 */
export function JudgementTable({ conditions }: { conditions: readonly JudgedCondition[] }) {
  return (
    <Table<JudgedCondition>
      size="small"
      pagination={false}
      rowKey={(row) => row.condition.id}
      dataSource={[...conditions]}
      scroll={{ x: 760 }}
      columns={[
        {
          title: '条件',
          key: 'label',
          width: 200,
          render: (_, row) => <Typography.Text strong>{row.condition.label}</Typography.Text>,
        },
        {
          title: '区分',
          key: 'required',
          width: 72,
          render: (_, row) =>
            row.condition.required ? (
              <Tag style={TAG_STYLES.error}>必須</Tag>
            ) : (
              <Tag style={TAG_STYLES.info}>任意</Tag>
            ),
        },
        {
          title: '判定',
          key: 'status',
          width: 96,
          render: (_, row) => {
            const tag = STATUS_TAGS[row.status]
            return (
              <Tag style={tag.style} icon={tag.icon}>
                {STATUS_LABELS[row.status]}
              </Tag>
            )
          },
        },
        {
          title: '抽出値',
          key: 'extracted',
          width: 120,
          render: (_, row) => {
            const requirement = formatRequirement(row)
            return (
              <Flex vertical>
                <span>{formatExtracted(row)}</span>
                {requirement ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    必要: {requirement}
                  </Typography.Text>
                ) : null}
              </Flex>
            )
          },
        },
        {
          title: '根拠',
          key: 'evidence',
          render: (_, row) => <EvidenceView reason={row.reason} quotes={row.quotes} />,
        },
      ]}
    />
  )
}
