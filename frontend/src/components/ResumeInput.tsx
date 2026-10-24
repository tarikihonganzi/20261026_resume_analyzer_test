import { InboxOutlined } from '@ant-design/icons'
import { Input, Tabs, Typography, Upload } from 'antd'
import { useEffect, useRef, useState } from 'react'

interface ResumeInputProps {
  /** いま選ばれている職歴書の入力方法（タブの初期位置と、貼り付けテキストの復元に使う）。 */
  initial: { kind: 'file' } | { kind: 'text'; text: string } | null
  onSelectFile: (file: File) => void
  onSelectText: (text: string) => void
  onClear: () => void
  /** 貼り付けテキストを、入力が止まってから確認するまでの待ち時間。 */
  debounceMs?: number
  disabled?: boolean
}

const DEFAULT_DEBOUNCE_MS = 700

/**
 * 職歴書の入力（仕様 5.3）。ファイルのドラッグ＆ドロップ、またはテキストの貼り付け。
 * ファイルの内容は、ここでは読まない（サーバーでの検証と、評価のときに、そのまま送る）。
 */
export function ResumeInput({
  initial,
  onSelectFile,
  onSelectText,
  onClear,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  disabled = false,
}: ResumeInputProps) {
  const [tab, setTab] = useState<'file' | 'text'>(initial?.kind === 'text' ? 'text' : 'file')
  const [text, setText] = useState(initial?.kind === 'text' ? initial.text : '')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 画面を離れるとき、待っている確認を取り消す
  useEffect(
    () => () => {
      clearTimeout(timer.current)
    },
    [],
  )

  const changeText = (next: string) => {
    setText(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (next.trim() === '') onClear()
      else onSelectText(next)
    }, debounceMs)
  }

  return (
    <Tabs
      activeKey={tab}
      onChange={(key) => {
        setTab(key === 'text' ? 'text' : 'file')
      }}
      items={[
        {
          key: 'file',
          label: 'ファイルを選ぶ',
          children: (
            <Upload.Dragger
              multiple={false}
              maxCount={1}
              showUploadList={false}
              disabled={disabled}
              // アップロードはしない。選んだファイルを、画面の状態に持つだけ
              beforeUpload={(file) => {
                onSelectFile(file)
                return false
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">ここにファイルをドラッグ、またはクリックして選ぶ</p>
              <Typography.Text type="secondary">
                PDF、Word（docx）、Excel（xlsx・xls）、PowerPoint（pptx）、テキストに対応しています。
                スキャン画像の PDF も読み取れます。
              </Typography.Text>
            </Upload.Dragger>
          ),
        },
        {
          key: 'text',
          label: 'テキストを貼り付ける',
          children: (
            <Input.TextArea
              aria-label="職歴書のテキスト"
              rows={12}
              value={text}
              disabled={disabled}
              placeholder="職歴書の内容を、ここに貼り付けてください"
              onChange={(event) => {
                changeText(event.target.value)
              }}
            />
          ),
        },
      ]}
    />
  )
}
