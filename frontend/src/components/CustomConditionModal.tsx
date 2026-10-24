import { Form, Input, InputNumber, Modal, Radio } from 'antd'
import { useEffect } from 'react'
import type { Condition, ConditionKind } from '../api/types'

interface FormValues {
  label: string
  kind: ConditionKind
  minValue: number | null
  description: string
}

interface CustomConditionModalProps {
  open: boolean
  /** 編集するとき、元の条件。追加のときは undefined。 */
  initial?: Condition
  onSubmit: (condition: Condition) => void
  onCancel: () => void
}

const MAX_LABEL_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500

/** 自由記述の条件の追加・編集（仕様 5.1）。ラベル・型（boolean／number）・最低値を入力する。 */
export function CustomConditionModal({
  open,
  initial,
  onSubmit,
  onCancel,
}: CustomConditionModalProps) {
  const [form] = Form.useForm<FormValues>()
  const kind = Form.useWatch('kind', form)

  // 開くたびに、入力を初期化する（追加なら空、編集なら元の値）
  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      label: initial?.label ?? '',
      kind: initial?.kind ?? 'boolean',
      minValue: initial?.min_value ?? null,
      description: initial?.description ?? '',
    })
  }, [open, initial, form])

  const submit = (values: FormValues) => {
    const isNumber = values.kind === 'number'
    onSubmit({
      // プリセットの id と重ならないよう、自由記述は UUID にする
      id: initial?.id ?? crypto.randomUUID(),
      label: values.label.trim(),
      kind: values.kind,
      required: initial?.required ?? false,
      min_value: isNumber ? values.minValue : null,
      unit: isNumber ? '年' : null,
      source: 'custom',
      category: null,
      // 空なら、補足説明なし（null）
      description: values.description.trim() === '' ? null : values.description.trim(),
    })
  }

  return (
    <Modal
      open={open}
      title={initial ? '自由記述の条件を編集' : '自由記述で条件を追加'}
      okText={initial ? '保存' : '追加'}
      cancelText="キャンセル"
      onOk={() => {
        form.submit()
      }}
      onCancel={onCancel}
      destroyOnHidden
      forceRender
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{ kind: 'boolean', minValue: null, description: '' }}
      >
        <Form.Item
          name="label"
          label="条件の名前"
          rules={[
            {
              validator: (_, value: string | undefined) =>
                (value ?? '').trim() === ''
                  ? Promise.reject(new Error('条件の名前を入力してください'))
                  : Promise.resolve(),
            },
            {
              max: MAX_LABEL_LENGTH,
              message: `${String(MAX_LABEL_LENGTH)} 文字以内で入力してください`,
            },
          ]}
        >
          <Input placeholder="例: 耐震診断の経験" />
        </Form.Item>
        <Form.Item name="kind" label="種類">
          <Radio.Group
            options={[
              { label: '有無（保有しているか）', value: 'boolean' },
              { label: '年数（経験年数など）', value: 'number' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="description"
          label="補足説明（任意）"
          tooltip="何をこの条件として数えるかを書くと、判定のぶれが減ります。数えないものの例も書くと効果的です。"
          rules={[
            {
              max: MAX_DESCRIPTION_LENGTH,
              message: `${String(MAX_DESCRIPTION_LENGTH)} 文字以内で入力してください`,
            },
          ]}
        >
          <Input.TextArea
            rows={3}
            showCount
            maxLength={MAX_DESCRIPTION_LENGTH}
            placeholder="例: 耐震診断の業務で、診断報告書の作成までを担当した経験。調査の補助だけは含めない"
          />
        </Form.Item>
        {kind === 'number' ? (
          <Form.Item
            name="minValue"
            label="最低値（年）"
            rules={[
              { required: true, type: 'number', min: 0, message: '最低値を入力してください' },
            ]}
          >
            <InputNumber min={0} step={0.5} precision={1} style={{ width: 120 }} />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  )
}
