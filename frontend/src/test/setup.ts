import '@testing-library/jest-dom/vitest'

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
