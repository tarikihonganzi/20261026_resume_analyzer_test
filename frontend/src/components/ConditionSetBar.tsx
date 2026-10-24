import { DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Flex, Form, Input, Modal, Popconfirm, Select, Typography, message } from 'antd'
import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { queryKeys, useConditionSets } from '../api/hooks'
import type { Condition, ConditionSet } from '../api/types'

interface ConditionSetBarProps {
  /** いま画面で選んでいる条件（保存する内容）。 */
  conditions: Condition[]
  /** 保存できる状態か（条件が 1 件以上あり、number の最低値がそろっている）。 */
  canSave: boolean
  /** 保存済みのセットを読み込む。 */
  onLoad: (conditions: Condition[]) => void
}

const MAX_NAME_LENGTH = 100

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '予期しないエラーが起きました。'
}

/** 条件セットの保存・読込・上書き・削除（仕様 5.2）。 */
export function ConditionSetBar({ conditions, canSave, onLoad }: ConditionSetBarProps) {
  const sets = useConditionSets()
  const queryClient = useQueryClient()
  const [messageApi, contextHolder] = message.useMessage()
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [name, setName] = useState('')

  const loaded: ConditionSet | undefined = sets.data?.find((s) => s.id === loadedId)

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.conditionSets })

  const create = useMutation({
    mutationFn: (setName: string) => api.createConditionSet({ name: setName, conditions }),
    onSuccess: async (saved) => {
      await refresh()
      setLoadedId(saved.id)
      setSaveAsOpen(false)
      void messageApi.success(`「${saved.name}」を保存しました`)
    },
    onError: (error) => {
      void messageApi.error(errorText(error))
    },
  })

  const overwrite = useMutation({
    mutationFn: (target: ConditionSet) =>
      api.updateConditionSet(target.id, { name: target.name, conditions }),
    onSuccess: async (saved) => {
      await refresh()
      void messageApi.success(`「${saved.name}」を上書き保存しました`)
    },
    onError: (error) => {
      void messageApi.error(errorText(error))
    },
  })

  const remove = useMutation({
    mutationFn: (target: ConditionSet) => api.deleteConditionSet(target.id),
    onSuccess: async (_, target) => {
      await refresh()
      setLoadedId(null)
      void messageApi.success(`「${target.name}」を削除しました`)
    },
    onError: (error) => {
      void messageApi.error(errorText(error))
    },
  })

  return (
    <Flex align="center" gap={8} wrap style={{ marginBottom: 16 }}>
      {contextHolder}
      <Typography.Text strong>条件セット</Typography.Text>
      <Select
        aria-label="保存済みの条件セット"
        placeholder={
          sets.data?.length === 0 ? '保存済みのセットはありません' : '保存済みから読み込む'
        }
        style={{ minWidth: 240 }}
        loading={sets.isPending}
        disabled={sets.isError || sets.data?.length === 0}
        value={loadedId}
        options={(sets.data ?? []).map((s) => ({ label: s.name, value: s.id }))}
        onChange={(id: string) => {
          const selected = sets.data?.find((s) => s.id === id)
          if (!selected) return
          setLoadedId(id)
          onLoad(selected.conditions)
        }}
      />
      <Button
        icon={<SaveOutlined />}
        disabled={!canSave}
        onClick={() => {
          setName(loaded?.name ?? '')
          setSaveAsOpen(true)
        }}
      >
        名前を付けて保存
      </Button>
      {loaded ? (
        <>
          <Popconfirm
            title={`「${loaded.name}」を、いまの条件で上書きしますか？`}
            okText="上書き"
            cancelText="キャンセル"
            disabled={!canSave}
            onConfirm={() => {
              overwrite.mutate(loaded)
            }}
          >
            <Button disabled={!canSave} loading={overwrite.isPending}>
              上書き保存
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`「${loaded.name}」を削除しますか？`}
            okText="削除"
            cancelText="キャンセル"
            onConfirm={() => {
              remove.mutate(loaded)
            }}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={remove.isPending}
              aria-label="条件セットを削除"
            >
              削除
            </Button>
          </Popconfirm>
        </>
      ) : null}
      {sets.isError ? (
        <Typography.Text type="danger">{errorText(sets.error)}</Typography.Text>
      ) : null}
      <Modal
        open={saveAsOpen}
        title="条件セットに名前を付けて保存"
        okText="保存"
        cancelText="キャンセル"
        okButtonProps={{ disabled: name.trim() === '', loading: create.isPending }}
        onOk={() => {
          create.mutate(name.trim())
        }}
        onCancel={() => {
          setSaveAsOpen(false)
        }}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="セットの名前">
            <Input
              autoFocus
              maxLength={MAX_NAME_LENGTH}
              placeholder="例: 現場監督（中途）"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              onPressEnter={() => {
                if (name.trim() !== '') create.mutate(name.trim())
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  )
}
