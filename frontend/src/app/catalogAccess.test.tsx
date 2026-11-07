import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch, SIGNED_IN, PROFILE } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import type { RouteResult } from './api'
import { sealOnly } from './components/StatusBadge'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'

// R1: keşif ekranları (Keşfet, Harita, eser sayfası) rota kilidini göstermez; oyun paneli göstermeye devam eder.
// Leaflet jsdom'da çalışmaz: harita, noktaları ve durumlarını liste olarak gösteren yer tutucuyla değiştirilir.
vi.mock('./components/RouteMap', () => ({
  default: ({ points }: { points: { id: string; name: string; status?: string; order?: number }[] }) => (
    <ul aria-label="Harita noktaları">
      {points.map((p) => <li key={p.id}>{`${p.name} | durum=${p.status ?? '-'} | sıra=${p.order ?? '-'}`}</li>)}
    </ul>
  ),
}))

const loc = (lat: number, lng: number) => ({ latitude: lat, longitude: lng, accuracy_m: 20 })
const summary = (id: string, name: string, type: string, lat: number, lng: number) => ({
  monument_id: id, name, alternative_names: [], type, city: 'Bursa', district: 'Osmangazi', address: `${name} adresi`,
  location: loc(lat, lng), checkin_available: false, fact_count: 1, game_fact_count: 1, image_count: 1,
  cover: { file: `${id}.jpeg`, attribution: `Fotoğraf: ${name} çekeni, CC BY-SA`, license: 'CC-BY-SA-4.0', title: null, source_url: null },
  lead: `${name} kısa giriş.`, illustration: 'representative_drawing',
})
const CATALOG = {
  published_count: 3, data_version: 'test', generated_at: null,
  monuments: [
    summary('BUR-1001', 'Bursa Ulu Camii', 'cami', 40.1839, 29.0619),
    summary('BUR-1009', 'Koza Han', 'han', 40.1844, 29.0635),
    summary('BUR-1019', 'Osman Gazi Türbesi', 'türbe', 40.1868, 29.0574),
  ],
}
// Rota: Koza Han açık (sıradaki), Osman Gazi Türbesi kilitli, Ulu Cami'nin bilgi mührü alınmış.
const ROUTE: RouteResult = {
  city: 'bursa', total: 3, completed_count: 1, start: { source: 'city_center', latitude: 40.1885, longitude: 29.061 }, next: 'BUR-1009',
  stops: [
    { monument_id: 'BUR-1009', name: 'Koza Han', type: 'han', latitude: 40.1844, longitude: 29.0635, state: 'unlocked', distance_m: 512, order: 1 },
    { monument_id: 'BUR-1019', name: 'Osman Gazi Türbesi', type: 'türbe', latitude: 40.1868, longitude: 29.0574, state: 'locked', distance_m: 1480, order: 2 },
  ],
  completed: [{ monument_id: 'BUR-1001', name: 'Bursa Ulu Camii', earned_at: '2026-10-27T10:00:00+00:00', visit: false }],
}
const detail = (id: string, name: string) => ({
  monument_id: id, name, alternative_names: [], type: 'türbe', city: 'Bursa', district: 'Osmangazi', address: `${name} adresi`,
  location: { ...loc(40.18, 29.06), represents: 'building_footprint_centroid' }, checkin_available: false, checkin: null,
  site_notice: null, illustration: 'representative_drawing', facts: [],
  images: [{ image_id: 'i1', file: 'a.jpeg', card_file: 'a-card.jpeg', rights_holder: 'Ali Veli', license: 'CC-BY-SA-4.0',
    attribution: 'Fotoğraf: Ali Veli, CC BY-SA 4.0', game_use: true, license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
})

function open(path: string) {
  stubFetch({
    '/auth/me': SIGNED_IN,
    '/player/profile': PROFILE,
    '/monuments': { body: CATALOG },
    '/route': { body: ROUTE },
    '/monuments/BUR-1019': { body: detail('BUR-1019', 'Osman Gazi Türbesi') },
    '/monuments/BUR-1001': { body: detail('BUR-1001', 'Bursa Ulu Camii') },
  })
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('R1: keşif erişimi oyun kilidinden ayrı', () => {
  it('sealOnly yalnızca kazanılmış mühürü geçirir', () => {
    expect([sealOnly('locked'), sealOnly('unlocked'), sealOnly(undefined)]).toEqual([undefined, undefined, undefined])
    expect([sealOnly('completed'), sealOnly('gold')]).toEqual(['completed', 'gold'])
  })

  it('Keşfet: kilitli eser kartı karartılmaz; kart bağlantısı adıyla erişilir, görsel süs olarak işaretlidir', async () => {
    open('/eserler')
    const heading = await screen.findByRole('heading', { name: 'Osman Gazi Türbesi' })
    await screen.findByText('Bilgi mührü')  // rota yüklendi; mühür ayrı gösterilir
    const card = heading.closest('article')!
    expect(card).not.toHaveClass('vk-mcard--locked')
    expect(within(card).queryByText('Kilitli')).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Osman Gazi Türbesi/ })).toHaveAttribute('href', '/eser/BUR-1019')
    const img = card.querySelector('img')!
    expect(img).toHaveAttribute('alt', '')  // ad başlıkta; görsel süs
    expect(img.getAttribute('src')).toContain('BUR-1019.jpeg')
    expect(within(card).getByText('Fotoğraf: Osman Gazi Türbesi çekeni, CC BY-SA')).toBeInTheDocument()
  })

  it('Harita: işaretlere kilit durumu gitmez; kazanılmış mühür gider', async () => {
    open('/harita')
    const pts = await screen.findByRole('list', { name: 'Harita noktaları' })
    await within(pts).findByText(/Bursa Ulu Camii \| durum=completed/)
    expect(within(pts).getByText(/Osman Gazi Türbesi \| durum=-/)).toBeInTheDocument()
    expect(within(pts).getByText(/Koza Han \| durum=-/)).toBeInTheDocument()
    expect(within(pts).queryByText(/durum=locked|durum=unlocked/)).not.toBeInTheDocument()
  })

  it('Eser sayfası: rotada kilitli eserin künyesinde kilit etiketi yok; büyük kapak fotoğrafı yok (R6.10)', async () => {
    open('/eser/BUR-1019')
    expect(await screen.findByRole('heading', { level: 1, name: 'Osman Gazi Türbesi' })).toBeInTheDocument()
    expect(screen.queryByAltText('Osman Gazi Türbesi görünümü')).not.toBeInTheDocument()
    await screen.findByRole('button', { name: /Fotoğraf Arşivi/ })
    expect(screen.queryByText('Kilitli')).not.toBeInTheDocument()
  })

  it('Eser sayfası: kazanılmış bilgi mührü künyede görünür', async () => {
    open('/eser/BUR-1001')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Bursa Ulu Camii' })
    expect(await within(h1.parentElement!).findByText('Bilgi mührü')).toBeInTheDocument()
  })

  it('Oyun paneli: rota sırası ve kilit durumu değişmeden gösterilir', async () => {
    open('/oyun/rota/bursa')
    const stops = await screen.findByRole('list', { name: 'Rota durakları' })
    const items = within(stops).getAllByRole('listitem')
    expect(items.slice(0, 2).map((li) => li.textContent)).toEqual([expect.stringContaining('Koza Han'), expect.stringContaining('Osman Gazi Türbesi')])
    expect(within(items[1]).getByText('Henüz keşfedilmedi')).toBeInTheDocument()  // R6.7: kilit yok
    const pts = await screen.findByRole('list', { name: 'Harita noktaları' })  // harita tembel yüklenir
    expect(within(pts).getByText(/Osman Gazi Türbesi \| durum=locked \| sıra=2/)).toBeInTheDocument()
  })

  it('Keşfet → harita → eser: karttan esere geçiş klavyeyle çalışır', async () => {
    open('/eserler')
    const link = within((await screen.findByRole('heading', { name: 'Osman Gazi Türbesi' })).closest('article')!).getByRole('link')
    link.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { level: 1, name: 'Osman Gazi Türbesi' })).toBeInTheDocument()
  })
})
