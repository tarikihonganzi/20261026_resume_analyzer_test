import type { ThemeConfig } from 'antd'

/**
 * Ant Design の既定の「薄い文字」（黒の 45%）は、背景（#f5f5f5）の上でコントラストが 3.3:1 で、
 * WCAG 2.1 AA の基準（4.5:1）を満たさない。注意書き・補足・プレースホルダー・主色（青）を、
 * 基準を満たす濃さにする（背景が白でも #f5f5f5 でも 4.5:1 以上）。E2E の axe の検査で確かめる。
 */
export const theme: ThemeConfig = {
  token: {
    // 既定の青（#1677ff）は、白い文字とのコントラストが 4.1:1 で、基準に届かない（ボタン・リンクの文字）
    colorPrimary: '#0958d9',
    colorLink: '#0958d9',
    colorTextTertiary: '#636363',
    colorTextDescription: '#636363',
    colorTextPlaceholder: '#636363',
  },
}
