import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeCondition, makeJudged, makeResult } from '../test/fixtures'
import { ResultView } from './ResultView'

const section = (name: string) => within(screen.getByRole('region', { name }))

describe('結果画面', () => {
  describe('スコア', () => {
    it('「最終スコア（AI 算出）」と「マッチ度合い（スキルの充足度）」を、別のラベルで示す', () => {
      render(<ResultView result={makeResult({ score: 72, match_rate: 70 })} />)

      expect(screen.getByText('最終スコア（AI 算出）')).toBeInTheDocument()
      expect(screen.getByText('72')).toBeInTheDocument()
      expect(screen.getByText('マッチ度合い（スキルの充足度）')).toBeInTheDocument()
      expect(screen.getByText('70')).toBeInTheDocument()
    })

    it('最終スコアは、マッチ度合いより大きな文字で示す', () => {
      render(<ResultView result={makeResult({ score: 72, match_rate: 70 })} />)

      const size = (text: string) => Number.parseInt(screen.getByText(text).style.fontSize, 10)
      expect(size('72')).toBeGreaterThan(size('70'))
    })

    it('補正がないときは、補正の説明を出さない', () => {
      render(<ResultView result={makeResult()} />)

      expect(screen.queryByText(/補正あり/)).not.toBeInTheDocument()
    })

    it('補正があったときは、元のスコアを併記する（仕様 5.5・受け入れ基準 5）', () => {
      render(
        <ResultView
          result={makeResult({ score: 72, original_score: 95, clipped: true, match_rate: 52 })}
        />,
      )

      expect(screen.getByText(/補正あり: AI の元のスコアは 95 点/)).toBeInTheDocument()
    })

    it('達成した条件の数を、全体の数とあわせて示す', () => {
      render(
        <ResultView
          result={makeResult({
            conditions: [
              makeJudged({ status: 'achieved' }),
              makeJudged({ condition: makeCondition({ id: 'b' }), status: 'unmet' }),
              makeJudged({ condition: makeCondition({ id: 'c' }), status: 'unknown' }),
            ],
          })}
        />,
      )

      expect(screen.getByText('3 件の条件のうち、1 件をクリア')).toBeInTheDocument()
    })
  })

  describe('必須条件の状況（受け入れ基準 6）', () => {
    it('未達があれば、赤い文字で、件数と条件名を示す。全幅のアラートにはしない', () => {
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

      expect(
        screen.getByText(/必須条件 2 件が NG: 1級建築施工管理技士、現場監督の経験年数/),
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('必須の条件があり、すべてクリアなら、「必須条件はすべてクリア」', () => {
      render(
        <ResultView
          result={makeResult({
            conditions: [makeJudged({ condition: makeCondition({ required: true }) })],
          })}
        />,
      )

      expect(screen.getByText(/必須条件はすべてクリア/)).toBeInTheDocument()
    })

    it('必須の条件が 1 つもなければ、「クリア」とは言わない', () => {
      render(<ResultView result={makeResult()} />)

      expect(screen.getByText('必須条件は設定されていません')).toBeInTheDocument()
      expect(screen.queryByText(/必須条件はすべてクリア/)).not.toBeInTheDocument()
    })
  })

  describe('AI の評価コメント', () => {
    it('総評・良かった点・悪かった点を、条件別の判定より先に示す', () => {
      render(<ResultView result={makeResult()} />)

      const comments = screen.getByText('AI の評価コメント')
      const judgement = screen.getByRole('region', { name: '判定' })
      expect(
        comments.compareDocumentPosition(judgement) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(section('総評').getByText(/要件を概ね満たしています/)).toBeInTheDocument()
      expect(section('良かった点').getByText('大規模現場の経験')).toBeInTheDocument()
      expect(section('悪かった点').getByText('BIM の経験が少ない')).toBeInTheDocument()
    })

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

      const summary = section('総評')
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

    it('項目が 0 件なら、その旨を示す', () => {
      render(<ResultView result={makeResult({ strengths: [], weaknesses: [] })} />)

      expect(screen.getAllByText('該当する項目はありません')).toHaveLength(2)
    })

    it('根拠が出力されなかった項目は、その旨を示す', () => {
      render(<ResultView result={makeResult()} />)

      // 悪かった点の項目は、reason も quotes も空
      expect(section('悪かった点').getByText('根拠が出力されませんでした')).toBeInTheDocument()
    })
  })

  describe('条件別の判定（必須・任意 × クリア・NG）', () => {
    const result = makeResult({
      conditions: [
        makeJudged({
          condition: makeCondition({ id: 'o1', label: '任意の達成', required: false }),
          status: 'achieved',
        }),
        makeJudged({
          condition: makeCondition({ id: 'r1', label: '必須の達成', required: true }),
          status: 'achieved',
        }),
        makeJudged({
          condition: makeCondition({
            id: 'r2',
            label: '現場監督の経験年数',
            kind: 'number',
            unit: '年',
            min_value: 5,
            required: true,
          }),
          status: 'unmet',
          has_skill: null,
          years: 3.25,
        }),
        makeJudged({
          condition: makeCondition({ id: 'o2', label: 'Revit の経験', required: false }),
          status: 'unknown',
          has_skill: null,
          reason: '',
          quotes: [],
        }),
      ],
    })

    it('見出しは「判定」だけで、その下に説明（凡例）を出さない', () => {
      render(<ResultView result={result} />)

      expect(screen.getByText('判定', { selector: '.ant-card-head-title' })).toBeInTheDocument()
      expect(screen.queryByText('条件別の判定')).not.toBeInTheDocument()
      expect(screen.queryByText(/NG の列に入ります/)).not.toBeInTheDocument()
    })

    it('見出しは、カードの見出しの帯（背景色つき）にする。「判定」の中に、必須・任意の帯がある', () => {
      render(<ResultView result={result} />)

      const heads = [...document.querySelectorAll('.ant-card-head-title')].map(
        (el) => el.textContent,
      )
      expect(heads).toEqual(['AI の評価コメント', '判定', '必須条件（2 件）', '任意条件（2 件）'])
    })

    it('「必須条件」のセクションが、「任意条件」のセクションより上にある', () => {
      render(<ResultView result={result} />)

      const required = screen.getByText('必須条件（2 件）')
      const optional = screen.getByText('任意条件（2 件）')
      expect(
        required.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('各セクションの「クリア」の列と「NG」の列に、条件を並べる', () => {
      render(<ResultView result={result} />)
      const judgement = section('判定')

      const columns = judgement.getAllByRole('region', { name: /^(クリア|NG)$/ })
      // 必須: クリア・NG、任意: クリア・NG
      expect(columns).toHaveLength(4)
      const [requiredClear, requiredNg, optionalClear, optionalNg] = columns.map((column) =>
        within(column),
      )
      expect(requiredClear?.getByText('必須の達成')).toBeInTheDocument()
      expect(requiredNg?.getByText('現場監督の経験年数')).toBeInTheDocument()
      expect(optionalClear?.getByText('任意の達成')).toBeInTheDocument()
      expect(optionalNg?.getByText('Revit の経験')).toBeInTheDocument()
    })

    it('判定は、タグではなく、記号（○ × △）で示す', () => {
      const { container } = render(<ResultView result={result} />)

      expect(container.querySelector('.ant-tag')).toBeNull()
      const judgement = section('判定')
      expect(judgement.getAllByRole('img', { name: 'クリア' }).length).toBeGreaterThan(0)
      expect(judgement.getAllByRole('img', { name: 'NG' }).length).toBeGreaterThan(0)
      expect(judgement.getAllByRole('img', { name: '不明' }).length).toBeGreaterThan(0)
      expect(screen.getAllByText('○').length).toBeGreaterThan(0)
      expect(screen.getAllByText('×').length).toBeGreaterThan(0)
      expect(screen.getAllByText('△').length).toBeGreaterThan(0)
    })

    it('画面に「未達」という言葉を出さない（クリア・NG・不明で表す）', () => {
      const { container } = render(<ResultView result={result} />)

      expect(container.textContent).not.toContain('未達')
      expect(section('判定').getAllByTestId('column-heading')[1]).toHaveTextContent('NG')
    })

    it('「クリア」「NG」の見出しは、条件名より大きく太い文字で、条件名と見分けがつく', () => {
      render(<ResultView result={result} />)

      const heading = section('判定').getAllByTestId('column-heading')[0]
      const item = screen.getByText('必須の達成')
      expect(Number.parseInt(heading?.style.fontSize ?? '0', 10)).toBeGreaterThan(
        Number.parseInt(item.style.fontSize || '14', 10),
      )
      expect(heading?.style.fontWeight).toBe('700')
      expect(item.style.fontWeight).not.toBe('700')
    })

    it('見出しは 22px 以上、条件名は 18px 以上の、やや太い文字にして、読みやすくする', () => {
      render(<ResultView result={result} />)

      const heading = section('判定').getAllByTestId('column-heading')[0]
      const item = screen.getByText('必須の達成')
      expect(Number.parseInt(heading?.style.fontSize ?? '0', 10)).toBeGreaterThanOrEqual(22)
      expect(Number.parseInt(item.style.fontSize, 10)).toBeGreaterThanOrEqual(18)
      expect(Number(item.style.fontWeight)).toBeGreaterThanOrEqual(500)
    })

    it('number の条件には、年数と必要な最低値を、不明には、確認できなかった旨を添える', () => {
      render(<ResultView result={result} />)

      expect(screen.getByText('3.3年（必要: 5.0年以上）')).toBeInTheDocument()
      expect(screen.getByText('書類から確認できませんでした')).toBeInTheDocument()
    })

    it('必須の条件が 1 つもなければ、「必須条件」のセクションを出さない', () => {
      render(<ResultView result={makeResult()} />)

      expect(screen.queryByText(/必須条件（/)).not.toBeInTheDocument()
      expect(screen.getByText('任意条件（1 件）')).toBeInTheDocument()
    })

    it('列に条件がなければ、「なし」と出す', () => {
      render(<ResultView result={makeResult()} />)

      const columns = section('判定').getAllByRole('region', { name: /^(クリア|NG)$/ })
      expect(within(columns[1] as HTMLElement).getByText('なし')).toBeInTheDocument()
    })
  })

  describe('根拠と引用（受け入れ基準 14・15）', () => {
    it('既定では閉じていて、「根拠を見る」で、reason と引用（出典名・位置・原文）が開く', async () => {
      render(<ResultView result={makeResult()} />)
      const judgement = section('判定')

      expect(judgement.queryByText('職歴書.docx に資格の記載があります。')).not.toBeInTheDocument()
      const toggle = judgement.getByRole('button', { name: '根拠を見る' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      await userEvent.click(toggle)

      expect(judgement.getByText('職歴書.docx に資格の記載があります。')).toBeInTheDocument()
      expect(judgement.getByText('職歴書.docx（資格欄）')).toBeInTheDocument()
      expect(judgement.getByText('1級建築施工管理技士 取得')).toBeInTheDocument()
      expect(judgement.getByRole('button', { name: '根拠を閉じる' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })

    it('原文で確認できなかった引用は、閉じていても「原文で確認できず」が見える。開くと、引用ごとに示す', async () => {
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
      const judgement = section('判定')

      expect(judgement.getByText('原文で確認できず')).toBeInTheDocument()
      await userEvent.click(judgement.getByRole('button', { name: '根拠を見る' }))

      // 開いたあとは、重複しないよう、引用の横にだけ出る
      expect(judgement.getAllByText('原文で確認できず')).toHaveLength(1)
      expect(judgement.getByText('未照合')).toBeInTheDocument()
      const matched = judgement.getByText('確かにある文').closest('li')
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

      await userEvent.click(section('判定').getByRole('button', { name: '根拠を見る' }))

      const quote = screen.getByText(text)
      expect(quote.tagName).toBe('BLOCKQUOTE')
      expect(quote.querySelector('strong, script, u')).toBeNull()
    })

    it('総評・良かった点・悪かった点にも、根拠がある', async () => {
      render(<ResultView result={makeResult()} />)

      await userEvent.click(section('良かった点').getByRole('button', { name: '根拠を見る' }))

      expect(section('良かった点').getByText('職歴書.docx に記載があります。')).toBeInTheDocument()
    })
  })

  it('注意書きを、結果の末尾に、小さく薄い文字で示す（仕様 5.5）', () => {
    const { container } = render(<ResultView result={makeResult()} />)

    const note = screen.getByText('本結果は判断材料です。最終的な判断は人が行ってください。')
    expect(note).toHaveClass('ant-typography-secondary')
    expect(note).toHaveStyle({ fontSize: '14px' })
    expect(container.firstElementChild?.lastElementChild).toBe(note)
  })
})
