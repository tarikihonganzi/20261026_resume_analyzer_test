import type { ThemeConfig } from 'antd'

/**
 * Ant Design の既定の「薄い文字」（黒の 45%）は、背景（#f5f5f5）の上でコントラストが 3.3:1 で、
 * WCAG 2.1 AA の基準（4.5:1）を満たさない。注意書き・補足・プレースホルダー・主色（青）を、
 * 基準を満たす濃さにする（背景が白でも #f5f5f5 でも 4.5:1 以上）。E2E の axe の検査で確かめる。
 */
// カードの見出しは、背景に色のついた帯にする（何もない下地の上の文字では、見出しらしく見えないため）。
// 文字は、帯との色の差（コントラスト）が、基準を満たす濃い青にする
export const HEADER_BACKGROUND = '#e3eeff'
export const HEADER_TEXT_COLOR = '#0b2f6b'

export const theme: ThemeConfig = {
  components: {
    Card: { headerBg: HEADER_BACKGROUND, headerFontSize: 19, headerFontSizeSM: 17 },
  },
  token: {
    // 基本の文字の大きさ（既定は 14）。注釈や補足の小さい文字も、これに合わせて一回り大きくなる
    fontSize: 16,
    // 既定の青（#1677ff）は、白い文字とのコントラストが 4.1:1 で、基準に届かない（ボタン・リンクの文字）
    colorPrimary: '#0958d9',
    colorLink: '#0958d9',
    colorTextTertiary: '#636363',
    colorTextDescription: '#636363',
    colorTextPlaceholder: '#636363',
  },
}
