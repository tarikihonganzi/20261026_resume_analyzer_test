import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  goToResumeAndUpload,
  registerApiKey,
  selectTypicalConditions,
  startEvaluation,
} from './helpers'

// アクセシビリティの基本。axe で、WCAG 2.1 A・AA の自動検査を、主な画面に行う。
// 自動検査で分かるのは一部なので、キーボード操作とフォーカスの移動は、別のテストで確かめる。

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    html: violation.nodes[0]?.html.slice(0, 200),
    detail: violation.nodes[0]?.failureSummary?.split('\n').slice(0, 3).join(' / '),
  }))
  expect(summary, `${label} のアクセシビリティ違反`).toEqual([])
}

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

test('① 条件・② 書類・③ 進捗・③ 結果・設定ページに、自動検査で見つかる違反がない', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('group', { name: '1級建築施工管理技士', exact: true })).toBeVisible()
  await expectNoViolations(page, '① 条件（未選択）')

  await selectTypicalConditions(page)
  await expectNoViolations(page, '① 条件（選択後）')

  await goToResumeAndUpload(page, 'resume.docx')
  // 有効になった直後は、文字の色が、無効の灰色から変わる途中（アニメーション）。確定を待つ
  await expect(page.getByRole('button', { name: '評価する' })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  )
  await expectNoViolations(page, '② 書類')

  await startEvaluation(page)
  await expect(page.getByText('評価しています')).toBeVisible()
  await expectNoViolations(page, '③ 進捗')

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 20_000 })
  // 根拠を、いくつか開いた状態でも検査する
  // （開くと、ボタンの名前が変わり、一覧から外れるので、先頭を押し続ける）
  const closed = page.getByRole('button', { name: '根拠を見る' })
  while ((await closed.count()) > 0) await closed.first().click()
  await expectNoViolations(page, '③ 結果')

  await page.getByRole('button', { name: /設定/ }).click()
  await expect(page.getByLabel('モデル名')).toBeVisible()
  await expectNoViolations(page, '設定ページ')
})
