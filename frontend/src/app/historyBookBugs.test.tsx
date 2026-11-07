import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import VakifnameApp from './VakifnameApp'

// R3.8: tarayıcıda bildirilen Tarih Defteri hataları (kapanmıyor; sonraki/önceki çalışmıyor). Uygulama geliştirmede
// StrictMode altında çalışır (main.tsx); testler bunu birebir taklit eder. Kurgusal kayıtlar (BUR-9xxx).
const fact = (n: number) => ({
  fact_id: `BUR-9001-F00${n}`, title: `Kayıt ${n}`, text: `Kayıt ${n} metni.`, category: 'construction', certainty: 'documented',
  source: { title: 'Bursa Vakıf Eserleri / Foundation Buildings of Bursa, Cilt I (Nisan 2026)', pdf_physical_page: 20 + n, page_kind: 'physical' },
  game_use: false,
})
const DETAIL = {
  monument_id: 'BUR-9001', name: 'Deneme Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
  address: 'Deneme adresi', location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20, represents: 'building_footprint_centroid' },
  checkin_available: false, checkin: null, site_notice: null, illustration: 'representative_drawing',
  facts: [fact(1), fact(2), fact(3)], images: [],
}

function open() {
  stubFetch({
    '/auth/me': { status: 401, body: {} }, '/monuments/BUR-9001': { body: DETAIL }, '/guide/status': { body: { enabled: false } },
  })
  window.history.replaceState(null, '', '/eser/BUR-9001')
  return render(<StrictMode><VakifnameApp /></StrictMode>)
}
const bookBtn = () => screen.getByRole('button', { name: /Tarih Defteri/ })
const book = () => screen.getByRole('dialog', { name: 'Tarih Defteri' })
const title = () => within(book()).getByRole('heading', { level: 3 }).textContent

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('Tarih Defteri (StrictMode, gerçek kullanıcı akışı)', () => {
  it('açılır ve kapanır; odak açan düğmeye döner', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(bookBtn())
    expect(title()).toBe('Kayıt 1')
    await userEvent.click(within(book()).getByRole('button', { name: 'Defteri kapat' }))
    expect(screen.queryByRole('dialog', { name: 'Tarih Defteri' })).not.toBeInTheDocument()
    expect(bookBtn()).toHaveFocus()
  })

  it('Kayıt 1 → 2 → 3, sonra son kayıttan önceki kayda dönülür', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(bookBtn())
    await userEvent.click(within(book()).getByRole('button', { name: 'Sonraki kayıt' }))
    expect(title()).toBe('Kayıt 2')
    await userEvent.click(within(book()).getByRole('button', { name: 'Sonraki kayıt' }))
    expect(title()).toBe('Kayıt 3')
    await userEvent.click(within(book()).getByRole('button', { name: 'Önceki kayıt' }))
    expect(title()).toBe('Kayıt 2')
  })

  it('yön tuşları, düğmeye tıkladıktan sonra da çalışır', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(bookBtn())
    await userEvent.click(within(book()).getByRole('button', { name: 'Sonraki kayıt' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(title()).toBe('Kayıt 3')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(title()).toBe('Kayıt 1')
  })

  it('defter ve rehber arasında geçiş hatalı durum bırakmaz; defter yeniden açılınca ilk kayıttan başlar', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(bookBtn())
    await userEvent.click(within(book()).getByRole('button', { name: 'Sonraki kayıt' }))
    await userEvent.click(within(book()).getByRole('button', { name: 'Defteri kapat' }))
    // Rehber açıkken defter açılır: rehber kapanır (modal defter açıkken arka plandaki rehber düğmesine basılamaz).
    await userEvent.click(screen.getByRole('button', { name: 'Rehbere Sor' }))
    expect(screen.getByRole('button', { name: 'Rehbere Sor' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(bookBtn())
    expect(screen.getByRole('button', { name: 'Rehbere Sor' })).toHaveAttribute('aria-expanded', 'false')
    expect(title()).toBe('Kayıt 1')
    await userEvent.click(within(book()).getByRole('button', { name: 'Sonraki kayıt' }))
    expect(title()).toBe('Kayıt 2')
    await userEvent.click(within(book()).getByRole('button', { name: 'Defteri kapat' }))
    expect(screen.queryByRole('dialog', { name: 'Tarih Defteri' })).not.toBeInTheDocument()
  })

  it('gerçek neden (R3.7–R3.8): eser sayfası, ana sayfa hikâyesinin sabit ve tıklanamaz ".vk-stage" sınıfını kullanmaz', async () => {
    // story.css: .vk-stage { position: fixed; inset: 0; pointer-events: none } — her sayfada yüklüdür. Defter bu sınıfı
    // taşıyan bir bölümde açılınca tüm ekranı kaplıyor ve "Defteri kapat" / "Sonraki kayıt" tıklamaları düğmelere
    // ulaşmıyordu (jsdom stil uygulamadığı için testler bunu görmüyordu).
    open()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(bookBtn())
    expect(document.querySelector('.vk-stage')).toBeNull()
    expect(book().closest('.vk-stage')).toBeNull()
  })
})

