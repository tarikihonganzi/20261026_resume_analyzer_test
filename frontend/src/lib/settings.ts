import type { SettingsUpdate, SettingsView } from '../api/types'

/** 設定ページの入力欄の値。API キーは、変更するときだけ入力する（保存済みの値は画面に出さない）。 */
export interface SettingsFormValues {
  apiKey: string
  baseUrl: string
  model: string
  maxFileSizeMb: number | null
}

export function initialFormValues(saved: SettingsView): SettingsFormValues {
  return {
    apiKey: '',
    baseUrl: saved.openai_base_url,
    model: saved.model,
    maxFileSizeMb: saved.max_file_size_mb,
  }
}

/**
 * 保存済みの設定と比べて、変わった項目だけを、更新のリクエストにする。変わりがなければ null。
 *
 * API キーは、入力があるときだけ送る（空のままなら、サーバーが保存済みの値を残す）。
 */
export function buildSettingsUpdate(
  values: SettingsFormValues,
  saved: SettingsView,
): SettingsUpdate | null {
  const update: SettingsUpdate = {}
  const apiKey = values.apiKey.trim()
  if (apiKey !== '') update.openai_api_key = apiKey
  const baseUrl = values.baseUrl.trim()
  if (baseUrl !== saved.openai_base_url) update.openai_base_url = baseUrl
  const model = values.model.trim()
  if (model !== saved.model) update.model = model
  if (values.maxFileSizeMb !== null && values.maxFileSizeMb !== saved.max_file_size_mb) {
    update.max_file_size_mb = values.maxFileSizeMb
  }
  return Object.keys(update).length === 0 ? null : update
}

/** ベース URL の入力が正しいか。空は、SDK の既定を使うので、正しい。 */
export function isValidBaseUrl(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
