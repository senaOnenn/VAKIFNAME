import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoGallery } from '../components/PhotoGallery'
import { stubFetch, type Routes } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'

// R3: eser sayfası (dijital müze). Kurgusal eser (BUR-9xxx gerçek katalog kimliği değildir).
const img = (n: number) => ({
  image_id: `i${n}`, file: `f${n}.jpeg`, card_file: `f${n}-card.jpeg`, rights_holder: `Çeken ${n}`, license: 'CC-BY-SA-4.0',
  attribution: `Fotoğraf: Çeken ${n}, CC BY-SA 4.0, Wikimedia Commons`, game_use: false, width: 1600, height: 1200,
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
})
const fact = (n: number) => ({
  fact_id: `BUR-9001-F00${n}`, title: `Kayıt ${n}`, text: `Kayıt ${n} metni.`, category: 'construction', certainty: 'documented',
  source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 20 + n, page_kind: 'physical' }, game_use: false,
})
const DETAIL = {
  monument_id: 'BUR-9001', name: 'Deneme Camii', alternative_names: ['Eski Deneme Mescidi'], type: 'cami', city: 'Bursa',
  district: 'Osmangazi', address: 'Deneme Caddesi No: 1', location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20, represents: 'building_footprint_centroid' },
  checkin_available: false, checkin: null, site_notice: 'Aktif ibadet mekânıdır; sessiz olun.', illustration: 'representative_drawing',
  facts: [fact(1), fact(2)], images: [img(1), img(2)],
}
const SUMMARY = {
  published_count: 1, data_version: 't', generated_at: null,
  monuments: [{ monument_id: 'BUR-9001', name: 'Deneme Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
    address: 'Deneme Caddesi No: 1', location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20 }, checkin_available: false,
    fact_count: 2, game_fact_count: 0, image_count: 2, cover: { file: 'f1.jpeg', attribution: 'Fotoğraf: Çeken 1', license: 'CC-BY-SA-4.0', title: null, source_url: null },
    lead: 'Deneme Camii, onaylı katalogdaki kısa giriş metnidir.', illustration: 'representative_drawing' }],
}

/** R6.11: Fotoğraf Arşivi nişteki nesneden açılan pencerededir. */
async function openArchive() {
  await userEvent.click(await screen.findByRole('button', { name: /Fotoğraf Arşivi/ }))
  return within(await screen.findByRole('dialog', { name: 'Deneme Camii' })).getByRole('region', { name: 'Fotoğraf Arşivi' })
}

