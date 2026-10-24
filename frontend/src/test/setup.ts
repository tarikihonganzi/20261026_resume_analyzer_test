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

// Ant Design の Table は、スクロールバーの幅を測るために getComputedStyle(要素, '::-webkit-scrollbar')
// を呼ぶ。jsdom は擬似要素に未対応で、毎回警告を出すので、擬似要素の指定を外して呼ぶ
const originalGetComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = (element: Element) => originalGetComputedStyle(element)

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
