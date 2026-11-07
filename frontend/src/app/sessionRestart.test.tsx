import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYER, PROFILE, stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { resetAuthForTests } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

/**
 * R6.9: backend yeniden başlatılırken (sunucuya ulaşılamıyor) arayüz oturumu düşürmez; sunucu dönünce aynı çerezle
 * kullanıcı giriş yapmış görünür. Yalnızca sunucu "oturum yok" (401) derse giriş istenir.
 */
const CATALOG = { body: { published_count: 0, data_version: 't', generated_at: null, monuments: [] } }

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('backend yeniden başlatma ve oturum (R6.9)', () => {
  it('sunucu geçici olarak yokken giriş sayfasına atılmaz; sunucu dönünce kullanıcı aynı oturumla devam eder', async () => {
    let up = false
    stubFetch({
      '/auth/me': () => (up ? { body: PLAYER } : new TypeError('Failed to fetch')),
      '/player/profile': PROFILE,
      '/monuments': CATALOG,
    })
    window.history.replaceState(null, '', '/oyun/sehir')
    render(<VakifnameApp />)
    await new Promise((r) => setTimeout(r, 200))
    expect(window.location.pathname).toBe('/oyun/sehir') // giriş sayfasına yönlenmedi
    up = true // backend yeniden açıldı
    expect(await screen.findByRole('heading', { name: 'Nereyi keşfetmek istersin?' }, { timeout: 4000 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/oyun/sehir')
  })

  it('sunucu "oturum yok" (401) derse giriş istenir', async () => {
    stubFetch({ '/auth/me': { status: 401, body: { detail: 'Oturum açık değil.' } }, '/monuments': CATALOG })
    window.history.replaceState(null, '', '/oyun/sehir')
    render(<VakifnameApp />)
    await waitFor(() => expect(window.location.pathname).toBe('/giris'))
  })
})
