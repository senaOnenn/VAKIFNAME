import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { API_BASE_URL } from './api/client'
import type { PlaceMapProps } from './components/PlaceMap'
import { PLACES, placeRoutes, stubFetch } from './test/fixtures'

// Leaflet jsdom'da ayrıca test edilir (PlaceMap.test.tsx); burada harita, işaretleyicileri buton olarak gösteren
// hafif bir yer tutucuyla değiştirilir. `mapShouldCrash` harita hatası senaryosunu simüle eder.
const mapControl = vi.hoisted(() => ({ shouldCrash: false }))
vi.mock('./components/PlaceMap', () => ({
  default: ({ places, selectedId, onSelect }: PlaceMapProps) => {
    if (mapControl.shouldCrash) throw new Error('Harita çöktü')
    return (
      <ul aria-label="Harita işaretleyicileri">
        {places.map((p) => (
          <li key={p.id}>
            <button type="button" aria-pressed={p.id === selectedId} onClick={() => onSelect(p.id)}>
              İşaretleyici: {p.name}
            </button>
          </li>
        ))}
      </ul>
    )
  },
}))

beforeEach(() => {
  mapControl.shouldCrash = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function renderLoaded(routes = placeRoutes()) {
  const fetchMock = stubFetch(routes)
  render(<App />)
  const list = await screen.findByRole('list', { name: 'Eser listesi' })
  return { fetchMock, list }
}

describe('ana sayfa', () => {
  it('başlığı, sloganı ve ana aksiyonu gösterir', async () => {
    stubFetch(placeRoutes())
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    expect(screen.getByText('Geçmişi Keşfet, Mirası Yaşat.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Eserleri Keşfet' })).toHaveAttribute('href', '#kesfet')
    await screen.findByRole('list', { name: 'Eser listesi' })
  })

  it('henüz geliştirilmeyen Görevler ve Pasaport bölümlerini tıklanabilir göstermez', async () => {
    stubFetch(placeRoutes())
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Ana menü' })
    expect(within(nav).getByRole('link', { name: 'Keşfet' })).toHaveAttribute('href', '#kesfet')
    expect(within(nav).getByRole('link', { name: 'Harita' })).toHaveAttribute('href', '#harita')
    for (const label of ['Görevler', 'Pasaport']) {
      expect(within(nav).queryByRole('link', { name: new RegExp(label) })).not.toBeInTheDocument()
      expect(within(nav).queryByRole('button', { name: new RegExp(label) })).not.toBeInTheDocument()
      expect(within(nav).getByText(label).closest('li')).toHaveTextContent(/Yakında.*henüz kullanılamıyor/)
    }
    await screen.findByRole('list', { name: 'Eser listesi' })
  })
})

describe('eser listesi', () => {
  it('eserleri backend GET /places uç noktasından yükler', async () => {
    const { fetchMock } = await renderLoaded()
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/places`, expect.anything())
    expect(screen.getAllByRole('article')).toHaveLength(PLACES.length)
  })

  it('yüklenirken durum mesajı gösterir', async () => {
    stubFetch(placeRoutes())
    render(<App />)
    expect(screen.getByText('Eserler yükleniyor…')).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Eser listesi' })
  })

  it('kartlarda ad, şehir, açıklama, demo etiketi ve detay butonu gösterir', async () => {
    const { list } = await renderLoaded()
    for (const place of PLACES) {
      const card = within(list).getByRole('article', { name: place.name })
      expect(within(card).getByText(place.city)).toBeInTheDocument()
      expect(within(card).getByText(place.description)).toBeInTheDocument()
      expect(within(card).getByText('Kurgusal demo')).toBeInTheDocument()
      expect(within(card).getByRole('button', { name: `Detayları gör: ${place.name}` })).toBeInTheDocument()
    }
  })

  it('demo olmayan kayıtta demo etiketi ve harita uyarısı göstermez', async () => {
    const real = { ...PLACES[1], id: 'gercek', is_demo: false }
    const { list } = await renderLoaded(placeRoutes([real]))
    expect(within(list).queryByText('Kurgusal demo')).not.toBeInTheDocument()
    expect(screen.queryByText('Kurgusal demo konumları.')).not.toBeInTheDocument()
  })

  it('boş liste durumunu açıklar', async () => {
    stubFetch({ '/places': { body: [] } })
    render(<App />)
    expect(await screen.findByText(/Henüz listelenecek eser yok/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Eser listesi' })).not.toBeInTheDocument()
  })

  it('backend kapalıysa bağlantı hatası bildirir ve tekrar denemeye izin verir', async () => {
    let backendUp = false
    stubFetch({
      ...placeRoutes(),
      '/places': () => (backendUp ? { body: PLACES } : new TypeError('Failed to fetch')),
    })
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Eserler yüklenemedi')
    expect(alert).toHaveTextContent('Sunucuya ulaşılamadı')
    expect(alert).toHaveTextContent(`API adresi: ${API_BASE_URL}`)
    expect(screen.getByText(/harita işaretleri gösterilemiyor/)).toBeInTheDocument()

    backendUp = true
    await userEvent.click(within(alert).getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByRole('list', { name: 'Eser listesi' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('API hata yanıtındaki mesajı kullanıcıya gösterir', async () => {
    stubFetch({ '/places': { status: 503, body: { detail: 'Bakım çalışması var.' } } })
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Eserler yüklenemedi')
    expect(alert).toHaveTextContent('Bakım çalışması var.')
  })

  it('beklenmeyen yanıt biçimini hata olarak bildirir', async () => {
    stubFetch({ '/places': { body: { not: 'a list' } } })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucudan beklenmeyen bir yanıt geldi.')
  })
})

describe('eser ayrıntıları', () => {
  it('kart seçilince ayrıntıları GET /places/{id} ile açar', async () => {
    const { fetchMock } = await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Detayları gör: Test Mekânı A' }))

    const panel = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    expect(await within(panel).findByRole('heading', { name: 'Test Mekânı A' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/places/test-a`, expect.anything())
    expect(panel).toHaveTextContent('Birinci kurgusal test kaydı.')
    expect(panel).toHaveTextContent('Test Şehri')
    expect(panel).toHaveTextContent('0.00000, 0.00000')
    expect(panel).toHaveTextContent('Bu kayıt için kaynak bilgisi bulunmuyor.')
    expect(panel).toHaveTextContent(/Kurgusal demo kaydı.*gerçek bir tarihî eseri temsil etmez/)
    expect(panel).toHaveFocus()
    expect(window.location.search).toBe('?eser=test-a')
    expect(screen.getByRole('button', { name: 'Detayları gör: Test Mekânı A' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'İşaretleyici: Test Mekânı A' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('kaynak varsa güvenli dış bağlantı olarak gösterir', async () => {
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Detayları gör: Test Mekânı B' }))
    const link = await screen.findByRole('link', { name: /Örnek Kaynak/ })
    expect(link).toHaveAttribute('href', 'https://example.org/kaynak')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('haritadaki işaretleyici seçilince ayrıntıları açar', async () => {
    await renderLoaded()
    await userEvent.click(await screen.findByRole('button', { name: 'İşaretleyici: Test Mekânı B' }))
    const panel = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    expect(await within(panel).findByRole('heading', { name: 'Test Mekânı B' })).toBeInTheDocument()
  })

  it('kapatınca seçimi temizler ve odağı karta döndürür', async () => {
    await renderLoaded()
    const cardButton = screen.getByRole('button', { name: 'Detayları gör: Test Mekânı A' })
    await userEvent.click(cardButton)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayrıntıları kapat' }))
    expect(screen.getByText(/listeden ya da haritadan bir eser seç/)).toBeInTheDocument()
    expect(cardButton).toHaveFocus()
    expect(window.location.search).toBe('')
  })

  it('adresteki geçersiz eser ID için "bulunamadı" mesajı gösterir', async () => {
    window.history.replaceState(null, '', '/?eser=olmayan-eser')
    await renderLoaded()
    const panel = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    const alert = await within(panel).findByRole('alert')
    expect(alert).toHaveTextContent('Eser bulunamadı')
    expect(alert).toHaveTextContent('olmayan-eser')
    await userEvent.click(within(panel).getByRole('button', { name: 'Seçimi temizle' }))
    expect(window.location.search).toBe('')
  })

  it('ayrıntı isteği başarısız olursa hatayı bildirir', async () => {
    await renderLoaded({ ...placeRoutes(), '/places/test-a': { status: 500, body: { detail: 'İç hata' } } })
    await userEvent.click(screen.getByRole('button', { name: 'Detayları gör: Test Mekânı A' }))
    const panel = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/Eser ayrıntıları yüklenemedi.*İç hata/)
  })
})

describe('harita bölümü', () => {
  it('demo kayıtlar için "Kurgusal demo konumları" uyarısı gösterir', async () => {
    await renderLoaded()
    const section = screen.getByRole('region', { name: 'Keşif Haritası' })
    expect(within(section).getByRole('note')).toHaveTextContent(/Kurgusal demo konumları.*gerçek bir eserin\s+konumunu göstermez/)
  })

  it('backend verisindeki her eser için işaretleyici oluşturur', async () => {
    await renderLoaded()
    const markers = await screen.findByRole('list', { name: 'Harita işaretleyicileri' })
    expect(within(markers).getAllByRole('button')).toHaveLength(PLACES.length)
  })

  it('harita çökerse eser listesi ve ayrıntılar çalışmaya devam eder', async () => {
    mapControl.shouldCrash = true
    await renderLoaded()
    expect(await screen.findByText(/Harita şu anda gösterilemiyor/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Detayları gör: Test Mekânı A' }))
    const panel = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    expect(await within(panel).findByRole('heading', { name: 'Test Mekânı A' })).toBeInTheDocument()
  })
})