function open(extra: Routes = {}) {
  stubFetch({
    '/auth/me': { status: 401, body: { detail: 'x' } },
    '/monuments': { body: SUMMARY },
    '/monuments/BUR-9001': { body: DETAIL },
    '/route': { status: 500, body: { detail: 'x' } },
    ...extra,
  })
  window.history.replaceState(null, '', '/eser/BUR-9001')
  return render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('Eser sayfası (R3)', () => {
  it('R6.11 sergi girişi: koleksiyon yolu, ad, kaynaklı kısa giriş (kitap adı değil kısa gönderme), üç temel bilgi', async () => {
    open()
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    const hero = h1.closest('section')!
    const crumbs = within(hero).getByRole('navigation', { name: 'Koleksiyon yolu' })
    expect(within(crumbs).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Bursa', '/eserler?sehir=bursa'], ['Tarihî Eserler', '/eserler'], ['Cami', '/eserler?sehir=bursa&tur=cami'],
    ])
    expect(within(hero).getByText('Kayıt 1 metni.')).toBeInTheDocument()
    expect(within(hero).getByText('Kaynak: Cilt I, s. 21')).toBeInTheDocument()
    // Kitap adı sayfada tek yerde (Künye ve kaynaklar), atıf kaybolmadan.
    expect(screen.getAllByText(/Bursa Vakıf Eserleri, Cilt I/)).toHaveLength(1)
    const facts = within(hero).getAllByRole('term').map((dt) => [dt.textContent, dt.nextElementSibling!.textContent])
    expect(facts).toEqual([['Tür', 'Cami'], ['Konum', 'Osmangazi, Bursa']])
    // Büyük kapak yok; tek görsel nişteki küçük arşiv önizlemesi (eserin kendi kart fotoğrafı, atfıyla).
    expect(document.querySelector('.vk-mon__hero')).toBeNull()
    const preview = within(hero).getByRole('img', { name: 'Deneme Camii, Fotoğraf Arşivi önizlemesi' })
    expect(preview.getAttribute('src')).toContain('f1-card.jpeg')
    expect(within(hero).getByText('Fotoğraf: Çeken 1, CC BY-SA 4.0, Wikimedia Commons')).toBeInTheDocument()
  })

  it('koleksiyon yolundaki tür bağlantısı Keşfet’i o şehir ve tür filtresiyle açar', async () => {
    open()
    const crumbs = await screen.findByRole('navigation', { name: 'Koleksiyon yolu' })
    await userEvent.click(within(crumbs).getByRole('link', { name: 'Cami' }))
    expect(await screen.findByRole('button', { name: 'Cami', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('bursa')
  })

  it('R6.11 ilk ekran: ziyaret notu görev ve haritadan önce; görev ve harita doğru esere gider; iki arşiv nesnesi pencere açar', async () => {
    open()
    const hero = (await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })).closest('section')!
    const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const notice = within(hero).getByRole('complementary', { name: 'Ziyaret uyarısı' })
    expect(notice).toHaveTextContent('Aktif ibadet mekânıdır; sessiz olun.')
    const quest = within(hero).getByRole('link', { name: 'Bilgi Görevine Başla' })
    const map = within(hero).getByRole('link', { name: 'Haritada Gör' })
    expect(quest).toHaveAttribute('href', '/oyun/eser/BUR-9001')
    expect(map).toHaveAttribute('href', '/harita?eser=BUR-9001')
    expect(after(notice, quest)).toBe(true)
    const book = within(hero).getByRole('button', { name: /Tarih Defteri.*2 onaylı tarihî kayıt/ })
    const photos = within(hero).getByRole('button', { name: /Fotoğraf Arşivi.*2 lisanslı fotoğraf/ })
    await userEvent.click(book)
    expect(await screen.findByRole('dialog', { name: 'Tarih Defteri' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(book).toHaveFocus()
    await userEvent.click(photos)
    const dlg = await screen.findByRole('dialog', { name: 'Deneme Camii' })
    expect(within(dlg).getByRole('region', { name: 'Fotoğraf Arşivi' })).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Arşivi kapat' }))
    expect(screen.queryByRole('dialog', { name: 'Deneme Camii' })).not.toBeInTheDocument()
    expect(photos).toHaveFocus()
    // Uzun kayıt listesi sayfada yok: eski "Kısa tarihçe" ve sayfa içi arşiv kalktı.
    expect(screen.queryByRole('region', { name: 'Kısa tarihçe' })).not.toBeInTheDocument()
  })

  it('öne çıkanlar girişi ve kişi kayıtlarını tekrar etmez; kısa göndermeli; bütün kayıtlar Tarih Defteri’nde', async () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ ...fact(n), category: ['construction', 'architecture', 'historical_event', 'restoration', 'function'][n - 1] }))
    open({
      '/monuments/BUR-9001': { body: { ...DETAIL, facts: many } },
      '/monuments/BUR-9001/people': { body: { people: [
        { name: 'Deneme Bey', role: 'bani', role_label: 'Eserin banisi', fact_id: 'BUR-9001-F003', text: 'Kayıt 3 metni.', certainty: 'documented', source: 'x' },
      ] } },
    })
    const hl = await screen.findByRole('region', { name: 'Bu eserde öne çıkanlar' })
    const titles = within(hl).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Kayıt 2', 'Kayıt 4', 'Kayıt 5'])  // giriş (1) ve bâni kaydı (3) yok
    expect(within(hl).getByText('Cilt I, s. 22')).toBeInTheDocument()
    await userEvent.click(within(hl).getByRole('button', { name: 'Tüm tarihî kayıtları incele (5)' }))
    expect(await screen.findByRole('dialog', { name: 'Tarih Defteri' })).toBeInTheDocument()
    // Bâni ilk ekranın temel bilgisinde (yalnız ad), kaydın göndermesi ayrıntılı künyede.
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!
    expect(within(hero).getByText('Eserin banisi').nextElementSibling).toHaveTextContent('Deneme Bey')
  })

  it('ayrıntılı künye açılır; kişiler göndermesiyle, diğer adlar, adres; kaynak yayın bir kez yazılır', async () => {
    open({ '/monuments/BUR-9001/people': { body: { people: [
      { name: 'Deneme Hatun', role: 'medfun', role_label: 'Burada yatıyor', fact_id: 'BUR-9001-F002', text: 'Kayıt 2 metni.', certainty: 'reported', source: 'x' },
    ] } } })
    const rec = await screen.findByRole('region', { name: 'Künye ve kaynaklar' })
    await within(rec).findByText(/Deneme Hatun/)
    const row = (term: string) => within(rec).getByText(term, { selector: 'dt' }).nextElementSibling!
    expect(row('Burada yatıyor')).toHaveTextContent('Deneme Hatun')
    expect(row('Burada yatıyor')).toHaveTextContent('Rivayet')
    expect(row('Burada yatıyor')).toHaveTextContent('Cilt I, s. 22')
    expect(row('Diğer adları')).toHaveTextContent('Eski Deneme Mescidi')
    expect(row('Adres')).toHaveTextContent('Deneme Caddesi No: 1')
    expect(within(rec).getByText('Bursa Vakıf Eserleri, Cilt I')).toBeInTheDocument()
    expect(within(rec).getByText('Ayrıntılı künye').closest('details')).not.toHaveAttribute('open')
  })

  it('eksik veri uydurulmaz: kaydı ve fotoğrafı olmayan eserde giriş, öne çıkanlar ve önizleme yok; durum dürüstçe yazılır', async () => {
    open({ '/monuments/BUR-9001': { body: { ...DETAIL, facts: [], images: [], alternative_names: [], site_notice: null } } })
    const hero = (await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })).closest('section')!
    expect(within(hero).queryByText(/^Kaynak:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Bu eserde öne çıkanlar' })).not.toBeInTheDocument()
    expect(within(hero).getByRole('button', { name: /Tarih Defteri/ })).toBeDisabled()
    expect(within(hero).queryByRole('button', { name: /Fotoğraf Arşivi/ })).not.toBeInTheDocument()  // süs düğme yok
    expect(within(hero).getByText('Bu eser için henüz yayımlanmış fotoğraf yok.')).toBeInTheDocument()
    expect(within(hero).queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Ziyaret uyarısı' })).not.toBeInTheDocument()
    expect(screen.getByText('Bu eser için henüz onaylı kaynak kaydı yok.')).toBeInTheDocument()
  })

  it.each([
    ['cami, uyarılı, iki fotoğraf', { ...DETAIL }],
    ['türbe, tek kayıt, fotoğrafsız', { ...DETAIL, type: 'türbe', facts: [fact(1)], images: [], site_notice: null }],
    ['han, diğer adsız, konumsuz', { ...DETAIL, type: 'han', alternative_names: [], location: null }],
  ])('G: %s eser aynı sergi şablonuyla çizilir (eser bazında yerleşim yok)', async (_n, body) => {
    open({ '/monuments/BUR-9001': { body } })
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    expect(document.querySelector('main')!.className).toBe('vk-mon vk-exhpage')
    expect([...document.querySelectorAll('.vk-exh__inner > *')].map((e) => e.classList[0])).toEqual(['vk-exh__text', 'vk-niche'])
    expect(document.querySelectorAll('.vk-niche .vk-obj')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Bilgi Görevine Başla' })).toHaveAttribute('href', '/oyun/eser/BUR-9001')
    expect(screen.getByRole('link', { name: 'Haritada Gör' })).toHaveAttribute('href', '/harita?eser=BUR-9001')
    expect(screen.getByRole('region', { name: 'Künye ve kaynaklar' })).toBeInTheDocument()
  })

  it('Fotoğraf Arşivi: bütün katalog fotoğrafları; inceleyici açılır, önceki/sonraki, bilgiler katalogdan; Esc kapatır, odak döner', async () => {
    open()
    const archive = await openArchive()
    const tiles = within(archive).getAllByRole('button', { name: /^İncele:/ })
    expect(tiles).toHaveLength(2)
    expect(within(tiles[0]).getByRole('img')).toHaveAttribute('alt', 'Deneme Camii, görsel 1')
    expect(within(tiles[0]).getByRole('img').getAttribute('src')).toContain('f1.jpeg')  // öne çıkan: özgün dosya
    expect(within(tiles[1]).getByRole('img').getAttribute('src')).toContain('f2-card.jpeg')  // dizilim: kart dosyası
    // Atıf ve lisanslar arşivin "Fotoğraf bilgileri" listesinde, her fotoğraf için (lisans bağlantılı).
    const credits = within(archive).getByText('Fotoğraf bilgileri (2)').closest('details')!
    expect(within(credits).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Fotoğraf: Çeken 1, CC BY-SA 4.0, Wikimedia Commons · CC-BY-SA-4.0',
      'Fotoğraf: Çeken 2, CC BY-SA 4.0, Wikimedia Commons · CC-BY-SA-4.0',
    ])

    await userEvent.click(tiles[1])
    const viewer = screen.getByRole('dialog', { name: 'Fotoğraf inceleme' })
    const close = within(viewer).getByRole('button', { name: 'İncelemeyi kapat' })
    expect(close).toHaveFocus()
    expect(within(viewer).getByText('Fotoğraf 2 / 2')).toBeInTheDocument()
    const meta = (term: string) => within(viewer).getByText(term, { selector: 'dt' }).nextElementSibling!
    expect(meta('Fotoğrafı çeken / hak sahibi')).toHaveTextContent('Çeken 2')
    expect(within(meta('Lisans') as HTMLElement).getByRole('link', { name: 'CC-BY-SA-4.0' }))
      .toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/')
    expect(meta('Atıf')).toHaveTextContent('Fotoğraf: Çeken 2, CC BY-SA 4.0, Wikimedia Commons')
    expect(within(viewer).queryByText('Kaynak', { selector: 'dt' })).not.toBeInTheDocument()  // katalogda yok: uydurulmaz

    await userEvent.click(within(viewer).getByRole('button', { name: 'Sonraki fotoğraf' }))
    expect(within(viewer).getByText('Fotoğraf 1 / 2')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    expect(within(viewer).getByText('Fotoğraf 2 / 2')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Fotoğraf inceleme' })).not.toBeInTheDocument()
    expect(tiles[1]).toHaveFocus()
  })

  it('beşten fazla fotoğrafta ilk görünümde 5 (öne çıkan + 4); "+N" ipucu; "Bütün fotoğrafları göster" hepsini açar; inceleyici hepsinde gezer', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => img(i + 1))
    open({ '/monuments/BUR-9001': { body: { ...DETAIL, images: seven } } })
    const archive = await openArchive()
    const tiles = () => within(archive).getAllByRole('button', { name: /^İncele:/ })
    expect(tiles()).toHaveLength(5)
    expect(within(tiles()[4]).getByText('+2')).toBeInTheDocument()
    expect(within(archive).getByText('7 yayımlanmış fotoğraf')).toBeInTheDocument()
    const toggle = within(archive).getByRole('button', { name: 'Bütün fotoğrafları göster (7)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(tiles()).toHaveLength(7)
    expect(within(archive).queryByText('+2')).not.toBeInTheDocument()
    expect(within(within(archive).getByText('Fotoğraf bilgileri (7)').closest('details')!).getAllByRole('listitem')).toHaveLength(7)
    await userEvent.click(within(archive).getByRole('button', { name: 'Daha az göster' }))
    expect(tiles()).toHaveLength(5)
    // Gizli fotoğraflara inceleyiciden de ulaşılır.
    await userEvent.click(tiles()[4])
    const viewer = screen.getByRole('dialog', { name: 'Fotoğraf inceleme' })
    await userEvent.click(within(viewer).getByRole('button', { name: 'Sonraki fotoğraf' }))
    expect(within(viewer).getByText('Fotoğraf 6 / 7')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(tiles()[4]).toHaveFocus()
  })

  it('kaynak ve açıklama katalogda varsa inceleyicide gösterilir', async () => {
    const withSource = { ...img(1), title: 'Batı cephesi', source_label: 'Wikimedia Commons', source_url: 'https://commons.wikimedia.org/wiki/File:Ornek.jpg' }
    open({ '/monuments/BUR-9001': { body: { ...DETAIL, images: [withSource] } } })
    const archive = await openArchive()
    await userEvent.click(within(archive).getByRole('button', { name: /^İncele: Batı cephesi/ }))
    const viewer = screen.getByRole('dialog', { name: 'Fotoğraf inceleme' })
    expect(within(viewer).getByText('Batı cephesi')).toBeInTheDocument()
    expect(within(viewer).getByRole('link', { name: 'Wikimedia Commons' })).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Ornek.jpg')
    expect(within(viewer).queryByRole('button', { name: 'Sonraki fotoğraf' })).not.toBeInTheDocument()  // tek fotoğraf
  })

  it('ziyaretini planla: adres ve ziyaret rotası; oyun rotası bu bölümde değil (R3.6)', async () => {
    open()
    const visit = await screen.findByRole('region', { name: 'Ziyaretini planla' })
    expect(within(visit).getByText(/Deneme Caddesi No: 1/)).toBeInTheDocument()
    expect(within(visit).getByRole('button', { name: 'Ziyaret rotama ekle' })).toBeInTheDocument()
    expect(within(visit).queryByRole('link', { name: 'Oyun rotasında gör' })).not.toBeInTheDocument()
    expect(screen.queryByText('Kilitli')).not.toBeInTheDocument()
  })
})

describe('R6.15.2 yerel önizleme fotoğrafları', () => {
  const LOCAL = {
    monument_id: 'BUR-9001',
    publication: { status: 'izin_bekleniyor', public: false, note: 'x' },
    images: [
      { image_id: 'LP-a', file: 'aaaaaaaaaaaaaaaaaaaa-lg.webp', card_file: 'aaaaaaaaaaaaaaaaaaaa-sm.webp', width: 1200, height: 800, source: 'Bursa Vakıf Eserleri Envanteri, Cilt I', pdf_page: 39, printed_pages: ['76'] },
      { image_id: 'LP-b', file: 'bbbbbbbbbbbbbbbbbbbb-lg.webp', card_file: 'bbbbbbbbbbbbbbbbbbbb-sm.webp', width: 900, height: 600, source: 'Bursa Vakıf Eserleri Envanteri, Cilt I' },
    ],
  }
  const calls = () => (globalThis.fetch as unknown as { mock: { calls: [unknown][] } }).mock.calls.map(([u]) => String(u))

  it('liste yalnızca arşiv açılınca istenir; fotoğraflar lisanslıların ardından kaynak yazısıyla; izin ayrı satırda', async () => {
    open({ '/monuments/BUR-9001/local-photos': { body: LOCAL } })
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    expect(calls().some((u) => u.includes('/local-photos'))).toBe(false)  // ilk sayfa yüklemesine girmez
    const archive = await openArchive()
    expect(await within(archive).findByText('2 yayımlanmış fotoğraf, 2 yerel önizleme fotoğrafı')).toBeInTheDocument()
    const tiles = within(archive).getAllByRole('button', { name: /^İncele:/ })
    expect(tiles).toHaveLength(4)
    expect(within(tiles[2]).getByText('Kaynak: Bursa Vakıf Eserleri Envanteri, Cilt I')).toBeInTheDocument()
    expect(within(tiles[2]).getByRole('img').getAttribute('src')).toContain('/local-media/aaaaaaaaaaaaaaaaaaaa-sm.webp')  // önizleme
    expect(within(tiles[2]).getByRole('img')).toHaveAttribute('loading', 'lazy')
    await userEvent.click(tiles[2])
    const viewer = screen.getByRole('dialog', { name: 'Fotoğraf inceleme' })
    expect(within(viewer).getByRole('img').getAttribute('src')).toContain('/local-media/aaaaaaaaaaaaaaaaaaaa-lg.webp')  // büyük sürüm yalnızca açınca
    const meta = (term: string) => within(viewer).getByText(term, { selector: 'dt' }).nextElementSibling!
    expect(meta('Kaynak')).toHaveTextContent('Bursa Vakıf Eserleri Envanteri, Cilt I, PDF s. 39, basılı s. 76')
    expect(meta('Yayın izni')).toHaveTextContent('Doğrulanmadı; yalnızca yerel önizleme, kamuya açık değil')
    expect(within(viewer).queryByText('Lisans', { selector: 'dt' })).not.toBeInTheDocument()  // lisans uydurulmaz
    expect(within(viewer).queryByText('Fotoğrafı çeken / hak sahibi', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('uç yoksa (canlı sunucu: 404) arşivde yalnızca lisanslı fotoğraflar ve "yayımlanmış" sayısı', async () => {
    open({ '/monuments/BUR-9001/local-photos': { status: 404, body: { detail: 'Bulunamadı.' } } })
    const archive = await openArchive()
    await waitFor(() => expect(calls().some((u) => u.includes('/local-photos'))).toBe(true))
    expect(within(archive).getAllByRole('button', { name: /^İncele:/ })).toHaveLength(2)
    expect(within(archive).getByText('2 yayımlanmış fotoğraf')).toBeInTheDocument()
    expect(within(archive).queryByText(/Kaynak: Bursa/)).not.toBeInTheDocument()
  })
})

describe('PhotoGallery etiketleri', () => {
  it('çeviri etiketleri verilirse düğme ve pencere adları onlardır; verilmezse Türkçe varsayılan', () => {
    const photos = [1, 2].map((n) => ({ key: `p${n}`, src: `/p${n}.jpg`, alt: `Foto ${n}` }))
    const { unmount } = render(<PhotoGallery photos={photos} label="Gallery" labels={{ prev: 'Previous photo', next: 'Next photo', open: 'Open larger view', thumb: 'Photo {n}' }} />)
    expect(screen.getAllByRole('button', { name: 'Previous photo' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Open larger view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo 2' })).toBeInTheDocument()
    unmount()
    render(<PhotoGallery photos={photos} label="Galeri" />)
    expect(screen.getByRole('button', { name: 'Büyük görünümde aç' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fotoğraf 2' })).toBeInTheDocument()
  })
})
