import { describe, expect, it } from 'vitest'
import { HEADER_BACKGROUND, HEADER_TEXT_COLOR, theme } from './theme'

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

describe('theme', () => {
  it('基本の文字の大きさは 16px（既定の 14px より、一回り大きい）', () => {
    expect(theme.token?.fontSize).toBe(16)
  })

  it('カードの見出しは、背景色のついた帯で、文字との色の差が基準（4.5:1）を満たす', () => {
    expect(theme.components?.Card?.headerBg).toBe(HEADER_BACKGROUND)
    expect(contrast(HEADER_BACKGROUND, HEADER_TEXT_COLOR)).toBeGreaterThanOrEqual(4.5)
  })
})
