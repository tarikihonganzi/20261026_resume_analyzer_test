/**
 * 一覧に出すファイル名。改行・タブなどは空白にして、連続する空白は 1 つにまとめ、1 行で出す。
 * ゼロ幅文字や、表示を偽装できる方向制御の文字は、取り除く。長さは、画面側で省略する（CSS）。
 */
export function displayName(name: string): string {
  const cleaned = name
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .trim()
  return cleaned === '' ? '名称未設定' : cleaned
}
