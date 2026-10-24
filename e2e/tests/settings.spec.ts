import { expect, test } from '@playwright/test'

// シナリオ 5: 設定ページで API キーを変更し、接続テストが成功と失敗の両方を表示する
test('API キーを変更して保存でき、接続テストが成功と失敗の両方を示す。キーの全文は画面に出ない', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /設定/ }).click()
  await expect(page.getByLabel('モデル名')).toBeVisible()

  // 失敗（偽のサーバーは、"bad" で始まるキーを、認証エラーにする）
  await page.getByLabel('API キー').fill('bad-key-0000')
  await page.getByRole('button', { name: '接続テスト' }).click()
  await expect(page.getByText('接続できませんでした')).toBeVisible()
  await expect(page.getByText(/API キーが正しくない/)).toBeVisible()

  // 入力を変えると、前の結果は消える。成功
  await page.getByLabel('API キー').fill('sk-e2e-good-1234')
  await expect(page.getByText('接続できませんでした')).toHaveCount(0)
  await page.getByRole('button', { name: '接続テスト' }).click()
  await expect(page.getByText('接続できました')).toBeVisible()

  // 保存すると、マスク表示になり、入力欄は空に戻る。バナーは消える
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存しました。次の評価から反映されます。')).toBeVisible()
  await expect(page.getByText(/保存済み: \*\*\*\*1234/)).toBeVisible()
  await expect(page.getByLabel('API キー')).toHaveValue('')
  await expect(page.locator('body')).not.toContainText('sk-e2e-good-1234')
  await expect(page.getByText('API キーが設定されていません')).toHaveCount(0)

  // 再読み込みしても、保存されている（アプリの再起動なしで反映される）
  await page.reload()
  await expect(page.getByText(/保存済み: \*\*\*\*1234/)).toBeVisible()
})
