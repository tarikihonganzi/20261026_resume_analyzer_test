import { expect, test } from '@playwright/test'
import { conditionRow, registerApiKey, selectTypicalConditions } from './helpers'
import { fixture } from '../paths'

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

// シナリオ 3: 読めないファイルは、その場でエラーになり、条件が残ったまま別のファイルを選べる
test('読めないファイルはその場でエラーになり、条件を保ったまま選び直せる', async ({ page }) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /次へ/ }).click()

  await page.locator('input[type=file]').setInputFiles(fixture('broken.docx'))

  await expect(page.getByText(/使えません: /)).toBeVisible()
  await expect(page.getByRole('button', { name: 'broken.docxを削除' })).toBeVisible()
  await expect(page.getByRole('button', { name: '評価する' })).toBeDisabled()
  // 条件は、そのまま
  await expect(page.getByText('必須 2 件・任意 1 件')).toBeVisible()

  // 読めないファイルを削除して、別のファイルを選び直す
  await page.getByRole('button', { name: 'broken.docxを削除' }).click()
  await page.locator('input[type=file]').setInputFiles(fixture('resume.docx'))

  await expect(page.getByText('1 件の職歴書を評価に使えます')).toBeVisible()
  await expect(page.getByRole('button', { name: '評価する' })).toBeEnabled()

  // ① に戻っても、選んだ条件が残っている（受け入れ基準 11）
  await page.getByRole('button', { name: '変更' }).click()
  await expect(
    conditionRow(page, '現場監督（施工管理）の経験年数').getByRole('spinbutton'),
  ).toHaveValue('5.0')
})
