import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXTURE_DIR } from './paths'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * テスト用の職歴書（すべて架空）を、バックエンドの生成スクリプトで作る。
 * 実在の個人情報は使わない。生成物は Git に入れない。
 */
export default function globalSetup(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
  mkdirSync(FIXTURE_DIR, { recursive: true })
  execFileSync(
    'uv',
    [
      'run',
      '--directory',
      resolve(here, '../backend'),
      'python',
      'tests/fixtures/resume_factory.py',
      FIXTURE_DIR,
    ],
    { stdio: 'pipe' },
  )
}
