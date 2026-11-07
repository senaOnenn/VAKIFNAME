import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch, SIGNED_IN, PROFILE } from '../test/fixtures'
import type { GameState } from './api'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import { loadPlan } from './visitPlan'
import VakifnameApp from './VakifnameApp'

// R3.9 eser sayfası: erişim (Tarih Defteri penceresi, ziyaret planı, oyun bağlantısı) ve sağdan açılan rehber paneli.
// Kurgusal eser (BUR-9xxx gerçek katalog kimliği değildir).
const LOC = { latitude: 40.18, longitude: 29.06, accuracy_m: 20, represents: 'building_footprint_centroid' }
const detail = (location: typeof LOC | null = LOC) => ({
  monument_id: 'BUR-9001', name: 'Deneme Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
  address: 'Deneme Caddesi No: 1', location, checkin_available: false, checkin: null, site_notice: null,
  illustration: 'representative_drawing', images: [],
  facts: [{ fact_id: 'BUR-9001-F001', title: 'Kayıt 1', text: 'Kayıt 1 metni.', category: 'construction', certainty: 'documented',
    source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 21, page_kind: 'physical' }, game_use: true }],
})
const game = (over: Partial<GameState> = {}): GameState => ({
  monument_id: 'BUR-9001', locked: false, listened: false, asked: false, guide_required: true, ready_for_quiz: false,
  quiz_size: 5, pass_mark: 4, knowledge: null, visit: null, visit_radius_m: 50, simulated_visit_allowed: false, site_notice: null,
  ...over,
})

function open(opts: { location?: typeof LOC | null; game?: GameState | null } = {}) {
  stubFetch({
    '/auth/me': SIGNED_IN,
    '/player/profile': PROFILE,
    '/monuments/BUR-9001': { body: detail(opts.location === undefined ? LOC : opts.location) },
    '/guide/status': { body: { enabled: false } },
    ...(opts.game ? { '/monuments/BUR-9001/game': { body: opts.game } } : {}),
  })
  window.history.replaceState(null, '', '/eser/BUR-9001')
  return render(<VakifnameApp />)
}
// R3.12: yan alan yok; eylemler sayfanın kendi bölümlerinde (giriş ve müze duvar etiketi).
const rail = async () => {
  await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
  return document.body
}
const visit = async () => within(await rail()).getByRole('region', { name: 'Ziyaretini planla' })
const tool = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

const ANSWER = {
  question: 'Kim yaptırdı?', mode: 'generative', status: 'answered', message: '',
  sentences: [{ text: 'Yapıyı Deneme Bey yaptırmıştır.', sources: ['BUR-9001-F001'] }],
  facts: [{ fact_id: 'BUR-9001-F001', monument_id: 'BUR-9001', monument_name: 'Deneme Camii', title: 'Kayıt 1', text: '...',
    category: 'construction', certainty: 'documented', certainty_label: 'Kaynaklarda belgelenmiş',
    sources: [{ title: 'K', publisher: 'Yayıncı', url: 'https://example.org/k' }], publication_decision_id: 'DEC-1' }],
  identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [], photo: null, search: null,
  fallback_reason: null, notice: '', usage: { calls: 1, prompt_tokens: 1, completion_tokens: 1, total_ms: 1 },
}
function openGuided(status: Record<string, unknown> = { enabled: true, configured: true }) {
  const second = { ...detail(), monument_id: 'BUR-9002', name: 'Deneme Han', type: 'han' }
  const fetchMock = stubFetch({
    '/auth/me': SIGNED_IN,
    '/player/profile': PROFILE,
    '/monuments/BUR-9001': { body: detail() },
    '/monuments/BUR-9002': { body: second },
    '/guide/status': { body: status },
    '/guide/ask': { body: ANSWER },
  })
  window.history.replaceState(null, '', '/eser/BUR-9001')
  render(<VakifnameApp />)
  return fetchMock
}
const fab = () => screen.getByRole('button', { name: 'Rehbere Sor' })
const drawer = () => screen.queryByRole('dialog', { name: 'Rehber' })
const book = () => screen.queryByRole('dialog', { name: 'Tarih Defteri' })
const calls = (f: ReturnType<typeof stubFetch>, path: string) => f.mock.calls.filter(([u]) => new URL(String(u)).pathname === path)

