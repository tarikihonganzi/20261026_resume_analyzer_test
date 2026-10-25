import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeResult } from '../test/fixtures'
import { server } from '../test/server'
import { ApiError } from './client'
import { streamEvaluation, type EvaluationEvent, type EvaluationInput } from './sse'
import type { Condition } from './types'

const condition: Condition = {
  id: 'q1',
  label: '1級建築施工管理技士',
  kind: 'boolean',
  required: true,
  min_value: null,
  unit: null,
  source: 'preset',
  category: '資格・認定',
  description: null,
}
const input: EvaluationInput = {
  conditions: [condition],
  resume: { kind: 'text', text: '職歴の本文です。' },
}

const result = makeResult({ score: 80 })

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const encoder = new TextEncoder()

/** バイト列を、指定した位置で区切って、チャンクとして流す（日本語の文字の途中でも区切れる）。 */
function streamOfBytes(bytes: Uint8Array, splits: number[]): ReadableStream<Uint8Array> {
  const points = [0, ...splits, bytes.length]
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < points.length - 1; i++) {
        controller.enqueue(bytes.slice(points[i], points[i + 1]))
      }
      controller.close()
    },
  })
}

function respondWith(body: ReadableStream<Uint8Array> | string, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } }),
    )
}

async function collect(
  signal: AbortSignal = new AbortController().signal,
): Promise<EvaluationEvent[]> {
  const events: EvaluationEvent[] = []
  for await (const event of streamEvaluation(input, signal)) events.push(event)
  return events
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('streamEvaluation', () => {
  it('進捗（2 段階）と結果を、順に返す', async () => {
    respondWith(
      sse('stage', { stage: 'extracting' }) +
        sse('stage', { stage: 'scoring' }) +
        sse('result', result),
    )

    const events = await collect()

    expect(events.map((e) => e.event)).toEqual(['stage', 'stage', 'result'])
    expect(events[0]).toEqual({ event: 'stage', data: { stage: 'extracting' } })
    expect(events[2]).toMatchObject({ event: 'result', data: { score: 80 } })
  })

  it('チャンクの区切りが、イベントや日本語の文字の途中でも、正しく読む', async () => {
    const text =
      sse('stage', { stage: 'extracting' }) + sse('result', { ...result, memo: '日本語の根拠' })
    const bytes = encoder.encode(text)
    // 3 バイトずつ区切る（UTF-8 の日本語は 3 バイトなので、文字の途中でも区切れる）
    const splits = Array.from({ length: Math.floor(bytes.length / 3) }, (_, i) => (i + 1) * 3 - 1)
    respondWith(streamOfBytes(bytes, splits))

    const events = await collect()

    expect(events.map((e) => e.event)).toEqual(['stage', 'result'])
    expect(events[1]).toMatchObject({ data: { memo: '日本語の根拠' } })
  })

  it('エラーのイベントを返す', async () => {
    respondWith(
      sse('stage', { stage: 'extracting' }) +
        sse('error', { code: 'llm_unavailable', message: '混み合っています' }),
    )

    const events = await collect()

    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { code: 'llm_unavailable', message: '混み合っています' },
    })
  })

  it('結果・エラーを受け取ったら、そこで終わる（後ろのイベントは読まない）', async () => {
    respondWith(sse('result', result) + sse('stage', { stage: 'extracting' }))

    expect((await collect()).map((e) => e.event)).toEqual(['result'])
  })

  it('コメント（keep-alive）と、知らないイベントは、無視する', async () => {
    respondWith(
      ': keep-alive\n\n' +
        sse('future-event', { x: 1 }) +
        sse('stage', { stage: 'scoring' }) +
        sse('result', result),
    )

    expect((await collect()).map((e) => e.event)).toEqual(['stage', 'result'])
  })

  it('結果もエラーも来ないまま終わったら、「途中で終わった」エラーにする', async () => {
    respondWith(sse('stage', { stage: 'extracting' }))

    await expect(collect()).rejects.toMatchObject({ code: 'stream_ended' })
  })

  it('JSON でないデータや、想定外の形は、エラーにする', async () => {
    respondWith('event: result\ndata: これは JSON ではない\n\n')
    await expect(collect()).rejects.toMatchObject({ code: 'invalid_stream' })

    respondWith(sse('stage', { stage: 'unknown-stage' }))
    await expect(collect()).rejects.toMatchObject({ code: 'invalid_stream' })

    respondWith(sse('result', { nothing: true }))
    await expect(collect()).rejects.toMatchObject({ code: 'invalid_stream' })

    // 骨組みが足りない結果（概要がない）も、画面を壊さないよう、エラーにする
    respondWith(sse('result', { ...result, summary: undefined }))
    await expect(collect()).rejects.toMatchObject({ code: 'invalid_stream' })

    respondWith(sse('error', { code: 1 }))
    await expect(collect()).rejects.toMatchObject({ code: 'invalid_stream' })
  })

  it('条件を JSON で、テキストを text として、multipart で送る', async () => {
    const spy = respondWith(sse('result', result))

    await collect()

    const init = spy.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    const form = init?.body as FormData
    expect(JSON.parse(form.get('conditions') as string)).toEqual([condition])
    expect(form.get('text')).toBe('職歴の本文です。')
    expect(form.has('files')).toBe(false)
  })

  it('ファイルは、元のファイル名つきで送る', async () => {
    const spy = respondWith(sse('result', result))
    const file = new File(['x'], '田中_職務経歴書.pdf')

    const events: EvaluationEvent[] = []
    for await (const event of streamEvaluation(
      { conditions: [condition], resume: { kind: 'file', file } },
      new AbortController().signal,
    )) {
      events.push(event)
    }
    expect(events).toHaveLength(1)

    const form = spy.mock.calls[0]?.[1]?.body as FormData
    expect((form.get('files') as File).name).toBe('田中_職務経歴書.pdf')
    expect(form.has('text')).toBe(false)
  })

  it('ストリームが始まる前のエラー（422・413）は、サーバーのメッセージつきの ApiError にする', async () => {
    server.use(
      http.post('*/api/evaluations', () =>
        HttpResponse.json(
          { code: 'file_too_large', message: 'ファイルサイズが上限（1 MB）を超えています。' },
          { status: 413 },
        ),
      ),
    )

    const error = await collect().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 413,
      code: 'file_too_large',
      message: 'ファイルサイズが上限（1 MB）を超えています。',
    })
  })

  it('取り消すと、AbortError で止まり、接続を閉じる', async () => {
    let cancelled = false
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode(sse('stage', { stage: 'extracting' })))
        // 続きは来ない（評価中）
      },
      cancel() {
        cancelled = true
      },
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      init?.signal?.addEventListener('abort', () => {
        // 本物の fetch と同じく、取り消すと、読み取り中のストリームが AbortError で失敗する
      })
      return Promise.resolve(
        new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
      )
    })

    const iterator = streamEvaluation(input, controller.signal)
    const first = await iterator.next()
    expect(first.value).toEqual({ event: 'stage', data: { stage: 'extracting' } })
    await iterator.return(undefined) // 呼び出し側が、読むのをやめる

    expect(cancelled).toBe(true)
  })

  it('接続を始める前に取り消されていたら、AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('aborted', 'AbortError'))

    await expect(collect(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
