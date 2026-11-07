import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { A11Y_KEY, resetA11yForTests } from './a11y'
import { resetLangForTests } from './i18n'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import VakifnameApp from './VakifnameApp'

// 7 Kasım: erişilebilirlik ayarları (yazı boyutu, yüksek kontrast, hareketi azalt, sorularda süre sınırı yok).

function openHome() {
  stubFetch({
    '/auth/me': { status: 401, body: {} },
    '/monuments': { body: { published_count: 0, data_version: 't', generated_at: null, monuments: [] } },
  })
  window.history.replaceState(null, '', '/')
  render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  resetLangForTests()
  window.localStorage.clear()
  resetA11yForTests()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => {
  window.localStorage.clear()
  resetA11yForTests()
  vi.unstubAllGlobals()
})

describe('erişilebilirlik ayarları', () => {
  it('menü açılır; yazı boyutu, yüksek kontrast ve hareketi azaltma sayfaya uygulanır ve saklanır', async () => {
    openHome()
    const btn = await screen.findByRole('button', { name: 'Erişilebilirlik ayarları' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(btn)
    const panel = screen.getByRole('dialog', { name: 'Erişilebilirlik' })
    expect(panel).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Çok büyük' }))
    expect(document.documentElement.dataset.vkText).toBe('xlarge')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Yüksek kontrast' }))
    expect(document.documentElement).toHaveClass('vk-hc')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hareketi azalt' }))
    expect(document.documentElement).toHaveClass('vk-calm')
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorularda süre sınırı olmasın/ }))
    expect(JSON.parse(window.localStorage.getItem(A11Y_KEY)!)).toEqual({ text: 'xlarge', contrast: true, calm: true, untimed: true })
    // Esc kapatır, odak düğmeye döner.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Erişilebilirlik' })).not.toBeInTheDocument()
    expect(btn).toHaveFocus()
    // Normal'e dönünce kök boyut sıfırlanır.
    await userEvent.click(btn)
    await userEvent.click(screen.getByRole('radio', { name: 'Normal' }))
    expect(document.documentElement.dataset.vkText).toBeUndefined()
  })

  it('kayıtlı ayar sayfa açılırken uygulanır', async () => {
    window.localStorage.setItem(A11Y_KEY, JSON.stringify({ text: 'large', contrast: true, calm: false, untimed: false }))
    resetA11yForTests()
    openHome()
    await screen.findByRole('button', { name: 'Erişilebilirlik ayarları' })
    expect(document.documentElement.dataset.vkText).toBe('large')
    expect(document.documentElement).toHaveClass('vk-hc')
    expect(document.documentElement).not.toHaveClass('vk-calm')
  })
})
