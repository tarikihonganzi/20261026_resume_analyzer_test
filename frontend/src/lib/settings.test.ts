import { describe, expect, it } from 'vitest'
import type { SettingsView } from '../api/types'
import { buildSettingsUpdate, initialFormValues, isValidBaseUrl } from './settings'

const saved: SettingsView = {
  openai_api_key_masked: '****1234',
  openai_base_url: 'https://llm.example.invalid/v1',
  model: 'gpt-5.5',
  max_file_size_mb: 20,
}

describe('buildSettingsUpdate', () => {
  it('何も変えていなければ、null（保存するものがない）', () => {
    expect(buildSettingsUpdate(initialFormValues(saved), saved)).toBeNull()
  })

  it('変えた項目だけを返す', () => {
    const values = { ...initialFormValues(saved), model: 'gpt-5.6', maxFileSizeMb: 0 }

    expect(buildSettingsUpdate(values, saved)).toEqual({ model: 'gpt-5.6', max_file_size_mb: 0 })
  })

  it('API キーは、入力があるときだけ送る（前後の空白は除く）', () => {
    const values = { ...initialFormValues(saved), apiKey: '  sk-new-key  ' }

    expect(buildSettingsUpdate(values, saved)).toEqual({ openai_api_key: 'sk-new-key' })
  })

  it('API キーが空白だけなら、入力なしとして扱う', () => {
    const values = { ...initialFormValues(saved), apiKey: '   ' }

    expect(buildSettingsUpdate(values, saved)).toBeNull()
  })

  it('ベース URL を空にすると、「SDK の既定に戻す」変更として、空文字を送る', () => {
    const values = { ...initialFormValues(saved), baseUrl: '' }

    expect(buildSettingsUpdate(values, saved)).toEqual({ openai_base_url: '' })
  })

  it('空白を除いた値で比べる（空白だけの違いは、変更ではない）', () => {
    const values = {
      ...initialFormValues(saved),
      baseUrl: ` ${saved.openai_base_url} `,
      model: ' gpt-5.5 ',
    }

    expect(buildSettingsUpdate(values, saved)).toBeNull()
  })

  it('最大ファイルサイズが未入力（null）なら、その項目は送らない', () => {
    const values = { ...initialFormValues(saved), maxFileSizeMb: null }

    expect(buildSettingsUpdate(values, saved)).toBeNull()
  })
})

describe('isValidBaseUrl', () => {
  it.each(['', '   ', 'https://llm.example.invalid/v1', 'http://localhost:8080'])(
    '%j は正しい',
    (value) => {
      expect(isValidBaseUrl(value)).toBe(true)
    },
  )

  it.each(['llm.example.invalid', 'ftp://example.invalid', 'javascript:alert(1)', 'https://'])(
    '%j は正しくない',
    (value) => {
      expect(isValidBaseUrl(value)).toBe(false)
    },
  )
})
