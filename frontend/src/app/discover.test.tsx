import { act, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(await screen.findByRole('link', { name: 'Kütahya: 1 eser' })).toHaveAttribute('href', '/oyun/rota/kutahya')
    expect(screen.getByRole('link', { name: 'Bursa: 3 eser' })).toHaveAttribute('href', '/oyun/rota/bursa')
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

describe('Oyun paneli ve gezinme', () => {
  const GAME = {
    monument_id: 'BUR-1009', locked: false, listened: true, asked: false, guide_required: true, ready_for_quiz: false,
    quiz_size: 5, pass_mark: 4, knowledge: null, visit: null, visit_radius_m: 50, simulated_visit_allowed: false, site_notice: null,
  }
  const mainNav = () => screen.getByRole('navigation', { name: 'Ana menü' })

  it('oyun girişi: devam eden görev, sıradaki adım, rozet ilerlemesi, oyunlara erişim ve keşfe dönüş', async () => {
    routes({ '/monuments/BUR-1009/game': { body: GAME } })
    open('/oyun')
    expect(await screen.findByRole('heading', { level: 1, name: 'Kayıp Vakfiye' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Oyun' })).toHaveAttribute('aria-current', 'page')
    const gameNav = screen.getByRole('navigation', { name: 'Oyun menüsü' })
    expect(within(gameNav).getByRole('link', { name: 'Oyun girişi' })).toHaveAttribute('aria-current', 'page')
    const quest = await screen.findByRole('region', { name: 'Devam eden görev' })
    expect(within(quest).getByRole('heading', { name: 'Koza Han' })).toBeInTheDocument()
    expect(await within(quest).findByText('Rehberin anlatımını dinle ve bir soru sor')).toBeInTheDocument()
    expect(within(quest).getByRole('link', { name: 'Göreve devam et' })).toHaveAttribute('href', '/oyun/eser/BUR-1009')
    expect(within(quest).getByRole('link', { name: 'Rotayı gör' })).toHaveAttribute('href', '/oyun/rota/bursa')
    expect(screen.getByRole('link', { name: /1 \/ 10 vakfiye parçası/ })).toHaveAttribute('href', '/pasaport')
    const games = within(screen.getByRole('region', { name: 'Oyunlar' })).getAllByRole('link')
    expect(games.map((a) => a.getAttribute('href'))).toEqual(['/oyun/rota/bursa', '/oyun/eser/BUR-1009', '/pasaport'])
    const exit = within(screen.getByRole('navigation', { name: 'Oyundan çık' }))
    expect(exit.getByRole('link', { name: 'Keşfe dön' })).toHaveAttribute('href', '/eserler')
    expect(exit.getByRole('link', { name: 'Haritaya dön' })).toHaveAttribute('href', '/harita')
  })

  it('rota oyun panelindedir; duraklar eserin mühür yoluna gider, oyun menüsünde "Rotam" etkin', async () => {
    routes()
    open('/oyun/rota/bursa')
    const next = await screen.findByRole('region', { name: 'Sıradaki durak' })
    expect(within(next).getByRole('link', { name: 'Mühür yoluna git' })).toHaveAttribute('href', '/oyun/eser/BUR-1009')
    expect(within(next).getByRole('link', { name: 'Eseri aç' })).toHaveAttribute('href', '/eser/BUR-1009')
    const stops = screen.getByRole('list', { name: 'Rota durakları' })
    expect(within(stops).getByRole('link', { name: /Koza Han/ })).toHaveAttribute('href', '/oyun/eser/BUR-1009')
    expect(within(screen.getByRole('navigation', { name: 'Oyun menüsü' })).getByRole('link', { name: 'Rotam' })).toHaveAttribute('aria-current', 'page')
    expect(window.localStorage.getItem('vakifname.gameCity')).toBe('bursa')
  })

  it('eski oyun adresleri oyun paneline yönlenir (paylaşılmış bağlantılar çalışır)', async () => {
    routes()
    const { unmount } = open('/rota/bursa')
    await screen.findByRole('region', { name: 'Sıradaki durak' })
    expect(window.location.pathname).toBe('/oyun/rota/bursa')
    unmount()
    open('/sehir')
    await screen.findByRole('heading', { name: 'Nereyi keşfetmek istersin?' })
    expect(window.location.pathname).toBe('/oyun/sehir')
  })

  it('eser sayfası Keşfet bölümündedir ve oyun kontrolü içermez', async () => {
    routes({ '/monuments/BUR-1001/game': { body: { ...GAME, monument_id: 'BUR-1001', knowledge: { earned_at: '2026-10-27T10:00:00Z' } } } })
    open('/eser/BUR-1001')
    expect(await screen.findByRole('heading', { level: 1, name: 'Bursa Ulu Camii' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Keşfet' })).toHaveAttribute('aria-current', 'page')
    const link = await screen.findByRole('region', { name: 'Bu eserin mühür yolu' })
    expect(within(link).getByText(/Bilgi mührünü aldın/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Konumumu doğrula' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Oyun menüsü' })).not.toBeInTheDocument()
  })

  it('oyun panelinde eserin mühür yolu: ziyaret uyarısı oyun adımlarından önce, esere ve rotaya bağlantı', async () => {
    routes({ '/monuments/BUR-1001/game': { body: { ...GAME, monument_id: 'BUR-1001' } } })
    open('/oyun/eser/BUR-1001')
    expect(await screen.findByRole('heading', { level: 1, name: 'Bursa Ulu Camii' })).toBeInTheDocument()
    const notice = screen.getByRole('complementary', { name: 'Ziyaret uyarısı' })
    const steps = await screen.findByRole('region', { name: 'Mühür yolu' })
    expect(notice.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: /Eserin hikâyesini ve kaynaklarını aç/ })).toHaveAttribute('href', '/eser/BUR-1001')
  })

  it('Keşfet ↔ Harita ↔ Oyun arasında gezinme; tarayıcının geri ve ileri tuşu çalışır', async () => {
    routes({ '/monuments/BUR-1009/game': { body: GAME } })
    open('/eserler')
    await screen.findByRole('heading', { name: 'Koza Han' })
    await userEvent.click(within(mainNav()).getByRole('link', { name: 'Harita' }))
    expect(window.location.pathname).toBe('/harita')
    expect(await screen.findByRole('heading', { level: 1, name: 'Eser haritası' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Harita' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(mainNav()).getByRole('link', { name: 'Oyun' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kayıp Vakfiye' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '← Keşfe dön' }))
    expect(window.location.pathname).toBe('/eserler')
    await act(async () => window.history.back())
    await waitFor(() => expect(window.location.pathname).toBe('/oyun'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kayıp Vakfiye' })).toBeInTheDocument()
    await act(async () => window.history.back())
    await waitFor(() => expect(window.location.pathname).toBe('/harita'))
    await act(async () => window.history.forward())
    await waitFor(() => expect(window.location.pathname).toBe('/oyun'))
  })

  it('Rehber sayfası eser seçmeden sorar (eser kimliği gönderilmez)', async () => {
    const fetchMock = routes({
      '/guide/status': { body: { enabled: true, configured: true } },
      '/guide/ask': {
        body: {
          question: 'Külliye nedir?', mode: 'fallback_search', status: 'answered', message: 'Bunu kaynaklarımda bulamadım.',
          sentences: [], facts: [], identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [],
          photo: null, search: null, fallback_reason: null, notice: '', usage: { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_ms: 1 },
        },
      },
    })
    open('/rehber')
    expect(await screen.findByRole('heading', { level: 1, name: 'Rehbere sor' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Rehber' })).toHaveAttribute('aria-current', 'page')
    const box = await screen.findByRole('textbox')
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, 'Külliye nedir?')
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByText('Bunu kaynaklarımda bulamadım.')).toBeInTheDocument()
    const ask = fetchMock.mock.calls.find(([u]) => String(u).includes('/guide/ask'))!
    expect(JSON.parse(String(ask[1]!.body))).not.toHaveProperty('monument_id')
  })
})

describe('oyun menüsü', () => {
  it('rota açılmadan eserin mühür yoluna gelinse de "Rotam" o eserin şehrine döner ve etkindir', async () => {
    routes({ '/monuments/BUR-1001/game': { body: { monument_id: 'BUR-1001', locked: false, listened: false, asked: false, guide_required: true,
      ready_for_quiz: false, quiz_size: 5, pass_mark: 4, knowledge: null, visit: null, visit_radius_m: 50, simulated_visit_allowed: false, site_notice: null } } })
    open('/oyun/eser/BUR-1001')
    const rotam = await within(await screen.findByRole('navigation', { name: 'Oyun menüsü' })).findByRole('link', { name: 'Rotam' })
    expect(rotam).toHaveAttribute('href', '/oyun/rota/bursa')
    expect(rotam).toHaveAttribute('aria-current', 'page')
  })
})
