import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { fixture } from '../paths'

/** 条件の行（3 状態トグルと、number の最低値を含む）。 */
export function conditionRow(page: Page, name: string): Locator {
  return page.getByRole('group', { name, exact: true })
}

export async function setMode(
  page: Page,
  name: string,
  mode: '必須' | '任意' | '使わない',
): Promise<void> {
  await conditionRow(page, name).getByText(mode, { exact: true }).click()
}

/**
 * API キーを登録する（「評価する」は、キーが未設定だと押せない）。
 * Vite の転送を経由する（画面と同じ入口）。
 */
export async function registerApiKey(
  request: APIRequestContext,
  key = 'sk-e2e-test-0000',
): Promise<void> {
  const response = await request.put('/api/settings', {
    data: { openai_api_key: key },
  })
  expect(response.ok()).toBe(true)
}

/** ① で、必須 2 件（資格 1・年数 1）と任意 1 件を選ぶ。 */
export async function selectTypicalConditions(page: Page): Promise<void> {
  await setMode(page, '1級建築施工管理技士', '必須')
  await setMode(page, '現場監督（施工管理）の経験年数', '必須')
  await conditionRow(page, '現場監督（施工管理）の経験年数').getByRole('spinbutton').fill('5')
  await setMode(page, '品質管理', '任意')
}

/** ① から ② へ進み、職歴書のファイルを選んで、検証が通るまで待つ。 */
export async function goToResumeAndUpload(page: Page, filename: string): Promise<void> {
  await page.getByRole('button', { name: /次へ/ }).click()
  await page.locator('input[type=file]').setInputFiles(fixture(filename))
  await expect(page.getByText('1 件の書類を評価に使えます')).toBeVisible()
}

export async function startEvaluation(page: Page): Promise<void> {
  await page.getByRole('button', { name: '評価する' }).click()
}
