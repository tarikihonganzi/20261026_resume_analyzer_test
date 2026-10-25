import { expect, test, type Page } from '@playwright/test'
import { fixture } from '../paths'
import {
  conditionRow,
  countServerLogLines,
  goToResumeAndUpload,
  registerApiKey,
  selectTypicalConditions,
  setMode,
  startEvaluation,
} from './helpers'

// 横断的な、探索的テスト。画面をまたぐ操作・乱暴な操作・境界の値を試し、
// 画面のエラー（console.error・未処理の例外）や、想定外の HTTP エラーが、出ていないことも確かめる。

/** 画面のエラーを集める。テストの最後に、空であることを確かめる。 */
function watchProblems(page: Page, allowed: RegExp[] = []) {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      problems.push(`console.error: ${message.text()}`)
    }
  })
  page.on('response', (response) => {
    const line = `${response.status()} ${response.request().method()} ${response.url()}`
    if (response.status() >= 500 && !allowed.some((pattern) => pattern.test(line))) {
      problems.push(line)
    }
  })
  return problems
}

/** 評価の要求の数。StrictMode（開発サーバー）は、効果を 2 回動かし、1 回目をすぐ取り消すので、
 * 最後まで届いた（取り消されなかった）要求だけを、`completed` で数える。 */
function countEvaluationRequests(page: Page) {
  const counter = { started: 0, completed: 0 }
  const isEvaluation = (url: string) => url.includes('/api/evaluations')
  page.on('request', (request) => {
    if (isEvaluation(request.url()) && request.method() === 'POST') counter.started++
  })
  // 応答が届いた要求だけを数える（StrictMode が、すぐ取り消した 1 回目は、応答が届かない）
  page.on('response', (response) => {
    if (isEvaluation(response.url()) && response.request().method() === 'POST') counter.completed++
  })
  return counter
}

test.beforeEach(async ({ request }) => {
  await registerApiKey(request)
})

