import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeCondition, makeJudged, makeResult } from '../test/fixtures'
import { ResultView } from './ResultView'

function row(name: string) {
  const cell = screen.getByRole('cell', { name })
  const element = cell.closest('tr')
  if (!element) throw new Error(`${name} の行がありません`)
  return within(element)
}

describe('結果画面', () => {
  describe('スコア', () => {
    it('補正がないときは、スコアとマッチ度合いだけを示す', () => {
      render(<ResultView result={makeResult({ score: 72, match_rate: 70 })} />)

      expect(screen.getByText('最終スコア')).toBeInTheDocument()
      expect(screen.getByText('72')).toBeInTheDocument()
      expect(screen.getByText('70')).toBeInTheDocument()
      expect(screen.queryByText('補正あり')).not.toBeInTheDocument()
    })

    it('補正があったときは、元のスコアを併記する（仕様 5.5・受け入れ基準 5）', () => {
      render(
        <ResultView
          result={makeResult({ score: 72, original_score: 95, clipped: true, match_rate: 52 })}
        />,
      )

      expect(screen.getByText('補正あり')).toBeInTheDocument()
      expect(screen.getByText(/元のスコアは 95 点/)).toBeInTheDocument()
    })
  })

  describe('必須条件', () => {
    it('未達があれば、目立つアラートで条件名を列挙する（受け入れ基準 6）', () => {
      render(
        <ResultView
          result={makeResult({
            missing_required: [
              { condition_id: 'q1', label: '1級建築施工管理技士', status: 'unmet' },
              { condition_id: 'q2', label: '現場監督の経験年数', status: 'unknown' },
            ],
          })}
        />,
      )

      const alert = within(screen.getByRole('alert'))
      expect(alert.getByText(/満たしていない必須条件があります（2 件）/)).toBeInTheDocument()
      expect(alert.getByText('1級建築施工管理技士（未達）')).toBeInTheDocument()
      expect(
        alert.getByText('現場監督の経験年数（職歴書から確認できませんでした）'),
      ).toBeInTheDocument()
    })

    it('必須の条件があり、すべて達成なら「必須条件はすべて達成」', () => {
      render(
        <ResultView
          result={makeResult({
            conditions: [makeJudged({ condition: makeCondition({ required: true }) })],
          })}
        />,
      )

      expect(screen.getByText('必須条件はすべて達成')).toBeInTheDocument()
    })

    it('必須の条件が 1 つもなければ、「すべて達成」とは言わない', () => {
      render(<ResultView result={makeResult()} />)

      expect(screen.getByText('必須条件は設定されていません')).toBeInTheDocument()
      expect(screen.queryByText('必須条件はすべて達成')).not.toBeInTheDocument()
    })
  })

  describe('条件別の判定表', () => {
    const result = makeResult({
      conditions: [
        makeJudged({
          condition: makeCondition({ id: 'q1', label: '1級建築施工管理技士', required: true }),
          status: 'achieved',
          has_skill: true,
        }),
        makeJudged({
          condition: makeCondition({
            id: 'q2',
            label: '現場監督の経験年数',
            kind: 'number',
            unit: '年',
            min_value: 5,
          }),
          status: 'unmet',
          has_skill: null,
          years: 3.25,
        }),
        makeJudged({
          condition: makeCondition({ id: 'q3', label: 'Revit の経験' }),
          status: 'unknown',
          has_skill: null,
          reason: '',
          quotes: [],
        }),
      ],
    })

    it('条件名・必須／任意・判定・抽出値を表示する', () => {
      render(<ResultView result={result} />)

      const first = row('1級建築施工管理技士')
      expect(first.getByText('必須')).toBeInTheDocument()
      expect(first.getByText('達成')).toBeInTheDocument()
      expect(first.getByText('あり')).toBeInTheDocument()

      const second = row('現場監督の経験年数')
      expect(second.getByText('任意')).toBeInTheDocument()
      expect(second.getByText('未達')).toBeInTheDocument()
      expect(second.getByText('3.3年')).toBeInTheDocument()
      expect(second.getByText('必要: 5.0年以上')).toBeInTheDocument()

      const third = row('Revit の経験')
      expect(third.getByText('不明')).toBeInTheDocument()
      expect(third.getByText('—')).toBeInTheDocument()
    })

    it('根拠が何も出力されなかった条件は、その旨を示す', () => {
      render(<ResultView result={result} />)

      expect(row('Revit の経験').getByText('根拠が出力されませんでした')).toBeInTheDocument()
    })
  })

  describe('根拠と引用', () => {
    it('reason を示し、引用は「引用を見る」を押すまで隠す。展開すると、出典名と位置と原文を示す', async () => {
      render(<ResultView result={makeResult()} />)
      const table = within(screen.getByRole('table'))

      expect(table.getByText('職歴書.docx に資格の記載があります。')).toBeInTheDocument()
      expect(table.queryByText('1級建築施工管理技士 取得')).not.toBeInTheDocument()
      const toggle = table.getByRole('button', { name: '引用を見る（1）' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      await userEvent.click(toggle)

      expect(table.getByText('職歴書.docx（資格欄）')).toBeInTheDocument()
      expect(table.getByText('1級建築施工管理技士 取得')).toBeInTheDocument()
      expect(table.getByRole('button', { name: '引用を隠す' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })

    it('原文で確認できなかった引用には「原文で確認できず」、照合していない引用には「未照合」を付ける（受け入れ基準 15）', async () => {
      render(
        <ResultView
          result={makeResult({
            conditions: [
              makeJudged({
                quotes: [
                  {
                    source_name: '貼り付けテキスト',
                    location: null,
                    text: '存在しない文',
                    verified: 'not_found',
                  },
                  {
                    source_name: '職歴書.pdf',
                    location: null,
                    text: 'PDF の文',
                    verified: 'skipped',
                  },
                  {
                    source_name: '職歴書.docx',
                    location: null,
                    text: '確かにある文',
                    verified: 'match',
                  },
                ],
              }),
            ],
          })}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: '引用を見る（3）' }))

      expect(screen.getByText('原文で確認できず')).toBeInTheDocument()
      expect(screen.getByText('未照合')).toBeInTheDocument()
      const matched = screen.getByText('確かにある文').closest('li')
      expect(matched).not.toBeNull()
      expect(
        within(matched as HTMLElement).queryByText(/確認できず|未照合/),
      ).not.toBeInTheDocument()
    })

    it('引用は Markdown や HTML として解釈せず、そのままの文字で示す', async () => {
      const text = '**太字ではない** <script>alert(1)</script> <u>下線ではない</u>'
      render(
        <ResultView
          result={makeResult({
            conditions: [
              makeJudged({
                quotes: [{ source_name: '職歴書.docx', location: null, text, verified: 'match' }],
              }),
            ],
          })}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: '引用を見る（1）' }))

      const quote = screen.getByText(text)
      expect(quote.tagName).toBe('BLOCKQUOTE')
      expect(quote.querySelector('strong, script, u')).toBeNull()
    })
  })

  describe('概要・良かった点・悪かった点', () => {
    it('Markdown（太字・下線・箇条書き）を描画する（受け入れ基準 7）', () => {
      render(
        <ResultView
          result={makeResult({
            summary: {
              text: '**重要**な点です。<u>下線</u>\n\n- 項目 A\n- 項目 B',
              reason: '根拠の文',
              quotes: [],
            },
          })}
        />,
      )

      const summary = within(screen.getByText('評価の概要').closest('.ant-card') as HTMLElement)
      expect(summary.getByText('重要').tagName).toBe('STRONG')
      expect(summary.getByText('下線').tagName).toBe('U')
      expect(summary.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        '項目 A',
        '項目 B',
      ])
    })

    it('スクリプトや画像は描画しない', () => {
      const { container } = render(
        <ResultView
          result={makeResult({
            strengths: [
              {
                text: '良い<script>window.hacked=1</script><img src="https://example.invalid/x.png" onerror="window.hacked=1">',
                reason: '',
                quotes: [],
              },
            ],
          })}
        />,
      )

      expect(container.querySelector('script, img')).toBeNull()
    })

    it('項目ごとに根拠（reason）を示す（受け入れ基準 14）', () => {
      render(<ResultView result={makeResult()} />)

      const strengths = within(screen.getByText('良かった点').closest('.ant-card') as HTMLElement)
      expect(strengths.getByText('大規模現場の経験')).toBeInTheDocument()
      expect(strengths.getByText('職歴書.docx に記載があります。')).toBeInTheDocument()
      const weaknesses = within(screen.getByText('悪かった点').closest('.ant-card') as HTMLElement)
      expect(weaknesses.getByText('根拠が出力されませんでした')).toBeInTheDocument()
    })

    it('項目が 0 件なら、その旨を示す', () => {
      render(<ResultView result={makeResult({ strengths: [], weaknesses: [] })} />)

      expect(screen.getAllByText('該当する項目はありません')).toHaveLength(2)
    })
  })

  it('注意書きを、結果の末尾に、小さく薄い文字で示す（仕様 5.5）', () => {
    const { container } = render(<ResultView result={makeResult()} />)

    const note = screen.getByText('本結果は判断材料です。最終的な判断は人が行ってください。')
    expect(note).toHaveClass('ant-typography-secondary')
    expect(note).toHaveStyle({ fontSize: '12px' })
    expect(container.firstElementChild?.lastElementChild).toBe(note)
  })
})
