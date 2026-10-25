import { expect, test } from '@playwright/test'
import {
  goToResumeAndUpload,
  registerApiKey,
  selectTypicalConditions,
  startEvaluation,
} from './helpers'
import { fixture } from '../paths'

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

// シナリオ 4: 「別の応募者を評価」で条件が残り、職歴書の入力から続けられる
test('「別の応募者を評価」で、条件を残したまま ② に戻り、別の職歴書を評価できる', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  await startEvaluation(page)
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: '別の応募者を評価' }).click()

  await expect(page.getByText('評価する条件:')).toBeVisible()
  await expect(page.getByText('必須 2 件・任意 1 件')).toBeVisible()
  await expect(page.getByRole('region', { name: 'アップロード済みの職歴書' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '評価する' })).toBeDisabled()

  await page.locator('input[type=file]').setInputFiles(fixture('resume.txt'))
  await expect(page.getByText('1 件の職歴書を評価に使えます')).toBeVisible()
  await startEvaluation(page)

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 20_000 })
  // 2 人目の結果の根拠には、2 人目のファイル名が出る
  const judgement = page.getByRole('region', { name: '条件別の判定' })
  await judgement.getByRole('button', { name: '根拠を見る' }).first().click()
  await expect(judgement).toContainText('resume.txt')
  await expect(judgement).not.toContainText('resume.docx')
})

test('「条件を変えて再評価」で ① に戻り、職歴書は残っていて、もう一度評価できる', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  await startEvaluation(page)
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: '条件を変えて再評価' }).click()
  await expect(page.getByText('必須（2）')).toBeVisible()
  await page.getByRole('button', { name: /次へ/ }).click()

  await expect(page.getByText('1 件の職歴書を評価に使えます')).toBeVisible()
  await startEvaluation(page)
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 20_000 })
})
