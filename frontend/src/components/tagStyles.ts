import type { CSSProperties } from 'react'

/**
 * 状態を示すタグの色。Ant Design のプリセットの色（`color="success"` など）は、淡い背景の上の文字が
 * コントラスト 2〜3:1 で、WCAG 2.1 AA の基準（4.5:1）を満たさない。文字を濃くした組み合わせにする。
 * 色だけで意味を伝えないよう、使う側で、文字やアイコンも添える。
 */
export const TAG_STYLES = {
  success: { color: '#135200', background: '#f6ffed', borderColor: '#b7eb8f' },
  error: { color: '#a8071a', background: '#fff1f0', borderColor: '#ffa39e' },
  warning: { color: '#873800', background: '#fff7e6', borderColor: '#ffd591' },
  info: { color: '#003eb3', background: '#e6f4ff', borderColor: '#91caff' },
  custom: { color: '#391085', background: '#f9f0ff', borderColor: '#d3adf7' },
  neutral: { color: '#434343', background: '#fafafa', borderColor: '#d9d9d9' },
} satisfies Record<string, CSSProperties>