test('保存した条件セットに、いまの一覧にないプリセットが含まれていても、壊れない', async ({
  page,
  request,
}) => {
  const problems = watchProblems(page)
  const created = await request.post('/api/condition-sets', {
    data: {
      name: '古いセット',
      conditions: [
        {
          id: 'removed-preset-xyz',
          label: 'いまはない条件',
          kind: 'boolean',
          required: true,
          min_value: null,
          unit: null,
          source: 'preset',
          category: '資格・認定',
          description: null,
        },
      ],
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  await page.goto('/')

  await page.getByRole('combobox', { name: '保存済みの条件セット' }).click()
  await page.locator('.ant-select-item-option-content', { hasText: '古いセット' }).click()

  // 画面に出ない（一覧にない）条件で、「次へ」が押せてしまう、ということがない
  const next = page.getByRole('button', { name: /次へ/ })
  await expect(
    page.getByText('必須（0）').or(page.getByText(/条件を 1 件以上選んでください/)),
  ).toBeVisible()
  await expect(next).toBeDisabled()
  expect(problems).toEqual([])
})

test('評価中に設定ページへ移って戻っても、評価は取り消されず、LLM の呼び出しが二重にならない', async ({
  page,
}) => {
  const problems = watchProblems(page)
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  const extractionsBefore = countServerLogLines('stage=extracting done')

  await startEvaluation(page)
  // 1 段階目（抽出）が終わり、2 段階目（最終評価）に入るまで待つ
  await expect(page.getByRole('status').locator('.ant-steps-item-process')).toContainText(
    '最終評価中',
  )
  await page.getByRole('button', { name: /設定/ }).click()
  await expect(page.getByLabel('モデル名')).toBeVisible()
  await page.getByRole('button', { name: /評価に戻る/ }).click()

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
  // サーバーのログで見る: 抽出（1 段階目）は、1 回だけ終わっている。やり直して、2 回にならない
  await expect.poll(() => countServerLogLines('stage=extracting done') - extractionsBefore).toBe(1)
  expect(problems).toEqual([])
})

test('評価中にページを再読み込みすると、最初の画面に戻り、評価の途中の状態が残らない', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  await startEvaluation(page)
  await expect(page.getByText('評価しています')).toBeVisible()

  await page.reload()

  await expect(page.getByRole('region', { name: '① 条件' })).toBeVisible()
  await expect(page.getByText('評価しています')).toHaveCount(0)
})

test('評価とキャンセルを、素早く何度も繰り返しても、画面が固まらず、最後の評価は完了する', async ({
  page,
}) => {
  const problems = watchProblems(page)
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')

  for (let i = 0; i < 4; i++) {
    await startEvaluation(page)
    await expect(page.getByText('評価しています')).toBeVisible()
    await page.getByRole('button', { name: 'キャンセル' }).click()
    await expect(page.getByRole('button', { name: '評価する' })).toBeEnabled()
  }
  await startEvaluation(page)

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
  expect(problems).toEqual([])
})

test('「評価する」を素早く 2 回押しても、評価の要求は 1 回だけ', async ({ page }) => {
  const evaluations = countEvaluationRequests(page)
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')

  await page.getByRole('button', { name: '評価する' }).dblclick()

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => evaluations.completed).toBe(1)
})

test('ファイルサイズの上限を超えるファイルは、一覧にエラーとして出て、評価できない', async ({
  page,
  request,
}) => {
  const problems = watchProblems(page)
  const put = await request.put('/api/settings', { data: { max_file_size_mb: 1 } })
  expect(put.ok()).toBe(true)
  try {
    await page.goto('/')
    await selectTypicalConditions(page)
    await page.getByRole('button', { name: /次へ/ }).click()

    await page.locator('input[type=file]').setInputFiles({
      name: '大きい.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(2 * 1024 * 1024, 'あ'),
    })

    await expect(page.getByText(/使えません: .*上限（1 MB）/)).toBeVisible()
    await expect(page.getByRole('button', { name: '評価する' })).toBeDisabled()
    await page.getByRole('button', { name: '大きい.txtを削除' }).click()
    await expect(page.getByRole('region', { name: 'アップロード済みの書類' })).toHaveCount(0)
  } finally {
    await request.put('/api/settings', { data: { max_file_size_mb: 0 } })
  }
  expect(problems).toEqual([])
})

test('年数の入力に、文字・負の数・極端に大きい数を入れても、壊れない', async ({ page }) => {
  const problems = watchProblems(page)
  await page.goto('/')
  await setMode(page, '現場監督（施工管理）の経験年数', '必須')
  const input = conditionRow(page, '現場監督（施工管理）の経験年数').getByRole('spinbutton')
  const next = page.getByRole('button', { name: /次へ/ })

  await input.fill('abc')
  await input.blur()
  await expect(next).toBeDisabled()

  await input.fill('-3')
  await input.blur()
  expect(Number(await input.inputValue())).toBeGreaterThanOrEqual(0) // 負の数は、0 に補正される

  await input.fill('1e3')
  await input.blur()
  const value = Number(await input.inputValue())
  expect(Number.isFinite(value)).toBe(true)
  expect(value).toBeGreaterThanOrEqual(0)

  await input.fill('99999999999999999999')
  await input.blur()
  expect(Number.isFinite(Number(await input.inputValue()))).toBe(true)
  expect(problems).toEqual([])
})

test('自由記述の条件に、HTML・長い名前・空白だけの名前を入れても、安全に扱う', async ({ page }) => {
  const problems = watchProblems(page)
  const dialogs: string[] = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  await page.goto('/')
  const add = async (name: string) => {
    await page
      .getByRole('button', { name: /自由記述で条件を追加/ })
      .first()
      .click()
    await page.getByRole('textbox', { name: '条件の名前' }).fill(name)
    await page.getByRole('dialog').getByRole('button', { name: '追加' }).click()
  }

  await add('   ')
  await expect(page.getByRole('dialog')).toBeVisible() // 空白だけの名前は、追加できない
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()
  await page.waitForTimeout(400)

  const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
  await add(html)
  await expect(page.getByRole('region', { name: '自由記述' }).getByText(html)).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()

  // 100 文字を超える名前は、追加できない（理由が出る）
  await add('あ'.repeat(300))
  await expect(page.getByText('100 文字以内で入力してください')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await add('あ'.repeat(100))
  await expect(page.getByRole('dialog')).toBeHidden()
  await setMode(page, html, '必須')
  await goToResumeStep(page)
  await page.locator('input[type=file]').setInputFiles(fixture('resume.docx'))
  await expect(page.getByText('1 件の書類を評価に使えます')).toBeVisible()
  await startEvaluation(page)

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
  // 結果にも、HTML は、文字として出る。実行されない
  expect(await page.locator('img[src="x"]').count()).toBe(0)
  expect(dialogs).toEqual([])
  expect(problems).toEqual([])
})

async function goToResumeStep(page: Page): Promise<void> {
  await page.getByRole('button', { name: /次へ/ }).click()
  await expect(page.getByRole('region', { name: '② 書類' })).toBeVisible()
}

test('同じファイルを 5 回、削除しながら、続けて追加しても、一覧と評価が、ずれない', async ({
  page,
}) => {
  const problems = watchProblems(page)
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /次へ/ }).click()
  const input = page.locator('input[type=file]')

  for (let i = 0; i < 5; i++) await input.setInputFiles(fixture('resume.txt'))
  await expect(page.getByText('5 件の書類を評価に使えます')).toBeVisible()
  // 2 番目・4 番目を削除（同じ名前なので、削除ボタンの名前は同じ）
  await page.getByRole('button', { name: 'resume.txtを削除' }).nth(3).click()
  await page.getByRole('button', { name: 'resume.txtを削除' }).nth(1).click()
  await expect(page.getByText('3 件の書類を評価に使えます')).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'アップロード済みの書類' }).getByRole('listitem'),
  ).toHaveCount(3)

  await startEvaluation(page)

  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
  expect(problems).toEqual([])
})

