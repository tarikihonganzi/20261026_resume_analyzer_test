import { expect, test } from '@playwright/test'
import { conditionRow, registerApiKey, setMode } from './helpers'

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

// シナリオ 1: 条件を選び（必須・任意・年数・自由記述）、保存し、再読み込み後に読み込む
test('条件セットを保存し、再読み込みのあとに読み込むと、選択・年数・自由記述が復元される', async ({
  page,
}) => {
  await page.goto('/')

  await setMode(page, '1級建築施工管理技士', '必須')
  await setMode(page, '品質管理', '任意')
  await setMode(page, '現場監督（施工管理）の経験年数', '必須')
  await conditionRow(page, '現場監督（施工管理）の経験年数').getByRole('spinbutton').fill('5')

  await page
    .getByRole('button', { name: /自由記述で条件を追加/ })
    .first()
    .click()
  await page.getByRole('textbox', { name: '条件の名前' }).fill('耐震診断の経験')
  await page.getByRole('dialog').getByRole('button', { name: '追加' }).click()
  await expect(
    page.getByRole('region', { name: '自由記述' }).getByText('耐震診断の経験'),
  ).toBeVisible()
  await expect(page.getByText('必須（2）')).toBeVisible()
  await expect(page.getByText('任意（2）')).toBeVisible()

  await page.getByRole('button', { name: /名前を付けて保存/ }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('E2E の条件セット')
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('「E2E の条件セット」を保存しました')).toBeVisible()

  // 再読み込みで、画面の状態は消える（仕様 6.2）。保存したセットだけが残る
  await page.reload()
  await expect(page.getByText('必須（2）')).toHaveCount(0)

  await page.getByRole('combobox', { name: '保存済みの条件セット' }).click()
  await page.locator('.ant-select-item-option-content', { hasText: 'E2E の条件セット' }).click()

  await expect(page.getByText('必須（2）')).toBeVisible()
  await expect(page.getByText('任意（2）')).toBeVisible()
  await expect(
    conditionRow(page, '現場監督（施工管理）の経験年数').getByRole('spinbutton'),
  ).toHaveValue('5.0')
  await expect(
    page.getByRole('region', { name: '自由記述' }).getByText('耐震診断の経験'),
  ).toBeVisible()
})
