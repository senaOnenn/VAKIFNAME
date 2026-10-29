import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch, type Routes } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import type { ContentFact, ContentOverview, MonumentEdit } from './api'
import { locateQuote } from './screens/admin/quoteMatch'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'

// Leaflet jsdom'da çalışmaz: konum seçici, tıklamayı düğmeyle taklit eden yer tutucuyla değiştirilir.
vi.mock('./components/LocationPicker', () => ({
  default: ({ onPick }: { onPick: (p: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onPick({ lat: 40.1901, lng: 29.0612 })}>Haritada konum seç</button>
  ),
}))

const ADMIN = { user_id: 'u-1', email: 'yonetici@example.com', display_name: null, provider: 'password', is_admin: true }
const SOURCE = { source_id: 'SRC-0001', title: 'Kurgusal Envanter, Cilt I', page_count: 40, rights_confirmed: true,
  uploaded_at: '2026-10-29T09:00:00Z', uploaded_by: 'yonetici@example.com' }
const OVERVIEW: ContentOverview = {
  enabled: true,
  sources: [SOURCE],
  monuments: [
    { monument_id: 'BUR-1001', name: 'Kurgusal Ulu Cami', city: 'Bursa', type: 'cami', origin: 'catalog', status: 'published', facts: { draft: 0, published: 1 } },
    { monument_id: 'BUR-5001', name: 'Test Çeşmesi', city: 'Bursa', type: 'çeşme', origin: 'content', status: 'draft', facts: { draft: 1, published: 0 } },
  ],
  drafts: 1,
  vocab: {
    certainty: ['documented', 'reported', 'uncertain'],
    category: ['construction', 'architecture'],
    type: ['cami', 'çeşme', 'türbe'],
    cities: [{ slug: 'bursa', name: 'Bursa' }, { slug: 'kutahya', name: 'Kütahya' }],
  },
}
const QUOTE = 'Çeşme 1520 yılında mahalle halkı arasında toplanan bağışla yaptırılmıştır.'
// Kitap sayfasında satır sonu ve heceleme tiresi var: vurgu bunlara rağmen bulunmalı.
const PAGE_TEXT = 'Giriş satırı.\nÇeşme 1520 yılında mahalle halkı ara -\nsında toplanan bağışla yaptırılmıştır. Sonraki cümle.'
const FACT: ContentFact = {
  fact_id: 'BUR-5001-F001', monument_id: 'BUR-5001', title: 'Bağışla yapılan çeşme',
  text: 'Çeşme 1520 yılında mahalle halkının bağışıyla yaptırıldı.', category: 'construction', certainty: 'documented',
  source_id: 'SRC-0001', page: 12, quote: QUOTE, game_use: false, quest: null, origin: 'pipeline', status: 'draft',
  quote_check: 'found', updated_at: '2026-10-29T10:00:00Z', decision: null,
}
const MONUMENT: MonumentEdit = {
  monument: { monument_id: 'BUR-5001', name: 'Test Çeşmesi', alternative_names: [], type: 'çeşme', city: 'Bursa',
    district: 'Osmangazi', address: 'Test Sokağı', latitude: null, longitude: null, site_notice: null, origin: 'content',
    status: 'draft', decision: null },
  facts: [FACT],
  images: [],
}
const CATALOG_MONUMENT: MonumentEdit = {
  monument: { monument_id: 'BUR-1001', name: 'Kurgusal Ulu Cami', alternative_names: [], type: 'cami', city: 'Bursa',
    district: 'Osmangazi', address: 'Test Caddesi', latitude: 40.18, longitude: 29.06, site_notice: 'Sessiz olun.',
    origin: 'catalog', status: 'published', decision: null },
  facts: [],
  images: [],
}

const body = (init?: RequestInit) => (init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body)

function server(extra: Routes = {}) {
  return stubFetch({
    '/auth/me': { body: ADMIN },
    '/admin/content/overview': { body: OVERVIEW },
    '/admin/content/facts': { body: { facts: [FACT] } },
    '/admin/content/monuments/BUR-5001': { body: MONUMENT },
    '/admin/content/monuments/BUR-1001': { body: CATALOG_MONUMENT },
    '/admin/content/sources/SRC-0001/pages/12': { body: { source_id: 'SRC-0001', page: 12, page_count: 40, text: PAGE_TEXT } },
    '/admin/content/sources/SRC-0001/pages/13': { body: { source_id: 'SRC-0001', page: 13, page_count: 40, text: 'Başka bir sayfa.' } },
    '/admin/content/sources/SRC-0001/pages/1': { body: { source_id: 'SRC-0001', page: 1, page_count: 40, text: 'Kapak.' } },
    ...extra,
  })
}
const calls = (f: ReturnType<typeof stubFetch>, path: string) =>
  f.mock.calls.filter(([u]) => new URL(String(u)).pathname === path).map(([u, init]) => ({ url: String(u), init: init as RequestInit }))

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('alıntı bulma', () => {
  it('satır sonu, heceleme tiresi ve noktalama farkını yok sayar; özgün metindeki aralığı döndürür', () => {
    const hit = locateQuote(PAGE_TEXT, QUOTE)!
    expect(hit).not.toBeNull()
    expect(PAGE_TEXT.slice(hit.start, hit.end)).toBe('Çeşme 1520 yılında mahalle halkı ara -\nsında toplanan bağışla yaptırılmıştır')
    expect(locateQuote(PAGE_TEXT, 'Bu cümle sayfada yok.')).toBeNull()
    expect(locateQuote(PAGE_TEXT, 'a')).toBeNull()
  })
})

describe('içerik yönetimi ana sayfası', () => {
  it('taslak kuyruğunu esere göre, eserleri kaynağı ve durumuyla, kitapları izniyle gösterir', async () => {
    server()
    open('/yonetim/icerik')
    expect(await screen.findByRole('heading', { level: 1, name: 'İçerik yönetimi' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Yönetim bölümleri' })).getByRole('link', { name: 'İçerik' }))
      .toHaveAttribute('aria-current', 'page')
    expect((await screen.findByText('Onay bekleyen taslak')).nextSibling).toHaveTextContent('1')
    const queue = screen.getByRole('region', { name: 'Taslak kuyruğu' })
    expect(within(queue).getByText(/yönetici onaylayıp yayımlayana kadar ziyaretçilere görünmez/)).toBeInTheDocument()
    expect(await within(queue).findByRole('link', { name: 'Bağışla yapılan çeşme' })).toHaveAttribute('href', '/yonetim/icerik/kayit/BUR-5001-F001')
    expect(within(queue).getByRole('link', { name: 'Test Çeşmesi' })).toHaveAttribute('href', '/yonetim/icerik/eser/BUR-5001')
    const table = screen.getByRole('table')
    expect(within(table).getByRole('row', { name: /Kurgusal Ulu Cami.*Katalog.*Yayında/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Test Çeşmesi.*Yeni eser.*Taslak/ })).toBeInTheDocument()
    expect(screen.getByText('Kullanım izni var')).toBeInTheDocument()
  })

  it('içerik deposu kapalıysa bunu açıkça söyler', async () => {
    server({ '/admin/content/overview': { body: { ...OVERVIEW, enabled: false, sources: [], monuments: [], drafts: 0 } } })
    open('/yonetim/icerik')
    expect(await screen.findByText(/İçerik deposu bu sunucuda kapalı/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Taslak kuyruğu' })).not.toBeInTheDocument()
  })

  it('yönetici olmayan kullanıcı sunucunun nedenini okur', async () => {
    stubFetch({
      '/auth/me': { body: { ...ADMIN, is_admin: false } },
      '/admin/content/overview': { status: 403, body: { detail: 'Bu sayfa yalnızca yöneticilere açıktır.' } },
      '/admin/content/facts': { status: 403, body: { detail: 'Bu sayfa yalnızca yöneticilere açıktır.' } },
    })
    open('/yonetim/icerik')
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu sayfa yalnızca yöneticilere açıktır.')
  })

  it('kitap yükleme: dosya ham gövdeyle gider, sonra başlık ve kullanım izniyle kaynak açılır', async () => {
    const f = server({
      '/admin/content/uploads': { body: { upload_id: 'UP-1', kind: 'pdf', size: 9 } },
      '/admin/content/sources': { body: { ...SOURCE, source_id: 'SRC-0002', title: 'Yeni Cilt', page_count: 3 } },
    })
    open('/yonetim/icerik')
    const form = await screen.findByRole('form', { name: 'Kitap ekle' })
    const pdf = new File(['%PDF-1.4'], 'cilt.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(form).getByLabelText('PDF dosyası'), pdf)
    await userEvent.type(within(form).getByLabelText('Başlık'), 'Yeni Cilt')
    await userEvent.click(within(form).getByRole('button', { name: 'Kitabı ekle' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('kullanım izni seçimi gerekli')
    expect(calls(f, '/admin/content/uploads')).toHaveLength(0)

    await userEvent.click(within(form).getByRole('radio', { name: /Evet, kullanım izni var/ }))
    await userEvent.click(within(form).getByRole('button', { name: 'Kitabı ekle' }))
    expect(await within(form).findByText('"Yeni Cilt" eklendi (3 sayfa).')).toBeInTheDocument()
    const [up] = calls(f, '/admin/content/uploads')
    expect((up.init.headers as Record<string, string>)['Content-Type']).toBe('application/pdf')
    expect(up.init.body).toBe(pdf)
    expect(up.init.credentials).toBe('include')
    const [src] = calls(f, '/admin/content/sources')
    expect(body(src.init)).toEqual({ upload_id: 'UP-1', title: 'Yeni Cilt', rights_confirmed: true })
    await waitFor(() => expect(calls(f, '/admin/content/overview').length).toBeGreaterThan(1))
  })
})

describe('kayıt düzenleyici', () => {
  it('kaynak sayfayı alıntı vurgulu gösterir ve değişmemiş taslağı onaylayıp yayımlar', async () => {
    const f = server({ '/admin/content/facts/BUR-5001-F001/publish': { body: { ...FACT, status: 'published' } } })
    open('/yonetim/icerik/kayit/BUR-5001-F001')
    expect(await screen.findByRole('heading', { level: 1, name: 'Kaydı incele' })).toBeInTheDocument()
    expect(screen.getByText(/yönetici onaylayıp yayımlayana kadar ziyaretçilere görünmez/)).toBeInTheDocument()
    expect(screen.getByText('Hat (kitaptan aday)')).toBeInTheDocument()
    const page = await screen.findByLabelText('Kaynak sayfa 12 metni')
    expect(page.querySelector('mark')).toHaveTextContent(/^Çeşme 1520 .* yaptırılmıştır$/)
    expect(screen.getByText('Alıntı bu sayfada bulundu (vurgulu).')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Onayla ve yayımla' }))
    expect(await screen.findByText('Onaylandı ve yayımlandı.')).toBeInTheDocument()
    expect(calls(f, '/admin/content/facts/BUR-5001-F001/publish')[0].init.method).toBe('POST')
  })

  it('sunucunun kural reddini (409) olduğu gibi gösterir', async () => {
    server({
      '/admin/content/facts/BUR-5001-F001/publish': { status: 409, body: { detail: 'Kaynağın kullanım izni onaylanmadığı için kayıt yayımlanamaz.' } },
    })
    open('/yonetim/icerik/kayit/BUR-5001-F001')
    await userEvent.click(await screen.findByRole('button', { name: 'Onayla ve yayımla' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kaynağın kullanım izni onaylanmadığı için kayıt yayımlanamaz.')
  })

  it('düzenlenen kayıt PUT ile kaydedilip yayımlanır; komşu sayfaya geçilince alıntı uyarısı çıkar', async () => {
    const f = server({ '/admin/content/facts/BUR-5001-F001': { body: { ...FACT, status: 'published', certainty: 'reported' } } })
    open('/yonetim/icerik/kayit/BUR-5001-F001')
    await screen.findByLabelText('Kaynak sayfa 12 metni')
    await userEvent.selectOptions(screen.getByLabelText('Kesinlik'), 'reported')
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki sayfa →' }))
    expect(await screen.findByText(/alıntı bu sayfada bulunamadı/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Onayla ve yayımla' }))
    expect(await screen.findByText('Onaylandı ve yayımlandı.')).toBeInTheDocument()
    const [put] = calls(f, '/admin/content/facts/BUR-5001-F001')
    expect(put.init.method).toBe('PUT')
    expect(body(put.init)).toMatchObject({ certainty: 'reported', page: 12, source_id: 'SRC-0001', quote: QUOTE, publish: true })
  })

  it('elle kayıt: katalog eserine taslak olarak eklenir ve düzenleyiciye geçer', async () => {
    const created = { ...FACT, fact_id: 'BUR-1001-F501', monument_id: 'BUR-1001', origin: 'manual' as const, title: 'Elle eklenen bilgi', quote: '' }
    const f = server({
      '/admin/content/facts': (init?: RequestInit) => (init?.method === 'POST' ? { body: created } : { body: { facts: [] } }),
      '/admin/content/monuments/BUR-1001': { body: { ...CATALOG_MONUMENT, facts: [created] } },
    })
    open('/yonetim/icerik/eser/BUR-1001/yeni-kayit')
    expect(await screen.findByRole('heading', { level: 1, name: 'Yeni kayıt' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Başlık'), 'Elle eklenen bilgi')
    await userEvent.type(screen.getByLabelText(/^Metin/), 'Kaynakta yazan bilgi.')
    await userEvent.clear(screen.getByLabelText(/^Sayfa/))
    await userEvent.type(screen.getByLabelText(/^Sayfa/), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Taslak olarak kaydet' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kaydı incele' })).toBeInTheDocument()
    expect(screen.getByText('Kayıt taslak olarak eklendi.')).toBeInTheDocument()
    const post = calls(f, '/admin/content/facts').find((c) => c.init.method === 'POST')!
    expect(body(post.init)).toMatchObject({ monument_id: 'BUR-1001', title: 'Elle eklenen bilgi', page: 12, publish: false, quest: null })
  })
})

describe('eser ve hat', () => {
  it('kitapta arar, sonuçtan sayfa aralığı seçer, aday çıkarma işini bitene kadar izler', async () => {
    const f = server({
      '/admin/content/sources/SRC-0001/search': { body: { hits: [{ page: 12, snippet: '…Test Çeşmesi 1520…' }] } },
      '/admin/content/extract': { status: 202, body: { job_id: 'JOB-1', source_id: 'SRC-0001', monument_id: 'BUR-5001', page_from: 12,
        page_to: 13, status: 'queued', created_at: '2026-10-29T10:00:00Z', finished_at: null, candidates: 0, dropped: 0, error: null } },
      '/admin/content/jobs/JOB-1': { body: { job_id: 'JOB-1', source_id: 'SRC-0001', monument_id: 'BUR-5001', page_from: 12,
        page_to: 13, status: 'done', created_at: '2026-10-29T10:00:00Z', finished_at: '2026-10-29T10:01:00Z', candidates: 3, dropped: 1, error: null } },
    })
    open('/yonetim/icerik/eser/BUR-5001')
    const panel = await screen.findByRole('region', { name: 'Kitaptan aday kayıt çıkar' })
    expect(within(panel).getByLabelText('Kitapta ara (eserin geçtiği sayfaları bulun)')).toHaveValue('Test Çeşmesi')
    await userEvent.clear(within(panel).getByLabelText('Başlangıç sayfası'))
    await userEvent.type(within(panel).getByLabelText('Başlangıç sayfası'), '1')
    await userEvent.type(within(panel).getByLabelText('Bitiş sayfası'), '9')
    expect(within(panel).getByText('Tek seferde en fazla 6 sayfa okunabilir.')).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Ara' }))
    await userEvent.click(await within(panel).findByRole('button', { name: /s\. 12/ }))
    expect(within(panel).getByLabelText('Başlangıç sayfası')).toHaveValue(12)
    expect(within(panel).getByLabelText('Bitiş sayfası')).toHaveValue(13)
    await userEvent.click(within(panel).getByRole('button', { name: 'Aday kayıt çıkar' }))
    expect(await within(panel).findByText('Sıraya alındı…')).toBeInTheDocument()
    expect(await within(panel).findByText('Tamamlandı: 3 aday taslak oldu, 1 aday kaynağında bulunamadığı için düştü.', {}, { timeout: 4000 }))
      .toBeInTheDocument()
    expect(body(calls(f, '/admin/content/extract')[0].init)).toEqual({ source_id: 'SRC-0001', monument_id: 'BUR-5001', page_from: 12, page_to: 13 })
    await waitFor(() => expect(calls(f, '/admin/content/monuments/BUR-5001').length).toBeGreaterThan(1))
  }, 10_000)

  it('katalog eseri salt okunur; yeni eser formu yayımlayıp eserin sayfasına geçer', async () => {
    const created = { ...MONUMENT.monument, monument_id: 'BUR-5002', name: 'Yeni Türbe', type: 'türbe', status: 'published' as const,
      latitude: 40.1901, longitude: 29.0612 }
    const f = server({
      '/admin/content/monuments': { body: created },
      '/admin/content/monuments/BUR-5002': { body: { monument: created, facts: [], images: [] } },
    })
    open('/yonetim/icerik/eser/BUR-1001')
    expect(await screen.findByText(/kimlik alanları onaylı katalogdan gelir/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Ad')).not.toBeInTheDocument()

    window.history.pushState(null, '', '/yonetim/icerik/eser/yeni')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Eser ekle' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Ad'), 'Yeni Türbe')
    await userEvent.selectOptions(screen.getByLabelText('Tür'), 'türbe')
    await userEvent.type(screen.getByLabelText('İlçe'), 'Osmangazi')
    await userEvent.type(screen.getByLabelText('Adres'), 'Test Sokağı')
    await userEvent.click(await screen.findByRole('button', { name: 'Haritada konum seç' }))
    expect(screen.getByLabelText('Enlem')).toHaveValue('40.190100')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve yayımla' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Yeni Türbe' })).toBeInTheDocument()
    expect(screen.getByText('Eser eklendi ve yayımlandı.')).toBeInTheDocument()
    const post = calls(f, '/admin/content/monuments')[0]
    expect(body(post.init)).toEqual({
      name: 'Yeni Türbe', alternative_names: [], type: 'türbe', city: 'Bursa', district: 'Osmangazi', address: 'Test Sokağı',
      latitude: 40.1901, longitude: 29.0612, site_notice: null, publish: true,
    })
  })
})
