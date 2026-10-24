import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('タイトルを表示する', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '職歴書マッチング評価' })).toBeInTheDocument()
  })
})
