import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

type MatchMediaStub = Pick<
  MediaQueryList,
  'matches' | 'media' | 'onchange' | 'addEventListener' | 'removeEventListener' | 'dispatchEvent'
>

// Ant Design は jsdom にない matchMedia を使う。非推奨の addListener／removeListener は使われない
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MatchMediaStub => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

// Ant Design の一部（Popconfirm など）は、jsdom にない ResizeObserver を使う
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub

// API は msw で差し替える。想定していないリクエストは、テストの失敗にする
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
  window.location.hash = ''
})
afterAll(() => {
  server.close()
})
