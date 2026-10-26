import { Card, Col, Row, Typography, theme } from 'antd'
import type { EvaluationResult } from '../api/types'
import { requiredStatus, summarizeJudgements } from '../lib/result'
import { ResultMark } from './ResultMark'

function RequiredLine({ result }: { result: EvaluationResult }) {
  const status = requiredStatus(result)
  switch (status.kind) {
    case 'none':
      return <Typography.Text type="secondary">必須条件は設定されていません</Typography.Text>
    case 'clear':
      return (
        <Typography.Text>
          <ResultMark kind="clear" /> 必須条件はすべてクリア
        </Typography.Text>
      )
    case 'ng':
      // 全幅のアラートにはせず、赤い文字で、条件名を示す（仕様 5.5）
      return (
        <Typography.Text style={{ color: '#cf1322', fontWeight: 600 }}>
          <ResultMark kind="unmet" /> 必須条件 {status.count} 件が NG: {status.labels.join('、')}
        </Typography.Text>
      )
  }
}

/**
 * 最終スコア（AI 算出）を、青地の大きな数字で示し、隣に、マッチ度合い（スキルの充足度）と、
 * 必須条件の状況を並べる（仕様 5.5）。補正があったときは、元のスコアと理由を併記する。
 */
export function ScoreCard({ result }: { result: EvaluationResult }) {
  const { token } = theme.useToken()
  const { achieved, total } = summarizeJudgements(result.conditions)

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12}>
        <div
          style={{
            background: token.colorPrimary,
            color: '#fff',
            borderRadius: 8,
            padding: '20px 24px',
            height: '100%',
          }}
        >
          {/* 数値は、カードの中央に寄せる（左に寄ると、右の余白が空いて、不安定に見える） */}
          <div style={{ textAlign: 'center' }}>
            {/* 最終スコアは、画面でいちばん大きく見せる（マッチ度合いの 44px より大きい 80px） */}
            <div style={{ fontSize: 18 }}>最終スコア（AI 算出）</div>
            <div style={{ lineHeight: 1.1, marginTop: 4 }}>
              <span style={{ fontSize: 80, fontWeight: 700 }}>{result.score}</span>
              <span style={{ fontSize: 22, marginLeft: 6 }}>/ 100</span>
            </div>
            {result.clipped ? (
              <div style={{ fontSize: 15, marginTop: 8 }}>
                {/* ±20 は、バックエンドの補正幅（domain/clipping.py の MAX_DEVIATION）と同じ値 */}
                補正あり: AI の元のスコアは {result.original_score} 点。マッチ度合いから ±20
                点の範囲に収めました。
              </div>
            ) : null}
          </div>
        </div>
      </Col>
      <Col xs={24} md={12}>
        <Card style={{ height: '100%' }} styles={{ body: { padding: '20px 24px' } }}>
          <div style={{ textAlign: 'center' }}>
            <Typography.Text type="secondary">マッチ度合い（スキルの充足度）</Typography.Text>
            <div style={{ lineHeight: 1.1, marginTop: 4 }}>
              <span style={{ fontSize: 44, fontWeight: 600 }}>{result.match_rate}</span>
              <span style={{ fontSize: 20, marginLeft: 4 }}>%</span>
            </div>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
              {total} 件の条件のうち、{achieved} 件をクリア
            </Typography.Text>
            <div style={{ marginTop: 12 }}>
              <RequiredLine result={result} />
            </div>
          </div>
        </Card>
      </Col>
    </Row>
  )
}
