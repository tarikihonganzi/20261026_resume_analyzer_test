import { DeleteOutlined, FileTextOutlined } from '@ant-design/icons'
import { Button, Flex, Spin, Typography } from 'antd'
import { useEffect } from 'react'
import { api } from '../api/client'
import { displayName } from '../lib/displayName'
import { isAbort, toFlowError } from '../state/errors'
import { MAX_RESUMES, resumesStatus, type ResumeItem } from '../state/flow'
import { useFlow } from '../state/flow-context'

/**
 * 書類を選んだ直後に、サーバーで検証する（仕様 5.3、6.1）。
 *
 * 結果は、書類ごとの ID つきで、状態へ送る。削除したあとや、選び直したあとに、前の結果が届いても、
 * リデューサーが無視する。一覧から消える（削除・画面を離れる）と要求を取り消すが、検証中のままなので、
 * 戻ってくれば、もう一度確認する。
 */
function useItemCheck(item: ResumeItem): void {
  const { dispatch } = useFlow()
  const { id, source } = item
  const checking = item.check.status === 'checking'

  useEffect(() => {
    if (!checking) return
    const controller = new AbortController()
    const input = source.kind === 'file' ? { file: source.file } : { text: source.text }
    api
      .checkResume(input, controller.signal)
      .then((check) => {
        dispatch({ type: 'resumeChecked', check, id })
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        dispatch({ type: 'resumeCheckFailed', error: toFlowError(error), id })
      })
    return () => {
      controller.abort()
    }
  }, [checking, id, source, dispatch])
}

function ResumeRow({ item, onRemove }: { item: ResumeItem; onRemove: (id: number) => void }) {
  useItemCheck(item)
  const name = displayName(item.name)

  return (
    <li
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <Flex align="center" gap={12}>
        <FileTextOutlined aria-hidden />
        {/* 長い名前は、1 行に省略する（全文は、ホバーで出す） */}
        <Typography.Text ellipsis={{ tooltip: name }} style={{ flex: 1, minWidth: 0 }}>
          {name}
        </Typography.Text>
        {item.check.status === 'checking' ? (
          <Flex align="center" gap={8}>
            <Spin size="small" />
            <Typography.Text type="secondary">確認中…</Typography.Text>
          </Flex>
        ) : null}
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          aria-label={`${name}を削除`}
          onClick={() => {
            onRemove(item.id)
          }}
        />
      </Flex>
      {item.check.status === 'error' ? (
        <Typography.Paragraph
          type="danger"
          style={{ margin: '4px 0 0 28px', fontSize: 13 }}
          role="alert"
        >
          使えません: {item.check.error.message}
        </Typography.Paragraph>
      ) : null}
    </li>
  )
}

interface ResumeListProps {
  items: readonly ResumeItem[]
  onRemove: (id: number) => void
}

/** アップロード済みの職歴書の一覧と、削除ボタン（仕様 5.3、6.1）。形式や文字数は出さない。 */
export function ResumeList({ items, onRemove }: ResumeListProps) {
  const { state } = useFlow()
  const status = resumesStatus(state)
  if (items.length === 0) return null

  return (
    <section aria-label="アップロード済みの職歴書">
      <Typography.Text strong>
        アップロード済みの職歴書（{items.length} / {MAX_RESUMES}）
      </Typography.Text>
      <ul
        style={{
          margin: '8px 0 0',
          padding: 0,
          listStyle: 'none',
          border: '1px solid #f0f0f0',
          borderBottom: 'none',
          borderRadius: 6,
        }}
      >
        {items.map((item) => (
          <ResumeRow key={item.id} item={item} onRemove={onRemove} />
        ))}
      </ul>
      <div aria-live="polite" style={{ marginTop: 8, minHeight: 22 }}>
        {status === 'ok' ? (
          <Typography.Text type="secondary">
            {items.length} 件の職歴書を評価に使えます
          </Typography.Text>
        ) : null}
        {status === 'error' ? (
          <Typography.Text type="secondary">
            使えない職歴書を削除すると、評価できます（条件の入力は、そのまま残っています）
          </Typography.Text>
        ) : null}
      </div>
    </section>
  )
}
