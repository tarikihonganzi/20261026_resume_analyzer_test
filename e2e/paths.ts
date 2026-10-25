import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 架空の職歴書の置き場（global-setup.ts が、バックエンドの生成スクリプトで作る）。 */
export const FIXTURE_DIR = resolve(here, '.fixtures')

export function fixture(name: string): string {
  return resolve(FIXTURE_DIR, name)
}

/** E2E のサーバーのログの置き場（start-backend.mjs が、APP_LOG_DIR に指定する）。 */
export const LOG_DIR = resolve(here, '.log')