describe('Tarih Defteri penceresi', () => {
  it('arka arkaya üç kez açılıp kapanır; her seferinde ilk kayıt, sonraki/önceki çalışır, odak düğmeye döner', async () => {
    open()
    await rail()
    const btn = tool(/Tarih Defteri/)
    for (let round = 0; round < 3; round++) {
      await userEvent.click(btn)
      const dlg = book()!
      expect(within(dlg).getByRole('heading', { level: 3 })).toHaveTextContent('Kayıt 1')
      expect(btn).toHaveAttribute('aria-expanded', 'true')
      await userEvent.click(within(dlg).getByRole('button', { name: 'Defteri kapat' }))
      expect(book()).not.toBeInTheDocument()
      expect(btn).toHaveFocus()
    }
  })

  it('kapandıktan sonra sayfanın geri kalanı kullanılabilir (ziyaret rotası, rehber); arka plana tıklama da kapatır', async () => {
    open()
    await rail()
    await userEvent.click(tool(/Tarih Defteri/))
    const dlg = book()!
    await userEvent.click(dlg)  // pencerenin kendisi = arka plan alanı (içerik dışı)
    expect(book()).not.toBeInTheDocument()
    await userEvent.click(within(await visit()).getByRole('button', { name: 'Ziyaret rotama ekle' }))
    expect(loadPlan()).toEqual(['BUR-9001'])
    await userEvent.click(fab())
    expect(drawer()).toBeInTheDocument()
  })

  it('rehber açıkken defter açılırsa rehber kapanır (aynı anda tek pencere)', async () => {
    open()
    await rail()
    await userEvent.click(fab())
    expect(drawer()).toBeVisible()
    await userEvent.click(tool(/Tarih Defteri/))
    expect(book()).toBeInTheDocument()
    expect(fab()).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Rehber paneli', () => {
  it('sağ kenardaki düğme açar; sohbet sekmesiyle; Esc kapatır ve odak düğmeye döner', async () => {
    openGuided()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    expect(drawer()).not.toBeInTheDocument()  // ilk açılışa kadar oluşturulmaz (gereksiz API çağrısı yok)
    fab().focus()
    await userEvent.keyboard('{Enter}')
    const d = drawer()!
    expect(await within(d).findByRole('tab', { name: 'Rehberle Konuş' })).toHaveAttribute('aria-selected', 'true')
    expect(within(d).getByRole('tab', { name: 'Anlatım' })).toBeInTheDocument()  // anlatım, altyazı, hız ve tam metin aynı panelde
    await userEvent.keyboard('{Escape}')
    expect(drawer()).not.toBeInTheDocument()  // gizli (hidden): erişilebilirlik ağacında yok
    expect(fab()).toHaveFocus()
  })

  it('rehber düğmesi görünür "Rehbere Sor" etiketini taşır; etikete basmak da paneli açar', async () => {
    openGuided()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    expect(fab()).toHaveAccessibleName('Rehbere Sor')
    expect(fab()).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByText('Rehbere Sor'))
    expect(drawer()).toBeVisible()
    expect(fab()).toHaveAttribute('aria-expanded', 'true')
  })

  it('sohbet et → kapat → aç: mesajlar korunur; durum yeniden istenmez', async () => {
    const f = openGuided()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(fab())
    const box = await within(drawer()!).findByRole('textbox', { name: 'Sorunu yaz' })
    await vi.waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, 'Kim yaptırdı?')
    await userEvent.click(within(drawer()!).getByRole('button', { name: 'Sor' }))
    expect(await within(drawer()!).findByText('Yapıyı Deneme Bey yaptırmıştır.')).toBeInTheDocument()
    const statusCalls = calls(f, '/guide/status').length
    await userEvent.click(within(drawer()!).getByRole('button', { name: 'Rehberi kapat' }))
    expect(drawer()).not.toBeInTheDocument()
    await userEvent.click(fab())
    expect(within(drawer()!).getByText('Yapıyı Deneme Bey yaptırmıştır.')).toBeInTheDocument()
    expect(within(drawer()!).getByRole('list', { name: 'Kaynaklar' })).toBeInTheDocument()  // kaynaklı cevap korunur
    expect(calls(f, '/guide/status')).toHaveLength(statusCalls)
  })

  it('eser değişince önceki eserin sohbeti taşınmaz; sorular yeni eserin kimliğiyle gider', async () => {
    const f = openGuided()
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(fab())
    const box = await within(drawer()!).findByRole('textbox', { name: 'Sorunu yaz' })
    await vi.waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, 'Kim yaptırdı?')
    await userEvent.click(within(drawer()!).getByRole('button', { name: 'Sor' }))
    await within(drawer()!).findByText('Yapıyı Deneme Bey yaptırmıştır.')
    await act(async () => {
      window.history.pushState(null, '', '/eser/BUR-9002')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByRole('heading', { level: 1, name: 'Deneme Han' })
    // R3.11: panel site genelinde açık kalır; konusu yeni esere geçer, eski eserin sohbeti görünmez.
    await vi.waitFor(() => expect(drawer()).toHaveAccessibleDescription('Yerel rehber, canlandırma. Konu: Deneme Han'))
    expect(within(drawer()!).queryByText('Yapıyı Deneme Bey yaptırmıştır.')).not.toBeInTheDocument()
    const box2 = await within(drawer()!).findByRole('textbox', { name: 'Sorunu yaz' })
    await vi.waitFor(() => expect(box2).toBeEnabled())
    await userEvent.type(box2, 'Kim yaptırdı?')
    await userEvent.click(within(drawer()!).getByRole('button', { name: 'Sor' }))
    await vi.waitFor(() => expect(calls(f, '/guide/ask')).toHaveLength(2))
    expect(JSON.parse(String(calls(f, '/guide/ask')[1][1]!.body))).toMatchObject({ monument_id: 'BUR-9002', history: [] })
  })

  it.each([[true, 1], [false, 0], [undefined, 0]])('fotoğraf ekleme yalnızca photo=true iken (photo=%s)', async (photo, count) => {
    openGuided({ enabled: true, configured: true, ...(photo === undefined ? {} : { photo }) })
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(fab())
    await within(drawer()!).findByRole('textbox', { name: 'Sorunu yaz' })
    await vi.waitFor(() => expect(within(drawer()!).queryAllByLabelText(/Fotoğraf ekle/)).toHaveLength(count))
  })
})

describe('Ziyaretini planla (kısa)', () => {
  it('adres, ilçe ve şehir; Haritada Gör sergi girişinde (ziyaret bölümünde tekrar edilmez); koordinat yok', async () => {
    open()
    const v = await visit()
    expect(within(v).getByText('Deneme Caddesi No: 1')).toBeInTheDocument()
    expect(within(v).getByText('Osmangazi, Bursa')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Haritada Gör' })).toHaveAttribute('href', '/harita?eser=BUR-9001')
    expect(within(v).queryByRole('link', { name: /Haritada/ })).not.toBeInTheDocument()
    expect(document.querySelector('.vk-plate')).toBeNull()
    expect(within(v).queryByText(/°/)).not.toBeInTheDocument()
  })

  it('ziyaret rotasına eklenir ve çıkarılır (klavyeyle); duyurulur; oyun rotasından bağımsız', async () => {
    open()
    const v = await visit()
    within(v).getByRole('button', { name: 'Ziyaret rotama ekle' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(loadPlan()).toEqual(['BUR-9001'])
    expect(within(v).getByRole('status')).toHaveTextContent('Deneme Camii ziyaret rotana eklendi.')
    expect(within(v).getByRole('link', { name: 'Ziyaret rotamı haritada aç' })).toHaveAttribute('href', '/harita')
    expect(within(v).getByRole('button', { name: 'Ziyaret rotamdan çıkar' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(loadPlan()).toEqual([])
    expect(within(v).getByText(/oyun rotasından ve mühürlerden bağımsızdır/)).toBeInTheDocument()
  })

  it('konumu doğrulanmamış eserde rotaya ekleme yok; durum dürüstçe söylenir', async () => {
    open({ location: null })
    const v = await visit()
    expect(within(v).getByText('Bu eserin konumu henüz doğrulanmadı; haritada gösterilmiyor.')).toBeInTheDocument()
    expect(within(v).queryByRole('button', { name: /Ziyaret rotama/ })).not.toBeInTheDocument()
  })
})

describe('oyun bağlantısı', () => {
  it.each([
    ['kilitli', game({ locked: true })],
    ['bilgi mühürlü', game({ listened: true, asked: true, knowledge: { earned_at: '2026-11-01T10:00:00Z' } })],
  ])('%s eserde yalnızca "Bilgi Görevine Başla"; büyük mühür ve kademeler yok', async (_n, g) => {
    open({ game: g })
    const r = await rail()
    expect(await within(r).findByRole('link', { name: 'Bilgi Görevine Başla' })).toHaveAttribute('href', '/oyun/eser/BUR-9001')
    expect(screen.queryByRole('list', { name: /kademe/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mühür yoluna git' })).not.toBeInTheDocument()
    expect(screen.queryByText('Kilitli')).not.toBeInTheDocument()  // kilit oyun panelinde (R1)
  })

  it('oyun durumu alınamazsa bağlantı gösterilmez', async () => {
    open({ game: null })
    await rail()
    expect(screen.queryByRole('link', { name: 'Bilgi Görevine Başla' })).not.toBeInTheDocument()
  })
})
