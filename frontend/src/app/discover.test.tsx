import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import type { RouteResult } from './api'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'

// Leaflet jsdom'da çalışmaz: harita, noktaları liste olarak gösteren yer tutucuyla değiştirilir.
vi.mock('./components/RouteMap', () => ({
  default: ({ points, onSelect }: { points: { id: string; name: string; status?: string; order?: number }[]; onSelect?: (id: string) => void }) => (
    <ul aria-label="Harita noktaları">
      {points.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onSelect?.(p.id)}>
            Harita: {p.name} ({p.status ?? '-'})
          </button>
        </li>
      ))}
    </ul>
  ),
}))

const loc = (lat: number, lng: number) => ({ latitude: lat, longitude: lng, accuracy_m: 20 })
const summary = (id: string, name: string, type: string, lat: number, lng: number) => ({
  monument_id: id, name, alternative_names: [], type, city: 'Bursa', district: 'Osmangazi', address: `${name} adresi`,
  location: loc(lat, lng), checkin_available: false, fact_count: 2, game_fact_count: 1, image_count: 1,
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
const ROUTE: RouteResult = {
  city: 'bursa', total: 10, completed_count: 1,
  start: { source: 'city_center', latitude: 40.1885, longitude: 29.061 },
  next: 'BUR-1009',
  stops: [
    { monument_id: 'BUR-1009', name: 'Koza Han', type: 'han', latitude: 40.1844, longitude: 29.0635, state: 'unlocked', distance_m: 512, order: 1 },
    { monument_id: 'BUR-1019', name: 'Osman Gazi Türbesi', type: 'türbe', latitude: 40.1868, longitude: 29.0574, state: 'locked', distance_m: 1480, order: 2 },
  ],
  completed: [{ monument_id: 'BUR-1001', name: 'Bursa Ulu Camii', earned_at: '2026-10-27T10:00:00+00:00', visit: false }],
}
const DETAIL = {
  monument_id: 'BUR-1001', name: 'Bursa Ulu Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
  address: 'Atatürk Caddesi, Osmangazi/Bursa', location: { ...loc(40.1839, 29.0619), represents: 'building_footprint_centroid' },
  checkin_available: false, checkin: null, site_notice: 'Aktif ibadet mekânıdır; sessiz olun.', illustration: 'representative_drawing',
  facts: [
    { fact_id: 'F1', title: 'Yirmi kubbe', text: 'Yapıyı yirmi kubbe örter.', category: 'architecture', certainty: 'documented',
      source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 21, page_kind: 'physical' }, game_use: true },
    { fact_id: 'F2', title: 'Bir rivayet', text: 'Halk arasında anlatılır.', category: 'historical_event', certainty: 'reported',
      source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 22, page_kind: 'physical' }, game_use: false },
  ],
  images: [{ image_id: 'i1', file: 'a.jpeg', card_file: 'a-card.jpeg', rights_holder: 'Ali Veli', license: 'CC-BY-SA-4.0',
    attribution: 'Fotoğraf: Ali Veli, CC BY-SA 4.0, Wikimedia Commons', game_use: true, license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
}

function routes(overrides: Record<string, unknown> = {}) {
  return stubFetch({
    '/auth/me': { status: 401, body: { detail: 'Oturum açık değil.' } },
    '/monuments': { body: CATALOG },
    '/monuments/BUR-1001': { body: DETAIL },
    '/route': { body: ROUTE },
    ...(overrides as Record<string, never>),
  })
}

function open(path: string) {
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

describe('Eserler sayfası', () => {
  it('eserleri durum rozetleri ve görsel atfıyla listeler; türe göre süzer', async () => {
    routes()
    open('/eserler')
    expect(await screen.findByRole('heading', { name: 'Koza Han' })).toBeInTheDocument()
    expect(screen.getByText('3 eser')).toBeInTheDocument()
    expect(screen.getByText('Fotoğraf: Koza Han çekeni, CC BY-SA')).toBeInTheDocument()
    expect(await screen.findByText('Bilgi mührü')).toBeInTheDocument()
    expect(screen.getByText('Kilitli')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Eser türü' })).getByRole('button', { name: 'Türbe' }))
    expect(screen.getByText('1 eser')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Koza Han' })).not.toBeInTheDocument()
  })

  it('harita görünümüne geçer; haritadaki esere dokununca eser sayfası açılır', async () => {
    routes()
    open('/eserler')
    await screen.findByRole('heading', { name: 'Koza Han' })
    await userEvent.click(screen.getByRole('button', { name: 'Harita' }))
    await userEvent.click(await screen.findByRole('button', { name: /Harita: Bursa Ulu Camii/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Bursa Ulu Camii' })).toBeInTheDocument()
  })

  it('rota yüklenemese de eserler listelenir (rozetsiz)', async () => {
    routes({ '/route': { status: 500, body: { detail: 'hata' } } })
    open('/eserler')
    expect(await screen.findByRole('heading', { name: 'Koza Han' })).toBeInTheDocument()
    expect(screen.queryByText('Kilitli')).not.toBeInTheDocument()
  })
  it('birden çok şehirde her şehrin kilidi kendi rotasından gelir', async () => {
    const kut = { ...summary('KUT-1001', 'Kurşunlu Camii', 'cami', 39.42, 29.98), city: 'Kütahya' }
    const fetchMock = routes({ '/monuments': { body: { ...CATALOG, published_count: 4, monuments: [...CATALOG.monuments, kut] } } })
    open('/eserler')
    expect(await screen.findByRole('heading', { name: 'Kurşunlu Camii' })).toBeInTheDocument()
    await screen.findByText('Kilitli')
    const cities = fetchMock.mock.calls.map(([u]) => new URL(String(u)).searchParams.get('city')).filter(Boolean)
    expect(new Set(cities)).toEqual(new Set(['bursa', 'kutahya']))
  })
})

describe('Şehir seçimi', () => {
  it('katalogda eseri olan şehir açılır ve eser sayısını gösterir', async () => {
    const kut = { ...summary('KUT-1001', 'Kurşunlu Camii', 'cami', 39.42, 29.98), city: 'Kütahya' }
    routes({ '/monuments': { body: { ...CATALOG, published_count: 4, monuments: [...CATALOG.monuments, kut] } } })
    open('/sehir')
    expect(await screen.findByRole('link', { name: 'Kütahya: 1 eser' })).toHaveAttribute('href', '/rota/kutahya')
    expect(screen.getByRole('link', { name: 'Bursa: 3 eser' })).toHaveAttribute('href', '/rota/bursa')
    expect(within(screen.getByRole('list', { name: 'Şehirler' })).getAllByRole('link')).toHaveLength(2)
  })
})

describe('Rota sayfası', () => {
  it('vakfiye ilerlemesini, sıradaki durağı, sıralı durakları ve bulunan parçaları gösterir', async () => {
    const fetchMock = routes()
    open('/rota/bursa')
    expect(await screen.findByText('1 / 10 vakfiye parçası')).toBeInTheDocument()
    const next = screen.getByRole('region', { name: 'Sıradaki durak' })
    expect(within(next).getByRole('heading', { name: 'Koza Han' })).toBeInTheDocument()
    expect(within(next).getByText(/şehir merkezi noktasından 510 m/)).toBeInTheDocument()
    const stops = screen.getByRole('list', { name: 'Rota durakları' })
    expect(within(stops).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Koza Han'), expect.stringContaining('Osman Gazi Türbesi'),
    ])
    expect(within(screen.getByRole('region', { name: 'Bulunan parçalar' })).getByText('Bursa Ulu Camii')).toBeInTheDocument()
    const url = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/route'))![0]))
    expect(url.searchParams.get('city')).toBe('bursa')
    expect(url.searchParams.get('user_id')).toMatch(/^ziyaretci-/)
  })

  it('"Konumumu kullan" rotayı kullanıcının konumuyla yeniden ister', async () => {
    const fetchMock = routes()
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 40.19, longitude: 29.05 } } as GeolocationPosition) },
    })
    open('/rota/bursa')
    await screen.findByText('1 / 10 vakfiye parçası')
    await userEvent.click(screen.getByRole('button', { name: 'Konumumu kullan' }))
    expect(await screen.findByText('Rota konumuna göre güncellendi.')).toBeInTheDocument()
    const last = new URL(String(fetchMock.mock.calls.filter(([u]) => String(u).includes('/route')).at(-1)![0]))
    expect(last.searchParams.get('lat')).toBe('40.190000')
    expect(last.searchParams.get('lng')).toBe('29.050000')
  })

  it('hesaplı kullanıcıda rota hesap kimliğiyle ve çerezle istenir', async () => {
    const fetchMock = routes({ '/auth/me': { body: { user_id: 'u-1', email: 'a@b.co', display_name: null, provider: 'password' } } })
    window.localStorage.removeItem('vakifname.guest')
    open('/rota/bursa')
    await screen.findByText('1 / 10 vakfiye parçası')
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/route'))!
    expect(new URL(String(call[0])).searchParams.get('user_id')).toBe('u-1')
    expect(call[1]).toMatchObject({ credentials: 'include' })
  })

  it('eski /bursa adresi rotaya yönlenir', async () => {
    routes()
    open('/bursa')
    expect(await screen.findByRole('heading', { name: 'Bursa rotası' })).toBeInTheDocument()
  })
})

describe('Eser sayfası', () => {
  it('kaynaklı bilgileri kesinlik etiketiyle, ziyaret uyarısını ve görsel atıflarını gösterir', async () => {
    routes()
    open('/eser/BUR-1001')
    expect(await screen.findByRole('heading', { level: 1, name: 'Bursa Ulu Camii' })).toBeInTheDocument()
    expect(screen.getByText('Aktif ibadet mekânıdır; sessiz olun.')).toBeInTheDocument()
    const facts = screen.getByRole('region', { name: 'Tarihçe ve kaynaklar' })
    expect(within(facts).getByText('Kaynaklarda belgelenmiş')).toBeInTheDocument()
    expect(within(facts).getByText('Aktarılan bilgi (rivayet)')).toBeInTheDocument()
    expect(within(facts).getByText(/Kaynak: Bursa Vakıf Eserleri, Cilt I, s\. 21/)).toBeInTheDocument()
    expect(screen.getAllByText(/Fotoğraf: Ali Veli/).length).toBeGreaterThan(0)
    expect(await screen.findByText('Bilgi mührü')).toBeInTheDocument()
  })

  it('bulunamayan eserde anlaşılır hata ve geri dönüş verir', async () => {
    routes()
    open('/eser/BUR-1999')
    expect(await screen.findByText('Eser bulunamadı veya yüklenemedi.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Eserlere dön' })).toHaveAttribute('href', '/eserler')
  })
})
