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
test('職歴書を評価すると、スコア・必須未達・判定表・根拠・Markdown が表示される', async ({
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
  await expect(page.getByText('職歴書から条件を抽出中')).toBeVisible()

  // 結果
  await expect(page.getByText('最終スコア')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('マッチ度合い', { exact: true })).toBeVisible()

  // 必須条件の未達が、目立つアラートで示される（偽の LLM は、年数の条件を未達にする）
  const alert = page.getByRole('alert').filter({ hasText: '満たしていない必須条件があります' })
  await expect(alert).toContainText('現場監督（施工管理）の経験年数（未達）')

  // 条件別の判定表
  const table = page.getByRole('table')
  await expect(table.getByRole('row', { name: /1級建築施工管理技士/ })).toContainText('達成')
  await expect(table.getByRole('row', { name: /現場監督（施工管理）の経験年数/ })).toContainText(
    '未達',
  )
  await expect(table.getByRole('row', { name: /現場監督（施工管理）の経験年数/ })).toContainText(
    '必要: 5.0年以上',
  )

  // 根拠の文に、元のファイル名が含まれる（受け入れ基準 14）
  await expect(table.getByRole('row', { name: /1級建築施工管理技士/ })).toContainText('resume.docx')

  // Markdown: 太字（概要）と下線（悪かった点）
  const summary = page.locator('.ant-card', { hasText: '評価の概要' })
  await expect(summary.locator('strong', { hasText: '偽の評価' })).toBeVisible()
  const weaknesses = page.locator('.ant-card', { hasText: '悪かった点' })
  await expect(weaknesses.locator('u', { hasText: '一部の記載' })).toBeVisible()

  // 原文にない引用には「原文で確認できず」が付く（受け入れ基準 15）
  await weaknesses.getByRole('button', { name: /引用を見る/ }).click()
  await expect(weaknesses.getByText('原文で確認できず')).toBeVisible()

  await expect(
    page.getByText('本結果は判断材料です。最終的な判断は人が行ってください。'),
  ).toBeVisible()
  expect(failedRequests).toEqual([])
})
