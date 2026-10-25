import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { api, ApiError } from './client'

describe('api client', () => {
  it('プリセットの一覧を取り出す', async () => {
    server.use(
      http.get('*/api/catalog', () =>
        HttpResponse.json({
          items: [{ id: 'a', label: 'A', kind: 'boolean', unit: null, category: '資格' }],
        }),
      ),
    )

    expect(await api.catalog()).toEqual([
      { id: 'a', label: 'A', kind: 'boolean', unit: null, category: '資格' },
    ])
  })

  it('サーバーのエラー（code・message・fields）を ApiError にする', async () => {
    server.use(
      http.post('*/api/condition-sets', () =>
        HttpResponse.json(
          { code: 'invalid_request', message: '入力内容が正しくありません。', fields: ['name'] },
          { status: 422 },
        ),
      ),
    )

    const error = await api
      .createConditionSet({ name: '', conditions: [] })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      code: 'invalid_request',
      message: '入力内容が正しくありません。',
      fields: ['name'],
    })
  })

  it('JSON でない応答は、汎用のメッセージにする', async () => {
    server.use(http.get('*/api/settings', () => new HttpResponse('Bad Gateway', { status: 502 })))

    await expect(api.settings()).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_response',
    })
  })

  it('接続できないときは、アプリが起動しているかの確認を促す', async () => {
    server.use(http.get('*/api/settings', () => HttpResponse.error()))

    await expect(api.settings()).rejects.toMatchObject({ status: 0, code: 'network' })
  })

  it('条件セットの削除は、本文のない応答（204）を受け取れる', async () => {
    server.use(
      http.delete('*/api/condition-sets/:id', () => new HttpResponse(null, { status: 204 })),
    )

    await expect(api.deleteConditionSet('x y')).resolves.toBeUndefined()
  })

  it('条件セットの id は、URL として安全な形にして送る', async () => {
    let requested = ''
    server.use(
      http.delete('*/api/condition-sets/:id', ({ request }) => {
        requested = new URL(request.url).pathname
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await api.deleteConditionSet('a/b c')

    expect(requested).toBe('/api/condition-sets/a%2Fb%20c')
  })

  it('職歴書の検証は、ファイルをファイル名つきで multipart として送る', async () => {
    // jsdom の FormData は、Node の fetch では送れない（本物のブラウザでは問題ない）ので、fetch の呼び出しを調べる
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ format: 'txt', source_name: '経歴.txt', char_count: 3 }))

    const result = await api.checkResume({ file: new File(['abc'], '経歴.txt') })

    expect(result.source_name).toBe('経歴.txt')
    const init = fetchSpy.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    const sent = init?.body as FormData
    expect((sent.get('file') as File).name).toBe('経歴.txt')
    expect(sent.has('text')).toBe(false)
    fetchSpy.mockRestore()
  })

  it('貼り付けテキストは、text として送る', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ format: 'text', source_name: '貼り付けテキスト', char_count: 5 }),
      )

    await api.checkResume({ text: 'こんにちは世界' })

    const sent = fetchSpy.mock.calls[0]?.[1]?.body as FormData
    expect(sent.get('text')).toBe('こんにちは世界')
    expect(sent.has('file')).toBe(false)
    fetchSpy.mockRestore()
  })
})

describe('サーバーのエラーの形が、想定と違うとき', () => {
  it('code・message が文字列でなければ、汎用のメッセージにして、HTTP の番号を添える', async () => {
    server.use(
      http.get('*/api/catalog', () =>
        HttpResponse.json({ code: 5, message: null }, { status: 502 }),
      ),
    )

    await expect(api.catalog()).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_response',
      message: expect.stringContaining('HTTP 502') as string,
    })
  })

  it('fields が配列でなければ、空として扱う', async () => {
    server.use(
      http.get('*/api/catalog', () =>
        HttpResponse.json(
          { code: 'invalid_request', message: '入力が正しくありません', fields: 'x' },
          { status: 422 },
        ),
      ),
    )

    await expect(api.catalog()).rejects.toMatchObject({ code: 'invalid_request', fields: [] })
  })
})
