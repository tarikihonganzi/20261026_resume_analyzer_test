export type MarkKind = 'clear' | 'unmet' | 'unknown'

// 判定を示す記号。日本で一般的な ○ × △ にする（チェックマークは、一般的でない）。
// 色は控えめにし、色だけに頼らず、記号と名前（読み上げ用）でも判別できるようにする
const MARKS: Record<MarkKind, { glyph: string; label: string; color: string }> = {
  clear: { glyph: '○', label: 'クリア', color: '#237804' },
  unmet: { glyph: '×', label: 'NG', color: '#cf1322' },
  unknown: { glyph: '△', label: '不明', color: '#595959' },
}

/** 判定の記号（○ クリア、× NG、△ 不明）。「未達」という言葉は、画面に出さない。 */
export function ResultMark({ kind }: { kind: MarkKind }) {
  const mark = MARKS[kind]
  return (
    <span
      role="img"
      aria-label={mark.label}
      style={{
        color: mark.color,
        fontWeight: 700,
        fontSize: '1.15em',
        display: 'inline-block',
        minWidth: '1.2em',
        textAlign: 'center',
      }}
    >
      {mark.glyph}
    </span>
  )
}
