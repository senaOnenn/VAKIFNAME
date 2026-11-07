import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonumentFactSheet } from './components/MonumentFactSheet'
import { addressIn, altNamesIn } from './contentLang'
import { resetLangForTests, setLang } from './i18n'
import { register, requestPasswordReset, resendVerification, resetAuthForTests } from './session'

// R6.17: eksiksiz İngilizce. Künyede diğer adlar ve adres onaylı İngilizcesiyle; hesap e-postaları arayüz dilinde;
// arayüz katmanında çevrilmemiş Türkçe dizgi kalmaz (scripts/check-i18n.mjs).

const MON = {
  type: 'cami', district: 'Osmangazi', city: 'Bursa', address: "Atatürk Caddesi, Osmangazi/Bursa (PTT'nin karşısı)",
  address_en: 'Atatürk Caddesi, Osmangazi/Bursa (opposite the PTT post office)', alternative_names: ['Ulu Cami'],
  alternative_names_en: ['Ulu Cami', 'Ulucami'], facts: [], images: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetLangForTests()
  resetAuthForTests()
})

describe('R6.17 künye', () => {
  it('İngilizcede onaylı adres ve diğer adlar; Türkçede özgünü', () => {
    expect(addressIn(MON, 'en')).toBe(MON.address_en)
    expect(addressIn(MON, 'tr')).toBe(MON.address)
    expect(altNamesIn(MON, 'en')).toEqual(['Ulu Cami', 'Ulucami'])
    expect(altNamesIn({ ...MON, alternative_names_en: [] }, 'en')).toEqual(['Ulu Cami']) // onaysızsa özgün ad kalır
    expect(addressIn({ ...MON, address_en: null }, 'en')).toBe(MON.address)
  })

  it('künye İngilizce arayüzde İngilizce adresle çizilir', () => {
    setLang('en')
    render(<MonumentFactSheet monument={MON} headingId="h" />)
    expect(screen.getByText(MON.address_en)).toBeInTheDocument()
    expect(screen.getByText('Ulu Cami · Ulucami')).toBeInTheDocument()
    expect(screen.queryByText(/PTT'nin karşısı/)).not.toBeInTheDocument()
  })
})

describe('R6.17 hesap e-postalarının dili', () => {
  it('kayıt, yeniden gönderme ve parola yenileme isteği seçili dili gönderir', async () => {
    const bodies: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname
      bodies[path] = init?.body ? JSON.parse(String(init.body)) : null
      const user = { user_id: 'u-kurgu', email: 'kurgu@example.invalid', display_name: null, provider: 'password' }
      return path === '/auth/register'
        ? new Response(JSON.stringify(user), { status: 201, headers: { 'Content-Type': 'application/json' } })
        : new Response(null, { status: 204 })
    }))
    setLang('en')
    await register('kurgu@example.invalid', 'kurgu-parola-1')
    await resendVerification()
    await requestPasswordReset('kurgu@example.invalid')
    expect(bodies['/auth/register']).toMatchObject({ lang: 'en' })
    expect(bodies['/auth/verify-email/resend']).toEqual({ lang: 'en' })
    expect(bodies['/auth/password-reset/request']).toEqual({ email: 'kurgu@example.invalid', lang: 'en' })
  })
})

describe('R6.17 çeviri kapsam denetimi', () => {
  it('kamuya açık arayüzde sözlükte olmayan anahtar ve çevrilmemiş Türkçe dizgi yok', async () => {
    const path = '../../scripts/check-i18n.mjs'
    const { scan } = (await import(/* @vite-ignore */ path)) as {
      scan: () => { missingKeys: unknown[]; untranslated: unknown[]; keys: number; files: number }
    }
    const r = scan()
    expect(r.files).toBeGreaterThan(50)
    expect(r.missingKeys).toEqual([])
    expect(r.untranslated).toEqual([])
  }, 30_000)
})
