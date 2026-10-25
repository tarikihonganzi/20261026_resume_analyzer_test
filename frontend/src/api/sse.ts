import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { Condition, EvaluationResult, Stage, StreamError } from './types'
import { ApiError, fetchOrThrow } from './client'

/** `POST /api/evaluations` が流すイベント（仕様 7）。型は、OpenAPI から生成したもの。 */
export type EvaluationEvent =
  | { event: 'stage'; data: { stage: Stage } }
  | { event: 'result'; data: EvaluationResult }
  | { event: 'error'; data: StreamError }

export type ResumeSource = { kind: 'file'; file: File } | { kind: 'text'; text: string }

export type EvaluationInput = {
  conditions: Condition[]
  /** 1 人の応募者の書類（ファイルは複数、貼り付けテキストは最大 1 件。仕様 5.3）。 */
  resumes: readonly ResumeSource[]
}

// イベントの JSON が、想定した形かを、実行時に確かめる（サーバーとフロントの版が違っても、壊れない）
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// 画面が壊れないよう、結果の骨組み（数値・配列・概要）だけは、実行時に確かめる
function isResultShape(data: Record<string, unknown>): boolean {
  return (
    typeof data.score === 'number' &&
    typeof data.original_score === 'number' &&
    typeof data.match_rate === 'number' &&
    typeof data.clipped === 'boolean' &&
    Array.isArray(data.missing_required) &&
    Array.isArray(data.conditions) &&
    Array.isArray(data.strengths) &&
    Array.isArray(data.weaknesses) &&
    isRecord(data.summary)
  )
}

function parseEvent(name: string, raw: string): EvaluationEvent | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new ApiError(0, 'invalid_stream', '評価の結果を、正しく受け取れませんでした。')
  }
  if (!isRecord(data)) {
    throw new ApiError(0, 'invalid_stream', '評価の結果を、正しく受け取れませんでした。')
  }

  switch (name) {
    case 'stage':
      if (data.stage === 'extracting' || data.stage === 'scoring') {
        return { event: 'stage', data: { stage: data.stage } }
      }
      break
    case 'result':
      if (isResultShape(data)) {
        return { event: 'result', data: data as unknown as EvaluationResult }
      }
      break
    case 'error':
      if (typeof data.code === 'string' && typeof data.message === 'string') {
        return { event: 'error', data: { code: data.code, message: data.message } }
      }
      break
    default:
      // 知らないイベントは、無視する（将来、サーバーが新しいイベントを足しても壊れない）
      return null
  }
  throw new ApiError(0, 'invalid_stream', '評価の結果を、正しく受け取れませんでした。')
}

/**
 * 評価を実行し、進捗と結果を、イベントとして順に返す。
 *
 * - `EventSource` は POST を使えないので、`fetch` で読む。
 * - ストリームが始まる前の失敗（422・413 など）は、`ApiError` を投げる。
 * - `signal` を取り消すと、接続が切れ、サーバーは LLM の呼び出しを止める（キャンセル）。このとき
 *   `AbortError` を投げる。
 * - 結果・エラーのどちらも来ないまま、ストリームが終わったら、`ApiError`（`stream_ended`）を投げる。
 */
export async function* streamEvaluation(
  input: EvaluationInput,
  signal: AbortSignal,
): AsyncGenerator<EvaluationEvent> {
  const form = new FormData()
  form.append('conditions', JSON.stringify(input.conditions))
  for (const resume of input.resumes) {
    if (resume.kind === 'file') form.append('files', resume.file, resume.file.name)
    else form.append('text', resume.text)
  }

  const response = await fetchOrThrow('/api/evaluations', {
    method: 'POST',
    body: form,
    headers: { Accept: 'text/event-stream' },
    signal,
  })
  if (!response.body) {
    throw new ApiError(0, 'invalid_stream', 'サーバーからの応答を、読み取れませんでした。')
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onError: 'terminate' }))
    .getReader()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const event = parseEvent(value.event ?? 'message', value.data)
      if (event === null) continue
      yield event
      // 結果かエラーが来たら、評価は終わり
      if (event.event !== 'stage') return
    }
  } finally {
    // 途中でやめたとき（結果を受け取った、取り消した）は、接続を閉じる
    await reader.cancel().catch(() => undefined)
  }

  // ここに来るのは、結果もエラーも来ないまま、ストリームが閉じたとき
  throw new ApiError(0, 'stream_ended', '評価が途中で終わりました。もう一度お試しください。')
}
