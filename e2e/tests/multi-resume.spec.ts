import { expect, test } from '@playwright/test'
import { fixture } from '../paths'
import { registerApiKey, selectTypicalConditions, startEvaluation } from './helpers'

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

// 仕様 5.3: 1 人の応募者の複数の書類を、1 回の評価で渡せる。間違えて上げたものは、削除できる
test('複数の書類（docx・PDF・txt）を上げ、間違えた 1 件を削除して、評価できる', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /次へ/ }).click()

  await page
    .locator('input[type=file]')
    .setInputFiles([
      fixture('resume.docx'),
      fixture('resume_digital.pdf'),
      fixture('resume_injection.txt'),
    ])

  await expect(page.getByText('3 件の書類を評価に使えます')).toBeVisible()
  const list = page.getByRole('region', { name: 'アップロード済みの書類' })
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await expect(page.getByText('アップロード済みの書類（3 / 5）')).toBeVisible()

  // 間違えて上げたファイルを削除する
  await page.getByRole('button', { name: 'resume_injection.txtを削除' }).click()
  await expect(page.getByText('2 件の書類を評価に使えます')).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(2)

  // 上の Steps には、ファイル名を並べない
  await page.getByRole('button', { name: '変更' }).click()
  await expect(page.getByText('ファイルアップロード完了')).toBeVisible()
  await page.getByRole('button', { name: /次へ/ }).click()
  await expect(page.getByText('2 件の書類を評価に使えます')).toBeVisible()

  await startEvaluation(page)

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 20_000 })
  // 引用の出典名は、実際にアップロードした書類の名前になる（受け入れ基準 14・16）
  const judgement = page.getByRole('region', { name: '判定', exact: true })
  await judgement.getByRole('button', { name: '根拠を見る' }).first().click()
  await expect(judgement).toContainText('resume.docx')
})

test('上限（5 件）を超える分は、追加しない。削除すると、また追加できる', async ({ page }) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /次へ/ }).click()
  const input = page.locator('input[type=file]')

  await input.setInputFiles([
    fixture('resume.docx'),
    fixture('resume.txt'),
    fixture('resume.xlsx'),
    fixture('resume.pptx'),
    fixture('resume_digital.pdf'),
    fixture('resume_injection.txt'),
  ])

  await expect(page.getByText('5 件の書類を評価に使えます')).toBeVisible()
  await expect(page.getByText(/最大 5 件までです。超える分は、追加しませんでした/)).toBeVisible()

  await page.getByRole('button', { name: 'resume.docxを削除' }).click()
  await input.setInputFiles(fixture('resume_injection.txt'))

  await expect(page.getByText('5 件の書類を評価に使えます')).toBeVisible()
})
