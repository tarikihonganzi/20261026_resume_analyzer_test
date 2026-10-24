import type {
  CatalogItem,
  ConditionSet,
  ConditionSetInput,
  ConnectionTestRequest,
  ConnectionTestResponse,
  ResumeCheck,
  SettingsUpdate,
  SettingsView,
} from './types'

/** API のエラー。`message` は、サーバーが返した、そのまま表示できる日本語。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: string[]

  constructor(status: number, code: string, message: string, fields: string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

function absolute(path: string): string {
  return new URL(path, window.location.href).toString()
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown; fields?: unknown }
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      const fields = Array.isArray(body.fields) ? body.fields.map(String) : []
      return new ApiError(response.status, body.code, body.message, fields)
    }
  } catch {
    // JSON でない応答（プロキシのエラーなど）は、下の汎用のメッセージにする
  }
  return new ApiError(
    response.status,
    'unexpected_response',
    `サーバーからの応答を読み取れませんでした（HTTP ${String(response.status)}）。`,
  )
}

/** ストリームの前に失敗した応答を、`ApiError` にする（SSE のクライアントも使う）。 */
export async function fetchOrThrow(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(absolute(path), init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(
      0,
      'network',
      'サーバーに接続できませんでした。アプリが起動しているかを確認してください。',
    )
  }
  if (!response.ok) throw await toApiError(response)
  return response
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchOrThrow(path, init)
  return (await response.json()) as T
}

function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  catalog: async (): Promise<CatalogItem[]> =>
    (await requestJson<{ items: CatalogItem[] }>('/api/catalog')).items,

  conditionSets: async (): Promise<ConditionSet[]> =>
    (await requestJson<{ sets: ConditionSet[] }>('/api/condition-sets')).sets,
  createConditionSet: (input: ConditionSetInput) =>
    requestJson<ConditionSet>('/api/condition-sets', jsonBody('POST', input)),
  updateConditionSet: (id: string, input: ConditionSetInput) =>
    requestJson<ConditionSet>(
      `/api/condition-sets/${encodeURIComponent(id)}`,
      jsonBody('PUT', input),
    ),
  deleteConditionSet: async (id: string): Promise<void> => {
    await fetchOrThrow(`/api/condition-sets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  settings: () => requestJson<SettingsView>('/api/settings'),
  updateSettings: (update: SettingsUpdate) =>
    requestJson<SettingsView>('/api/settings', jsonBody('PUT', update)),
  testConnection: (request: ConnectionTestRequest) =>
    requestJson<ConnectionTestResponse>('/api/settings/test', jsonBody('POST', request)),

  /** 職歴書を、評価の前に検証する。`file` か `text` のどちらか 1 つ。 */
  checkResume: (input: { file: File } | { text: string }, signal?: AbortSignal) => {
    const form = new FormData()
    if ('file' in input) form.append('file', input.file, input.file.name)
    else form.append('text', input.text)
    return requestJson<ResumeCheck>('/api/resumes/check', {
      method: 'POST',
      body: form,
      signal,
    })
  },
}
