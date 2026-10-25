import { expect, test } from '@playwright/test'
import { conditionRow, registerApiKey } from './helpers'

// アクセシビリティの基本: マウスを使わずに、条件を選んで先へ進める

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

test('キーボードだけで、条件の状態を切り替え、② へ進める。画面が変わると、フォーカスが移る', async ({
  page,
}) => {
  await page.goto('/')
  const row = conditionRow(page, '1級建築施工管理技士')

  // 3 状態のトグルは、矢印キーで切り替える（使わない → 任意 → 必須）
  await row.getByRole('radio', { name: '使わない' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(row.locator('.ant-segmented-item-selected')).toHaveText('必須')

  // 「次へ」を Enter で押す。押したボタンは消えるので、② の領域にフォーカスが移る
  await page.getByRole('button', { name: /次へ/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '② 書類' })).toBeFocused()

  // 「戻る」も、キーボードで押せて、① の領域にフォーカスが移る
  await page.getByRole('button', { name: '戻る' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '① 条件' })).toBeFocused()
  await expect(row.locator('.ant-segmented-item-selected')).toHaveText('必須')
})
