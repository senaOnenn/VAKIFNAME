import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { getLang, resetLangForTests, translate } from './i18n'
import { EN } from './i18n-en'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import VakifnameApp from './VakifnameApp'

const CATALOG = { published_count: 0, data_version: 'test', generated_at: null, monuments: [] }

function setBrowserLanguages(langs: string[]) {
  Object.defineProperty(window.navigator, 'languages', { value: langs, configurable: true })
  Object.defineProperty(window.navigator, 'language', { value: langs[0], configurable: true })
  resetLangForTests()
}

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  stubFetch({ '/auth/me': { status: 401, body: { detail: 'Oturum açık değil.' } }, '/monuments': { body: CATALOG } })
})
afterEach(() => {
  setBrowserLanguages(['tr-TR', 'tr'])
  vi.unstubAllGlobals()
})

describe('arayüz dili', () => {
  it('kayıtlı seçim yoksa tarayıcı diline göre başlar (en* → İngilizce, aksi Türkçe)', async () => {
    setBrowserLanguages(['en-GB', 'en'])
    expect(getLang()).toBe('en')
    open('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Discover the Past, Keep the Heritage Alive.' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    setBrowserLanguages(['de-DE', 'fr'])
    expect(getLang()).toBe('tr')
  })

  it('kayıtlı seçim tarayıcı dilinden önce gelir', async () => {
    window.localStorage.setItem('vakifname.lang', 'en')
    resetLangForTests() // bellekteki dili unutur; kayıtlı seçim silinmesin diye yeniden yazılır
    window.localStorage.setItem('vakifname.lang', 'en')
    expect(getLang()).toBe('en')
    open('/giris')
    expect(await screen.findByRole('heading', { name: 'Join the journey' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explore without an account' })).toBeInTheDocument()
  })

  it('TR | EN seçici tanıtımı, girişi ve menüyü anında çevirir ve seçimi saklar', async () => {
    open('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Geçmişi Keşfet, Mirası Yaşat.' })).toBeInTheDocument()
    const sw = screen.getByRole('group', { name: 'Dil' })
    expect(within(sw).getByRole('button', { name: 'TR – Türkçe' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(sw).getByRole('button', { name: 'EN – English' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Discover the Past, Keep the Heritage Alive.' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Start exploring' }).length).toBeGreaterThan(0)
    expect(window.localStorage.getItem('vakifname.lang')).toBe('en')
    expect(document.documentElement.lang).toBe('en')

    await userEvent.click(screen.getByRole('link', { name: 'Enter the app' }))
    expect(window.location.pathname).toBe('/eserler')
    expect(await screen.findByRole('heading', { level: 1, name: 'Monuments' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main menu' })
    expect(within(nav).getByRole('link', { name: 'Explore' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Seals' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Game' })).toBeInTheDocument()
    expect(screen.getByText('Guest')).toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'TR – Türkçe' }))
    expect(within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', { name: 'Keşfet' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('tr')
  })

  it('karşılığı olmayan metin Türkçe kalır; yer tutucu ve tekil/çoğul', () => {
    expect(translate('en', 'Sözlükte olmayan bir cümle.')).toBe('Sözlükte olmayan bir cümle.')
    expect(translate('en', '{n} eser', { n: 1 })).toBe('1 monument')
    expect(translate('en', '{n} eser', { n: 10 })).toBe('10 monuments')
    expect(translate('tr', '{n} eser', { n: 10 })).toBe('10 eser')
    expect(translate('en', 'Kaynak: {title}, s. {page}', { title: 'Cilt I', page: 20 })).toBe('Source: Cilt I, p. 20')
  })

  it('görünür İngilizce metinde oyun kuralına aykırı kelime yok ("exam", "quiz", "demo")', () => {
    const bad = Object.values(EN).filter((v) => /\b(exam|quiz|demo)\b/i.test(v))
    expect(bad).toEqual([])
  })
})
