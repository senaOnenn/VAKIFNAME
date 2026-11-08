import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { progressOf, SIGNED_IN, stubFetch, type Routes } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { resetAuthForTests } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

/** R6.4: XP ve seviye sunucudan gelir; arayüz yalnızca gösterir (sahte XP yok) ve artışta kısa bir not verir. */
const CATALOG = { body: { published_count: 0, data_version: 't', generated_at: null, monuments: [] } }
const profile = (progress: unknown, id = 'kadin') => ({ body: { character: { id, chosen_at: '2026-11-01T10:00:00+00:00' }, progress } })

function open(path: string, routes: Routes) {
  const f = stubFetch({ '/auth/me': SIGNED_IN, '/monuments': CATALOG, ...routes })
  window.history.replaceState(null, '', path)
  render(<VakifnameApp />)
  return f
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('XP ve seviye (R6.4)', () => {
  it('seviye, kozmetik aşama ve XP sunucudan gelir; seviye ilerlemesi erişilebilir bir göstergeyle söylenir', async () => {
    open('/oyun/sehir', { '/player/profile': profile(progressOf(205, 3, 150, 300, 'gezginlik')) })
    expect(await screen.findByText(/Seviye 3/)).toBeInTheDocument()
    expect(screen.getByText(/Gezgin Seyyah/)).toBeInTheDocument()
    expect(screen.getByText('205 / 300 XP')).toBeInTheDocument()
    const meter = screen.getByRole('progressbar', { name: 'Seviye 4 için ilerleme: 55 / 150 XP' })
    expect(meter).toHaveAttribute('max', '150')
    expect(meter).toHaveAttribute('value', '55')
    // Karakterin görünümü (geçici amblem) hesaplanan aşamaya bağlıdır.
    expect(document.querySelector('.vk-gamebar__portrait')).toHaveAttribute('data-stage', 'gezginlik')
    expect(screen.getByRole('link', { name: 'Kâşifin Kadın kâşif. Kâşifini değiştir' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /XP/ })).toBeNull()
  })

  it('en üst seviyede eşik yerine "en üst seviye" yazar; aşama Başkâşif', async () => {
    open('/oyun/sehir', { '/player/profile': profile(progressOf(1825, 8, 1500, null, 'muhafiz')) })
    expect(await screen.findByText('1825 XP · en üst seviye')).toBeInTheDocument()
    expect(screen.getByText(/Başkâşif/)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(document.querySelector('.vk-gamebar__portrait')).toHaveAttribute('data-stage', 'muhafiz')
  })

  it('XP sunucuda artınca kısa bir ödül notu çıkar (neden ve yeni seviye); ilk açılışta not yok', async () => {
    let xp = 35
    open('/oyun/sehir', {
      '/player/profile': () => xp === 35
        ? profile(progressOf(35, 1, 0, 50, 'baslangic', [{ source: 'listened', monument_id: 'BUR-9001', amount: 10, earned_at: 't' }]))
        : profile(progressOf(85, 2, 50, 150, 'baslangic', [{ source: 'knowledge', monument_id: 'BUR-9001', amount: 50, earned_at: 't' }])),
    })
    expect(await screen.findByText('35 / 50 XP')).toBeInTheDocument()
    const note = document.querySelector('.vk-xptoast')!
    expect(note).toHaveAttribute('hidden')
    xp = 85 // sunucu bir görevi doğruladı (ör. bilgi mührü)
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Oyun menüsü' })).getByRole('link', { name: 'Vakfiye Odası' }))
    await waitFor(() => expect(note).not.toHaveAttribute('hidden'))
    expect(note).toHaveAttribute('role', 'status')
    expect(note).toHaveTextContent('+50 XP · Bilgi mührü · Yeni seviye: 2')
    expect(screen.getAllByText('85 / 150 XP').length).toBeGreaterThan(0) // oyun şeridi ve Keşif Masası künyesi
  })

  it('profil yüklenemezse sahte XP veya seviye gösterilmez', async () => {
    open('/oyun/sehir', { '/player/profile': { status: 503, body: { detail: 'Geçici hata' } } })
    expect(await screen.findByText(/Oyuncu bilgileri alınamadı; yeniden dene/)).toBeInTheDocument()
    expect(screen.queryByText(/Seviye \d/)).not.toBeInTheDocument()
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('istemci XP göndermez: oyuncu uçlarına yalnızca okuma ve karakter seçimi gider', async () => {
    const f = open('/oyun/sehir', { '/player/profile': profile(progressOf(10, 1, 0, 50)) })
    await screen.findByText('10 / 50 XP')
    const writes = f.mock.calls.filter((c) => new URL(String(c[0])).pathname.startsWith('/player/') && ((c[1] as RequestInit | undefined)?.method ?? 'GET') !== 'GET')
    expect(writes).toEqual([])
  })
})
