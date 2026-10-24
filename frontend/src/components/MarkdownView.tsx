import { Typography } from 'antd'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { sanitizeSchema } from '../lib/markdown'

/**
 * LLM が書いた Markdown（太字・箇条書き・表・`<u>` の下線など）を描画する（仕様 5.5）。
 *
 * 順序が重要: `rehype-raw` が、Markdown に混ざった HTML を解釈し、そのあとに `rehype-sanitize` が、
 * 許可していないタグ・属性・URL（`<script>`・`onerror`・`javascript:` など）を取り除く。
 */
export function MarkdownView({ children }: { children: string }) {
  return (
    <Typography>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          // 外部のリンクは、新しいタブで開き、元の画面への参照を渡さない
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </Typography>
  )
}
