import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { API_BASE_URL } from './api/client'
import type { PlaceMapProps } from './components/PlaceMap'
import { PLACES, REAL_TYPE_PLACE, placeRoutes, stubFetch } from './test/fixtures'

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
  // Bu dosya Demo Keşif Oyunu'nu test eder; varsayılan sayfa artık Gerçek Bursa Eserleri kataloğudur.
  window.history.replaceState(null, '', '/?mod=demo')
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
    // Demo oyunu geliştirme araçlarıyla birlikte ayrı parçada (lazy) yüklenir.
    expect(await screen.findByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    expect(screen.getByText('Geçmişi Keşfet, Mirası Yaşat.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Eserleri Keşfet' })).toHaveAttribute('href', '#kesfet')
    await screen.findByRole('list', { name: 'Eser listesi' })
  })

  it('ana menüde Keşfet, Harita, Görevler ve Pasaport bölümlerine çalışan bağlantılar verir', async () => {
    stubFetch(placeRoutes())
    const { container } = render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Ana menü' })
    const targets = { Keşfet: '#kesfet', Harita: '#harita', Görevler: '#gorevler', Pasaport: '#pasaport' }
    for (const [label, href] of Object.entries(targets)) {
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('href', href)
      expect(container.querySelector(href)).toBeInTheDocument()
    }
    expect(within(nav).queryByText('Yakında')).not.toBeInTheDocument()
    await screen.findByRole('list', { name: 'Eser listesi' })
  })
})

