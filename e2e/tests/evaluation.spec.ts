import { expect, test } from '@playwright/test'
import {
  goToResumeAndUpload,
  registerApiKey,
  selectTypicalConditions,
  startEvaluation,
} from './helpers'

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

// シナリオ 2: 職歴書をアップロードして評価し、結果が表示される
test('職歴書を評価すると、スコア・必須条件の NG・判定・根拠・Markdown が表示される', async ({
  page,
}) => {
  const failedRequests: string[] = []
  page.on('response', (response) => {
    // Vite の転送と、Origin の確認を通っていること（POST が 403 にならない）
    if (response.url().includes('/api/') && response.status() >= 400) {
      failedRequests.push(`${response.request().method()} ${response.url()} ${response.status()}`)
    }
  })
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')

  await startEvaluation(page)

  // 進捗（抽出中 → 最終評価中）
  await expect(page.getByText('評価しています')).toBeVisible()
  await expect(page.getByText('書類から条件を抽出中')).toBeVisible()

  // 結果: 最終スコア（AI 算出）とマッチ度合い（スキルの充足度）
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('マッチ度合い（スキルの充足度）')).toBeVisible()

  // 必須条件の NG が、赤い文字で示される（偽の LLM は、年数の条件を NG にする）
  await expect(page.getByText(/必須条件 1 件が NG: 現場監督（施工管理）の経験年数/)).toBeVisible()

  // 条件別の判定: 必須と任意に分かれ、それぞれ「クリア」「NG」の列に並ぶ
  const judgement = page.getByRole('region', { name: '条件別の判定' })
  await expect(judgement.getByText('必須条件（2 件）')).toBeVisible()
  await expect(judgement.getByText('任意条件（1 件）')).toBeVisible()
  const columns = judgement.getByRole('region', { name: /^(クリア|NG)$/ })
  await expect(columns).toHaveCount(4)
  await expect(columns.nth(0)).toContainText('1級建築施工管理技士') // 必須・クリア
  await expect(columns.nth(1)).toContainText('現場監督（施工管理）の経験年数') // 必須・NG
  await expect(columns.nth(1)).toContainText('4.0年（必要: 5.0年以上）')
  await expect(columns.nth(3)).toContainText('品質管理') // 任意・NG

  // 根拠は、閉じている。開くと、元のファイル名が含まれる（受け入れ基準 14）
  await expect(judgement).not.toContainText('resume.docx')
  await columns.nth(0).getByRole('button', { name: '根拠を見る' }).click()
  await expect(columns.nth(0)).toContainText('resume.docx')

  // 評価コメント: Markdown の太字（総評）と下線（悪かった点）
  const comments = page.locator('.ant-card', { hasText: 'AI の評価コメント' })
  await expect(comments.locator('strong', { hasText: '偽の評価' })).toBeVisible()
  const weaknesses = comments.getByRole('region', { name: '悪かった点' })
  await expect(weaknesses.locator('u', { hasText: '一部の記載' })).toBeVisible()

  // 原文にない引用には「原文で確認できず」が付く。根拠を開く前から見える（受け入れ基準 15）
  await expect(weaknesses.getByText('原文で確認できず')).toBeVisible()
  await weaknesses.getByRole('button', { name: '根拠を見る' }).click()
  await expect(weaknesses.getByText('原文で確認できず')).toBeVisible()

  await expect(
    page.getByText('本結果は判断材料です。最終的な判断は人が行ってください。'),
  ).toBeVisible()
  expect(failedRequests).toEqual([])
})
