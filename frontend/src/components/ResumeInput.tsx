import { InboxOutlined } from '@ant-design/icons'
import { Input, Tabs, Typography, Upload } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { MAX_RESUMES } from '../state/flow'

interface ResumeInputProps {
  /** いま一覧にある書類の数（ファイル・貼り付けテキストの合計）。 */
  count: number
  /** いま貼り付けテキストが書類になっていれば、そのテキスト（タブの初期位置と、復元に使う）。 */
  pastedText: string | null
  onSelectFile: (file: File) => void
  onSelectText: (text: string) => void
  /** 貼り付けテキストを、全部消したとき。 */
  onClearText: () => void
  /** 上限（5 件）を超えるので、追加できなかったとき。 */
  onLimit: () => void
  /** 貼り付けテキストを、入力が止まってから確認するまでの待ち時間。 */
  debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 700

/**
 * 職歴書の入力（仕様 5.3）。ファイル（複数）のドラッグ＆ドロップ、またはテキストの貼り付け。
 * ファイルの内容は、ここでは読まない（サーバーでの検証と、評価のときに、そのまま送る）。
 */
export function ResumeInput({
  count,
  pastedText,
  onSelectFile,
  onSelectText,
  onClearText,
  onLimit,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: ResumeInputProps) {
  const [tab, setTab] = useState<'file' | 'text'>(pastedText === null ? 'file' : 'text')
  const [text, setText] = useState(pastedText ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 一覧から貼り付けテキストを削除したら、入力欄も空にする（画面と状態を、ずらさない）
  const [shownPastedText, setShownPastedText] = useState(pastedText)
  if (shownPastedText !== pastedText) {
    setShownPastedText(pastedText)
    if (pastedText === null) setText('')
  }

  const remaining = MAX_RESUMES - count
  const full = remaining <= 0

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
      if (next.trim() === '') onClearText()
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
              multiple
              showUploadList={false}
              disabled={full}
              // アップロードはしない。選んだファイルを、画面の状態に持つだけ
              beforeUpload={(file, fileList) => {
                const index = fileList.indexOf(file)
                if (index >= remaining) {
                  // 上限を超える分は追加しない。まとめて選んだときも、知らせるのは 1 回だけ
                  if (index === Math.max(remaining, 0)) onLimit()
                  return false
                }
                onSelectFile(file)
                return false
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">
                {full
                  ? `書類は、最大 ${String(MAX_RESUMES)} 件までです（削除すると、追加できます）`
                  : 'ここにファイルをドラッグ、またはクリックして選ぶ（複数可）'}
              </p>
              <Typography.Text type="secondary">
                PDF、Word（docx）、Excel（xlsx・xls）、PowerPoint（pptx）、テキストに対応しています。
                スキャン画像の PDF も読み取れます。同じ応募者の書類を、合わせて {MAX_RESUMES}{' '}
                件まで選べます。
              </Typography.Text>
            </Upload.Dragger>
          ),
        },
        {
          key: 'text',
          label: 'テキストを貼り付ける',
          children: (
            <Input.TextArea
              aria-label="書類のテキスト"
              rows={12}
              value={text}
              disabled={full && pastedText === null}
              placeholder="書類の内容を、ここに貼り付けてください"
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
