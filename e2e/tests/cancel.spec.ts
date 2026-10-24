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

// シナリオ 6: 評価中にキャンセルできる
test('評価中にキャンセルすると、② に戻り、職歴書は残っている。そのまま評価し直せる', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  await startEvaluation(page)
  await expect(page.getByText('評価しています')).toBeVisible()
  // 評価中は、Steps から ①② へ戻れない（仕様 6.2）
  await expect(page.getByRole('button', { name: '評価する' })).toHaveCount(0)

  await page.getByRole('button', { name: 'キャンセル' }).click()

  await expect(page.getByText('評価する条件:')).toBeVisible()
  await expect(page.getByText('この職歴書を評価に使えます')).toBeVisible()
  // 取り消した評価の結果は、あとから現れない
  await page.waitForTimeout(3_000)
  await expect(page.getByText('最終スコア')).toHaveCount(0)

  await startEvaluation(page)
  await expect(page.getByText('最終スコア')).toBeVisible({ timeout: 20_000 })
})