describe('yeni tasarım', () => {
  it('eser kartlarındaki çizimleri temsili olarak etiketler ve gerçek görsel göstermez', async () => {
    const { list } = await renderLoaded()
    for (const place of PLACES) {
      const card = within(list).getByRole('article', { name: place.name })
      expect(within(card).getByText('Temsili çizim · Eser görseli değildir')).toBeInTheDocument()
      expect(card.querySelector('img')).toBeNull()
    }
  })

  it('oyun akışını anlatır ve alt menüde bölümlere bağlantı verir', async () => {
    await renderLoaded()
    expect(screen.getByRole('heading', { level: 2, name: /Merak et\.\s*İzini sür\./ })).toBeInTheDocument()
    expect(screen.getByText('Bursa’nın Kayıp Vakfiyesi · Yaşayan Miras Oyunu')).toBeInTheDocument()
    const footerNav = screen.getByRole('navigation', { name: 'Alt menü' })
    expect(within(footerNav).getByRole('link', { name: 'Dijital pasaport' })).toHaveAttribute('href', '#pasaport')
    expect(within(footerNav).getByRole('link', { name: 'Görevler' })).toHaveAttribute('href', '#gorevler')
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
    expect(window.location.search).toBe('?mod=demo&eser=test-a')
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
    expect(window.location.search).toBe('?mod=demo')
  })

  it('adresteki geçersiz eser ID için "bulunamadı" mesajı gösterir', async () => {
    window.history.replaceState(null, '', '/?mod=demo&eser=olmayan-eser')
    await renderLoaded()
    const panel = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    const alert = await within(panel).findByRole('alert')
    expect(alert).toHaveTextContent('Eser bulunamadı')
    expect(alert).toHaveTextContent('olmayan-eser')
    await userEvent.click(within(panel).getByRole('button', { name: 'Seçimi temizle' }))
    expect(window.location.search).toBe('?mod=demo')
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

const announcer = () => document.getElementById('map-selection-status')!
const detailPanel = () => screen.getByRole('complementary', { name: 'Eser ayrıntıları' })

describe('harita seçimi duyurusu', () => {
  it('işaretleyici klavyeyle seçilince duyuru günceller, odak işaretleyicide kalır ve panel aynı eseri gösterir', async () => {
    await renderLoaded()
    expect(announcer()).toHaveAttribute('role', 'status')
    expect(announcer()).toBeEmptyDOMElement()

    const marker = await screen.findByRole('button', { name: 'İşaretleyici: Test Mekânı A' })
    marker.focus()
    await userEvent.keyboard('{Enter}')

    expect(announcer()).toHaveTextContent(
      'Test Mekânı A seçildi, Test Şehri. Kurgusal demo kaydı. Ayrıntılar eser ayrıntıları panelinde.',
    )
    expect(marker).toHaveFocus()
    expect(await within(detailPanel()).findByRole('heading', { name: 'Test Mekânı A' })).toBeInTheDocument()
  })

  it('başka eser seçilince duyuru değişir; aynı eseri yeniden seçmek duyuruyu tekrarlamaz', async () => {
    await renderLoaded()
    await userEvent.click(await screen.findByRole('button', { name: 'İşaretleyici: Test Mekânı A' }))
    await userEvent.click(screen.getByRole('button', { name: 'İşaretleyici: Test Mekânı B' }))
    expect(announcer()).toHaveTextContent(/^Test Mekânı B seçildi, Örnek Şehir\./)
    expect(await within(detailPanel()).findByRole('heading', { name: 'Test Mekânı B' })).toBeInTheDocument()

    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(announcer(), { childList: true, subtree: true, characterData: true })
    await userEvent.click(screen.getByRole('button', { name: 'İşaretleyici: Test Mekânı B' }))
    await Promise.resolve()
    observer.disconnect()
    expect(mutations).toHaveLength(0)
  })

  it('karttan seçim duyuru yapmaz, odağı panele taşır ve önceki harita duyurusunu temizler', async () => {
    await renderLoaded()
    await userEvent.click(await screen.findByRole('button', { name: 'İşaretleyici: Test Mekânı A' }))
    expect(announcer()).toHaveTextContent('Test Mekânı A seçildi')

    await userEvent.click(screen.getByRole('button', { name: 'Detayları gör: Test Mekânı B' }))
    expect(announcer()).toBeEmptyDOMElement()
    expect(detailPanel()).toHaveFocus()
    expect(await within(detailPanel()).findByRole('heading', { name: 'Test Mekânı B' })).toBeInTheDocument()
  })

  it('geri tuşuyla seçim değişince eski duyuru panelle çelişecek şekilde kalmaz', async () => {
    await renderLoaded()
    await userEvent.click(await screen.findByRole('button', { name: 'İşaretleyici: Test Mekânı A' }))
    await userEvent.click(screen.getByRole('button', { name: 'İşaretleyici: Test Mekânı B' }))
    window.history.back()
    expect(await within(detailPanel()).findByRole('heading', { name: 'Test Mekânı A' })).toBeInTheDocument()
    expect(window.location.search).toBe('?mod=demo&eser=test-a')
    expect(announcer()).toBeEmptyDOMElement()
  })

  // REAL_TYPE_PLACE kurgusal bir test kaydıdır; yalnızca `is_demo: false` gösterimini sınar.
  it('gerçek-tipli kayıt duyurusunda demo ifadesi yer almaz', async () => {
    await renderLoaded(placeRoutes([REAL_TYPE_PLACE]))
    await userEvent.click(await screen.findByRole('button', { name: 'İşaretleyici: Test Mekânı G' }))
    expect(announcer()).toHaveTextContent('Test Mekânı G seçildi, Test Şehri. Ayrıntılar eser ayrıntıları panelinde.')
    expect(announcer()).not.toHaveTextContent('Kurgusal')
  })
})

// Bu bölümdeki REAL_TYPE_PLACE, `is_demo: false` taşıyan kurgusal bir test kaydıdır; doğrulanmış gerçek bir eser değildir.
describe('demo ve gerçek kayıt etiketleri', () => {
  const mapSection = () => screen.getByRole('region', { name: 'Keşif Haritası' })
  const legend = () => within(mapSection()).queryByRole('list', { name: 'Harita işaretlerinin açıklaması' })

  it('tamamı demo ise tüm işaretlerin kurgusal olduğunu belirtir', async () => {
    await renderLoaded()
    expect(within(mapSection()).getByRole('note')).toHaveTextContent(
      /Kurgusal demo konumları\. Haritadaki tüm işaretler test amaçlıdır/,
    )
    const items = within(legend()!).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Kurgusal demo konumu (kesikli çerçeve, içi boş)')
  })

  it('tamamı gerçek-tipli ise demo uyarısı ve açıklama göstermez', async () => {
    await renderLoaded(placeRoutes([REAL_TYPE_PLACE]))
    expect(within(mapSection()).queryByRole('note')).not.toBeInTheDocument()
    expect(legend()).not.toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).not.toHaveTextContent(/tüm eser kayıtları kurgusal/i)
  })

  it('karışık kayıtlarda yalnızca demo işaretlerinin kurgusal olduğunu açıklar', async () => {
    await renderLoaded(placeRoutes([...PLACES, REAL_TYPE_PLACE]))
    const note = within(mapSection()).getByRole('note')
    expect(note).toHaveTextContent(/Bazı konumlar kurgusal\./)
    expect(note).toHaveTextContent(/3 işaretten 2 tanesi\s+kurgusal demo kaydıdır/)
    expect(note).toHaveTextContent(/diğer 1 işaret backend’de gerçek eser kaydı olarak işaretlidir/)
    expect(note).not.toHaveTextContent('tüm işaretler')

    const items = within(legend()!).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['Gerçek eser kaydı', 'Kurgusal demo konumu (kesikli çerçeve, içi boş)'])

    const list = screen.getByRole('list', { name: 'Eser listesi' })
    expect(within(within(list).getByRole('article', { name: 'Test Mekânı G' })).queryByText('Kurgusal demo')).not.toBeInTheDocument()
    expect(within(within(list).getByRole('article', { name: 'Test Mekânı A' })).getByText('Kurgusal demo')).toBeInTheDocument()
  })

  it('boş listede demo uyarısı ve açıklama göstermez', async () => {
    stubFetch({ '/places': { body: [] } })
    render(<App />)
    await screen.findByText(/Henüz listelenecek eser yok/)
    expect(within(mapSection()).queryByRole('note')).not.toBeInTheDocument()
    expect(legend()).not.toBeInTheDocument()
  })
})
