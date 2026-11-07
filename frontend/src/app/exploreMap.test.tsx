import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch, SIGNED_IN, PROFILE } from '../test/fixtures'
import type { RouteResult } from './api'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import { addStop, loadPlan, MAX_STOPS, moveStop, removeStop } from './visitPlan'
import VakifnameApp from './VakifnameApp'

// R4: keşif haritası ve ziyaret rotası. Kurgusal kayıtlar (BUR-9xxx gerçek katalog kimliği değildir).
// Leaflet jsdom'da çalışmaz: harita, aldığı değerleri (nokta, sıra, seçili, odak, çizgi) gösteren yer tutucuyla değiştirilir.
vi.mock('./components/RouteMap', () => ({
  default: (p: {
    points: { id: string; name: string; label?: string; status?: string; order?: number; planned?: number }[]
    path?: [number, number][]; selectedId?: string | null; focusId?: string | null; onSelect?: (id: string) => void
  }) => (
    <div data-testid="map" data-selected={p.selectedId ?? ''} data-focus={p.focusId ?? ''} data-path={p.path?.length ?? 0}>
      <ul aria-label="Harita noktaları">
        {p.points.map((pt) => (
          <li key={pt.id}>
            <button type="button" onClick={() => p.onSelect?.(pt.id)}>
              {`İşaret: ${pt.label ?? pt.name} | durum=${pt.status ?? '-'} | sıra=${pt.order ?? '-'} | plan=${pt.planned ?? '-'}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
}))

const summary = (id: string, name: string, type: string, location: { latitude: number; longitude: number } | null = { latitude: 40.18, longitude: 29.06 }) => ({
  monument_id: id, name, alternative_names: [] as string[], type, city: 'Bursa', district: 'Osmangazi', address: `${name} adresi`,
  location: location && { ...location, accuracy_m: 20 }, checkin_available: false, fact_count: 1, game_fact_count: 1, image_count: 1,
  cover: { file: `${id}.jpeg`, attribution: `Fotoğraf: ${name} çekeni, CC BY-SA`, license: 'CC-BY-SA-4.0', title: null, source_url: null },
  lead: `${name} kısa giriş.`, illustration: 'representative_drawing',
})
const CATALOG = {
  published_count: 4, data_version: 't', generated_at: null,
  monuments: [
    summary('BUR-9001', 'Deneme Camii', 'cami', { latitude: 40.181, longitude: 29.061 }),
    summary('BUR-9002', 'Deneme Han', 'han', { latitude: 40.182, longitude: 29.062 }),
    summary('BUR-9003', 'Deneme Türbesi', 'türbe', { latitude: 40.183, longitude: 29.063 }),
    summary('BUR-9004', 'Konumsuz Hamam', 'hamam', null),
  ],
}
// Oyun rotası: 9002 açık (1. durak), 9003 kilitli (2. durak), 9001 bilgi mührü kazanılmış.
const ROUTE: RouteResult = {
  city: 'bursa', total: 10, completed_count: 1,
  start: { source: 'city_center', latitude: 40.1885, longitude: 29.061 },
  next: 'BUR-9002',
  stops: [
    { monument_id: 'BUR-9002', name: 'Deneme Han', type: 'han', latitude: 40.182, longitude: 29.062, state: 'unlocked', distance_m: 500, order: 1 },
    { monument_id: 'BUR-9003', name: 'Deneme Türbesi', type: 'türbe', latitude: 40.183, longitude: 29.063, state: 'locked', distance_m: 900, order: 2 },
  ],
  completed: [{ monument_id: 'BUR-9001', name: 'Deneme Camii', earned_at: '2026-10-27T10:00:00+00:00', visit: false }],
}
const DETAIL = {
  ...summary('BUR-9001', 'Deneme Camii', 'cami', { latitude: 40.181, longitude: 29.061 }), checkin: null, site_notice: null, images: [],
  facts: [{ fact_id: 'F1', title: 'Başlık', text: 'Yapıyı Deneme Bey yaptırdı.', category: 'construction', certainty: 'documented',
    source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 20, page_kind: 'physical' }, game_use: true }],
}

function open(path: string) {
  const fetchMock = stubFetch({
    '/auth/me': SIGNED_IN,
    '/player/profile': PROFILE,
    '/monuments': { body: CATALOG },
    '/monuments/BUR-9001': { body: DETAIL },
    '/route': { body: ROUTE },
    '/guide/status': { body: { enabled: false } },
  })
  window.history.replaceState(null, '', path)
  render(<VakifnameApp />)
  return fetchMock
}
const pins = async () => within(await screen.findByRole('list', { name: 'Harita noktaları' }))
const plan = () => screen.getByRole('region', { name: 'Ziyaret rotam' })
async function addToRoute(name: string) {
  await userEvent.click((await pins()).getByRole('button', { name: new RegExp(`İşaret: ${name}`) }))
  const card = (await screen.findByRole('heading', { level: 2, name })).closest('section')!
  await userEvent.click(within(card).getByRole('button', { name: 'Rotaya ekle' }))
}
const order = () => within(within(plan()).getByRole('list', { name: 'Ziyaret sırası' })).getAllByRole('listitem').map((li) => li.querySelector('a')!.textContent)

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('ziyaret planı (saf işlevler)', () => {
  it('ekler (tekrarsız, üst sınırlı), çıkarır, sırayı değiştirir; bozuk depolamada boş başlar', () => {
    expect(addStop(['a'], 'a')).toEqual(['a'])
    expect(addStop(['a'], 'b')).toEqual(['a', 'b'])
    expect(addStop(Array.from({ length: MAX_STOPS }, (_, i) => `x${i}`), 'y')).toHaveLength(MAX_STOPS)
    expect(removeStop(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(moveStop(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveStop(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveStop(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    window.localStorage.setItem('vakifname.visitPlan.v1', '{bozuk')
    expect(loadPlan()).toEqual([])
    window.localStorage.setItem('vakifname.visitPlan.v1', JSON.stringify(['a', 'a', 3, 'b']))
    expect(loadPlan()).toEqual(['a', 'b'])
  })
})

describe('keşif haritası (R4)', () => {
  it('yayımlanmış bütün konumlu eserler kilitsiz gösterilir; yalnızca kazanılmış mühür ve açıklama görünür', async () => {
    open('/harita')
    const list = await pins()
    expect(list.getAllByRole('listitem')).toHaveLength(3)  // konumsuz eser haritada yok
    expect(await list.findByText(/Deneme Camii \| durum=completed/)).toBeInTheDocument()  // mühür rota yanıtından gelir
    expect(list.queryByText(/durum=locked|durum=unlocked/)).not.toBeInTheDocument()
    expect(list.queryByText(/sıra=[0-9]/)).not.toBeInTheDocument()  // oyun rota sırası keşif haritasına taşınmaz
    const legend = screen.getByRole('list', { name: 'Harita açıklaması' })
    expect(within(legend).getByText('Rotandaki sıra')).toBeInTheDocument()
  })

  it('haritada eser seçilince adı, görseli, atfı ve eser sayfası bağlantısı açılır; odak karta geçer; adres güncellenir', async () => {
    open('/harita')
    await pins()
    expect(screen.getByText(/Haritada bir esere dokun/)).toBeInTheDocument()
    await userEvent.click((await pins()).getByRole('button', { name: /İşaret: Deneme Han/ }))
    const h2 = await screen.findByRole('heading', { level: 2, name: 'Deneme Han' })
    expect(h2).toHaveFocus()
    const card = h2.closest('section')!
    expect(within(card).getByAltText('Deneme Han görünümü')).toBeInTheDocument()
    expect(within(card).getByText('Fotoğraf: Deneme Han çekeni, CC BY-SA')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Eseri aç' })).toHaveAttribute('href', '/eser/BUR-9002')
    expect(window.location.search).toBe('?eser=BUR-9002')
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', 'BUR-9002')
    await userEvent.click(within(card).getByRole('button', { name: 'Seçimi kapat' }))
    expect(screen.queryByRole('heading', { level: 2, name: 'Deneme Han' })).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('haritaya erişemeyenler için aynı seçim "Haritadaki eserler" listesinden klavyeyle yapılır', async () => {
    open('/harita')
    await pins()
    const details = screen.getByText('Haritadaki eserler (3)').closest('details')!
    // <summary> tarayıcıda Enter/Boşluk ile açılır; jsdom bunu taklit etmediği için tıklanır.
    await userEvent.click(screen.getByText('Haritadaki eserler (3)'))
    expect(details).toHaveAttribute('open')
    within(details).getByRole('button', { name: 'Deneme Türbesi' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { level: 2, name: 'Deneme Türbesi' })).toHaveFocus()
    expect(within(details).getByRole('button', { name: 'Deneme Türbesi' })).toHaveAttribute('aria-current', 'true')
  })

  it('eser sayfasındaki "Haritada gör" haritayı o esere odaklanmış açar; odak çalınmaz', async () => {
    open('/eser/BUR-9001')
    expect(await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Haritada Gör' })
    expect(link).toHaveAttribute('href', '/harita?eser=BUR-9001')
    await userEvent.click(link)
    await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-focus', 'BUR-9001'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', 'BUR-9001')
    const h2 = screen.getByRole('heading', { level: 2, name: 'Deneme Camii' })
    expect(h2).not.toHaveFocus()
  })

  it('konumu olmayan eser adresten seçilirse kart açılır, haritada odaklanılmaz ve rotaya eklenemez', async () => {
    open('/harita?eser=BUR-9004')
    const card = (await screen.findByRole('heading', { level: 2, name: 'Konumsuz Hamam' })).closest('section')!
    expect(within(card).getByText('Bu eserin konumu haritada gösterilmiyor.')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Rotaya ekle' })).not.toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-focus', '')
  })
})

describe('ziyaret rotası (R4)', () => {
  it('birden çok eser seçilir; sıralı plan, haritada numara ve sıra çizgisi; mesafe/süre gösterilmez', async () => {
    const fetchMock = open('/harita')
    await pins()
    expect(within(plan()).getByText(/Henüz eser seçmedin/)).toBeInTheDocument()
    await addToRoute('Deneme Türbesi')
    await addToRoute('Deneme Camii')
    expect(order()).toEqual(['Deneme Türbesi', 'Deneme Camii'])
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Deneme Camii rotana eklendi (2. durak).')
    const list = await pins()
    expect(list.getByText(/Deneme Türbesi, rotanda 1\. durak \| .* plan=1/)).toBeInTheDocument()
    expect(await list.findByText(/Deneme Camii, rotanda 2\. durak \| durum=completed .* plan=2/)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-path', '2')
    expect(within(plan()).queryByText(/\d+\s?(m|km|dk|dakika)\b/)).not.toBeInTheDocument()
    expect(within(plan()).getByText(/Mesafe ve yürüme süresi gösterilmez/)).toBeInTheDocument()
    // Keşif rotası oyuna ve sunucuya yazılmaz.
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')).toHaveLength(0)
    expect(JSON.parse(window.localStorage.getItem('vakifname.visitPlan.v1')!)).toEqual(['BUR-9003', 'BUR-9001'])
  })

  it('sıra klavyeyle değişir (odak taşınan durakta kalır); çıkarma ve sıfırlama çalışır; odak kaybolmaz', async () => {
    open('/harita')
    await addToRoute('Deneme Camii')
    await addToRoute('Deneme Han')
    await addToRoute('Deneme Türbesi')
    expect(order()).toEqual(['Deneme Camii', 'Deneme Han', 'Deneme Türbesi'])
    const up = within(plan()).getByRole('button', { name: 'Deneme Türbesi: bir öne al' })
    up.focus()
    await userEvent.keyboard('{Enter}')
    expect(order()).toEqual(['Deneme Camii', 'Deneme Türbesi', 'Deneme Han'])
    expect(within(plan()).getByRole('button', { name: 'Deneme Türbesi: bir öne al' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(order()).toEqual(['Deneme Türbesi', 'Deneme Camii', 'Deneme Han'])
    // En başa gelince "öne al" kapanır; odak aynı durağın "arkaya al" düğmesine geçer.
    expect(within(plan()).getByRole('button', { name: 'Deneme Türbesi: bir öne al' })).toBeDisabled()
    expect(within(plan()).getByRole('button', { name: 'Deneme Türbesi: bir arkaya al' })).toHaveFocus()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Deneme Türbesi artık 1. durak.')

    await userEvent.click(within(plan()).getByRole('button', { name: 'Deneme Camii: rotadan çıkar' }))
    expect(order()).toEqual(['Deneme Türbesi', 'Deneme Han'])
    expect(within(plan()).getByRole('button', { name: 'Deneme Han: rotadan çıkar' })).toHaveFocus()

    await userEvent.click(within(plan()).getByRole('button', { name: 'Rotayı sıfırla' }))
    expect(within(plan()).getByText(/Henüz eser seçmedin/)).toBeInTheDocument()
    expect(within(plan()).getByRole('heading', { name: 'Ziyaret rotam' })).toHaveFocus()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Rota sıfırlandı.')
    expect(screen.getByTestId('map')).toHaveAttribute('data-path', '0')
  })

  it('karttaki düğme seçili eseri rotadan çıkarır; plan sayfa yenilense de bu tarayıcıda kalır', async () => {
    open('/harita')
    await addToRoute('Deneme Han')
    const card = screen.getByRole('heading', { level: 2, name: 'Deneme Han' }).closest('section')!
    expect(within(card).getByRole('button', { name: 'Rotadan çıkar' })).toBeInTheDocument()
    await addToRoute('Deneme Camii')
    expect(loadPlan()).toEqual(['BUR-9002', 'BUR-9001'])
  })

  it('oyun rotası değişmez: sıra, kilit ve "Rota durakları" aynı; keşif planı oyun ekranında görünmez', async () => {
    window.localStorage.setItem('vakifname.visitPlan.v1', JSON.stringify(['BUR-9003', 'BUR-9001']))
    open('/oyun/rota/bursa')
    const stops = await screen.findByRole('list', { name: 'Rota durakları' })
    const items = within(stops).getAllByRole('listitem')
    expect(items.slice(0, 2).map((li) => li.textContent)).toEqual([expect.stringContaining('Deneme Han'), expect.stringContaining('Deneme Türbesi')])
    expect(within(items[1]).getByText('Henüz keşfedilmedi')).toBeInTheDocument()  // R6.7: kilit yok
    const list = await pins()
    expect(list.getByText(/Deneme Türbesi \| durum=locked \| sıra=2 \| plan=-/)).toBeInTheDocument()
    expect(list.getByText(/Deneme Han \| durum=unlocked \| sıra=1 \| plan=-/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Ziyaret rotam' })).not.toBeInTheDocument()
  })
})
