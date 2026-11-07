import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'

// R2: Keşfet sergi düzeni. Kurgusal kayıtlar (BUR-9xxx gerçek katalog kimliği değildir).
vi.mock('./components/RouteMap', () => ({
  default: ({ points }: { points: { id: string; name: string }[] }) => (
    <ul aria-label="Harita noktaları">{points.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
  ),
}))

const summary = (id: string, name: string, type: string, city: string, attribution: string | null) => ({
  monument_id: id, name, alternative_names: [] as string[], type, city, district: 'Merkez', address: `${name} adresi`,
  location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20 }, checkin_available: false, fact_count: 1, game_fact_count: 1,
  image_count: 1, cover: { file: `${id}.jpeg`, attribution, license: 'CC-BY-SA-4.0', title: null, source_url: null },
  lead: `${name} kısa giriş.`, illustration: 'representative_drawing',
})
const catalog = (monuments: ReturnType<typeof summary>[]) => ({ published_count: monuments.length, data_version: 't', generated_at: null, monuments })

function open(path: string, monuments: ReturnType<typeof summary>[]) {
  stubFetch({ '/auth/me': { status: 401, body: { detail: 'x' } }, '/monuments': { body: catalog(monuments) }, '/route': { status: 500, body: { detail: 'x' } } })
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

describe('Keşfet: sergi düzeni', () => {
  it('R6.13 koleksiyon girişi: büyük kapak yok; şehir katalogdan, başlık, kısa açıklama ve eser sayısı', async () => {
    open('/eserler', [
      summary('BUR-9001', 'Atıfsız Cami', 'cami', 'Bursa', null),
      summary('BUR-9002', 'Deneme Han', 'han', 'Bursa', 'Fotoğraf: Deneme Çeken, CC BY-SA'),
    ])
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Eserlerin İzinde' })
    const head = h1.closest('header')!
    expect(head.querySelector('img')).toBeNull()
    expect(document.querySelector('.vk-explore__hero')).toBeNull()
    expect(await within(head).findByText('Bursa / Vakıf mirası')).toBeInTheDocument()  // katalog gelince
    expect(within(head).getByText('Vakıf mirasını keşfet. Her eser, geçmişten bugüne uzanan ayrı bir hikâye taşır.')).toBeInTheDocument()
    expect(await within(head).findByText('2 eser, 1 şehir')).toBeInTheDocument()
  })

  it('birden çok şehir varsa girişte tek şehir adı yazılmaz', async () => {
    open('/eserler', [summary('BUR-9001', 'A Cami', 'cami', 'Bursa', null), summary('KUT-9001', 'B Türbe', 'türbe', 'Kütahya', null)])
    const head = (await screen.findByRole('heading', { level: 1, name: 'Eserlerin İzinde' })).closest('header')!
    expect(await within(head).findByText('Vakıf mirası')).toBeInTheDocument()
    expect(within(head).queryByText(/Bursa \//)).not.toBeInTheDocument()
  })

  it('koleksiyon kartı: çerçeveli fotoğraf (sabit boyut), tür, ad, kısa tanıtım, "Eseri Keşfet"; kartın tamamı detay bağlantısı; atıf korunur', async () => {
    open('/eserler', [summary('BUR-9002', 'Deneme Han', 'han', 'Bursa', 'Fotoğraf: Deneme Çeken, CC BY-SA')])
    const card = (await screen.findByRole('heading', { level: 3, name: 'Deneme Han' })).closest('article')!
    const link = within(card).getByRole('link', { name: 'Deneme Han' })
    expect(link).toHaveAttribute('href', '/eser/BUR-9002')
    expect(within(card).getAllByRole('link')).toHaveLength(1)
    expect(within(card).getByText('Han, Merkez')).toBeInTheDocument()
    expect(within(card).getByText('Deneme Han kısa giriş.')).toBeInTheDocument()
    expect(within(card).getByText('Eseri Keşfet')).toBeInTheDocument()
    expect(within(card).getByText('Fotoğraf: Deneme Çeken, CC BY-SA')).toBeInTheDocument()
    const img = card.querySelector('img')!
    expect(img.getAttribute('src')).toContain('BUR-9002.jpeg')
    expect(img).toHaveAttribute('width', '900')
    expect(img).toHaveAttribute('height', '600')
    expect(img).toHaveAttribute('alt', '')
    // Kazanılmamış eserde mühür ya da kilit işareti yok.
    expect(card.querySelector('.vk-ccard__seal')).toBeNull()
    expect(within(card).queryByText(/Kilitli|Açık/)).not.toBeInTheDocument()
  })

  it('ilk kartın fotoğrafı öncelikli, diğerleri tembel yüklenir', async () => {
    open('/eserler', [1, 2, 3, 4, 5].map((n) => summary(`BUR-900${n}`, `Eser ${n}`, 'cami', 'Bursa', 'Fotoğraf: X, CC BY')))
    await screen.findByRole('heading', { level: 3, name: 'Eser 5' })
    const imgs = [...document.querySelectorAll('article img')]
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy', 'lazy', 'lazy'])
    expect(imgs[0].getAttribute('fetchpriority')).toBe('high')
  })

  // --- Arama (R2 son) -------------------------------------------------------------------------------------------
  const SET = () => [
    { ...summary('BUR-9001', 'Bursa Ulu Camii', 'cami', 'Bursa', 'Fotoğraf: A, CC BY'), alternative_names: ['Ulucami'] },
    summary('BUR-9002', 'Koza Han', 'han', 'Bursa', 'Fotoğraf: B, CC BY'),
    summary('BUR-9003', 'Osman Gazi Türbesi', 'türbe', 'Bursa', 'Fotoğraf: C, CC BY'),
    summary('KUT-9001', 'Kurşunlu Camii', 'cami', 'Kütahya', 'Fotoğraf: D, CC BY'),
  ]
  const titles = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)

  it('arama kutusu etiketli ve "search" türündedir; Türkçe karakter ve büyük/küçük harften bağımsız ada göre süzer', async () => {
    open('/eserler', SET())
    const box = await screen.findByRole('searchbox', { name: 'Eser ara' })
    expect(screen.getByRole('search', { name: 'Eserleri ara ve süz' })).toContainElement(box)
    await screen.findByRole('heading', { name: 'Koza Han' })
    await userEvent.type(box, 'ULU CAMİ')
    expect(titles()).toEqual(['Bursa Ulu Camii'])
    expect(screen.getByText('1 eser')).toBeInTheDocument()  // canlı sayaç
    await userEvent.clear(box)
    await userEvent.type(box, 'osman turbe')  // şapka ve çengel olmadan, iki kelime
    expect(titles()).toEqual(['Osman Gazi Türbesi'])
    await userEvent.clear(box)
    await userEvent.type(box, 'ulucami')  // onaylı alternatif ad
    expect(titles()).toEqual(['Bursa Ulu Camii'])
    await userEvent.clear(box)
    expect(titles()).toHaveLength(4)
  })

  it('arama şehir ve tür filtreleriyle birlikte çalışır; sonuç yoksa anlaşılır boş durum ve temizleme sunulur', async () => {
    open('/eserler', SET())
    const box = await screen.findByRole('searchbox', { name: 'Eser ara' })
    await screen.findByRole('heading', { name: 'Koza Han' })
    await userEvent.type(box, 'camii')
    expect(titles()).toEqual(['Bursa Ulu Camii', 'Kurşunlu Camii'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Şehir' }), 'kutahya')
    expect(titles()).toEqual(['Kurşunlu Camii'])
    await userEvent.click(within(screen.getByRole('group', { name: 'Eser türü' })).getByRole('button', { name: 'Han' }))
    expect(titles()).toEqual([])
    expect(screen.getByText('“camii” ile eşleşen eser bulunamadı.')).toBeInTheDocument()
    expect(screen.getByText('0 eser')).toBeInTheDocument()
    // Seçili filtreler sayaçta özetlenir.
    expect(screen.getByText('Kütahya, Han, “camii”')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Filtreleri temizle' }))
    expect(titles()).toHaveLength(4)
    expect(box).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Şehir' })).toHaveValue('')
    expect(within(screen.getByRole('group', { name: 'Eser türü' })).getByRole('button', { name: 'Tümü' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('4 eser')).toHaveFocus()
  })

  it('filtre seçiliyken sonuç varsa sayaçta özet ve "Filtreleri temizle" görünür; URL filtresi açılışta uygulanır', async () => {
    open('/eserler?sehir=bursa&tur=han', SET())
    await screen.findByRole('heading', { level: 3, name: 'Koza Han' })
    expect(titles()).toEqual(['Koza Han'])
    expect(screen.getByText('Bursa, Han')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filtreleri temizle' }))
    expect(titles()).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Filtreleri temizle' })).not.toBeInTheDocument()
  })

  it('arama harita görünümündeki noktaları da süzer', async () => {
    open('/harita', SET())
    const box = await screen.findByRole('searchbox', { name: 'Eser ara' })
    const pts = await screen.findByRole('list', { name: 'Harita noktaları' })
    expect(within(pts).getAllByRole('listitem')).toHaveLength(4)
    await userEvent.type(box, 'koza')
    expect(within(screen.getByRole('list', { name: 'Harita noktaları' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Koza Han'])
  })

  it('Liste | Harita seçici erişilebilir adlarla görünümü değiştirir; harita görünümünde başlık değişir', async () => {
    open('/eserler', [summary('BUR-9002', 'Deneme Han', 'han', 'Bursa', 'Fotoğraf: Deneme Çeken, CC BY-SA')])
    const group = await screen.findByRole('group', { name: 'Görünüm' })
    expect(within(group).getByRole('button', { name: 'Liste' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(group).getByRole('button', { name: 'Harita' }))
    expect(window.location.pathname).toBe('/harita')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Eser haritası' })
    expect(h1.closest('main')).toHaveClass('vk-coll--map')
    expect(await screen.findByRole('list', { name: 'Harita noktaları' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Görünüm' })).getByRole('button', { name: 'Harita' })).toHaveAttribute('aria-pressed', 'true')
  })
})