test('テキストの貼り付けを、短い・空白だけ・とても長い、で試す', async ({ page }) => {
  const problems = watchProblems(page)
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /次へ/ }).click()
  await page.getByRole('tab', { name: 'テキストを貼り付ける' }).click()
  const box = page.getByRole('textbox', { name: '書類のテキスト' })

  await box.fill('短い')
  await expect(page.getByText(/使えません: .*テキスト化できませんでした/)).toBeVisible({
    timeout: 5_000,
  })
  await expect(page.getByRole('button', { name: '評価する' })).toBeDisabled()

  await box.fill('   \n\t  ')
  await expect(page.getByRole('region', { name: 'アップロード済みの書類' })).toHaveCount(0, {
    timeout: 5_000,
  })

  // 現実的に長い職歴書（約 20,000 字）。ブラウザの fill は、文字数の 2 乗に近く遅いので、これ以上は試さない
  const long = '職務経歴の記載です。現場監督として勤務。\n'.repeat(500)
  await box.fill(long)
  await expect(page.getByText('1 件の書類を評価に使えます')).toBeVisible({ timeout: 15_000 })
  expect(problems).toEqual([])
})

for (const width of [375, 768]) {
  test(`画面の幅 ${width}px で、横にはみ出さない（① ② ③・設定）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const overflow = async (label: string) => {
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(wide, `${label} で、横に ${wide}px はみ出している`).toBeLessThanOrEqual(1)
    }
    await page.goto('/')
    await expect(page.getByRole('region', { name: '① 条件' })).toBeVisible()
    await overflow('①')

    await selectTypicalConditions(page)
    await goToResumeAndUpload(page, 'resume.docx')
    await overflow('②')

    await startEvaluation(page)
    await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
    await overflow('③')

    await page.getByRole('button', { name: /設定/ }).click()
    await expect(page.getByLabel('モデル名')).toBeVisible()
    await overflow('設定')
  })
}

test('結果 → 別の応募者 → もう一度、のあと、前の応募者の結果が残らない', async ({ page }) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  await startEvaluation(page)
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: '別の応募者を評価' }).click()
  await expect(page.getByRole('region', { name: '② 書類' })).toBeVisible()
  await expect(page.getByText('最終スコア（AI 算出）')).toHaveCount(0)
  await page.locator('input[type=file]').setInputFiles(fixture('resume.txt'))
  await expect(page.getByText('1 件の書類を評価に使えます')).toBeVisible()
  await startEvaluation(page)
  await expect(page.getByText('評価しています')).toBeVisible()
  // 評価中に、前の結果が見えない
  await expect(page.getByText('最終スコア（AI 算出）')).toHaveCount(0)
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
})

// --- 通信を壊す（サーバーの失敗・途中の切断・接続できない）。画面が、理由を示し、立て直せるか ---

test('評価の要求が 500 で失敗したら、原因と「再実行」を出し、押すと、評価し直せる', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  let calls = 0
  await page.route('**/api/evaluations', async (route) => {
    calls++
    if (calls <= 2) {
      // 開発サーバーでは、最初の要求が、すぐ取り消される。実際に届いた要求だけを、壊す
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'internal_error', message: 'サーバーの失敗です。' }),
      })
    } else {
      await route.continue()
    }
  })

  await startEvaluation(page)

  await expect(page.getByText('評価できませんでした')).toBeVisible()
  await expect(page.getByText('サーバーの失敗です。')).toBeVisible()
  await page.getByRole('button', { name: '再実行' }).click()
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
})

test('評価のストリームが、途中で切れても、「途中で終わった」と示し、再実行できる', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await goToResumeAndUpload(page, 'resume.docx')
  let calls = 0
  await page.route('**/api/evaluations', async (route) => {
    calls++
    if (calls <= 2) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: stage\ndata: {"stage":"extracting"}\n\n',
      })
    } else {
      await route.continue()
    }
  })

  await startEvaluation(page)

  await expect(page.getByText('評価が途中で終わりました')).toBeVisible()
  await page.getByRole('button', { name: '再実行' }).click()
  await expect(page.getByText('最終スコア（AI 算出）')).toBeVisible({ timeout: 30_000 })
})

test('書類の検証で、サーバーに接続できなくても、一覧に理由が出て、削除して選び直せる', async ({
  page,
}) => {
  const problems = watchProblems(page)
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /次へ/ }).click()
  await page.route('**/api/resumes/check', (route) => route.abort('connectionrefused'))

  await page.locator('input[type=file]').setInputFiles(fixture('resume.docx'))

  await expect(page.getByText(/使えません: .*サーバーに接続できませんでした/)).toBeVisible()
  await expect(page.getByRole('button', { name: '評価する' })).toBeDisabled()
  await page.unroute('**/api/resumes/check')
  await page.getByRole('button', { name: 'resume.docxを削除' }).click()
  await page.locator('input[type=file]').setInputFiles(fixture('resume.docx'))
  await expect(page.getByText('1 件の書類を評価に使えます')).toBeVisible()
  expect(problems).toEqual([])
})

test('ブラウザの「戻る」「進む」で、設定ページと評価の画面を行き来できて、入力が残る', async ({
  page,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /設定/ }).click()
  await expect(page.getByLabel('モデル名')).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('region', { name: '① 条件' })).toBeVisible()
  await expect(page.getByText('必須（2）')).toBeVisible()

  await page.goForward()
  await expect(page.getByLabel('モデル名')).toBeVisible()
})

test('保存した条件セットは、ページを再読み込みしても、残っている。削除すると、消える', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await selectTypicalConditions(page)
  await page.getByRole('button', { name: /名前を付けて保存/ }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('消すセット')
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('「消すセット」を保存しました')).toBeVisible()

  await page.reload()
  await page.getByRole('combobox', { name: '保存済みの条件セット' }).click()
  await page.locator('.ant-select-item-option-content', { hasText: '消すセット' }).click()
  await expect(page.getByText('必須（2）')).toBeVisible()
  await page.getByRole('button', { name: '条件セットを削除' }).click()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await expect(page.getByText('「消すセット」を削除しました')).toBeVisible()

  // 削除したセットは、サーバーにも残っていない
  const response = await request.get('/api/condition-sets')
  const body = (await response.json()) as { sets: { name: string }[] }
  expect(body.sets.map((set) => set.name)).not.toContain('消すセット')
})
