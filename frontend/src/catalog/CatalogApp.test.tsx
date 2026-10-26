import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { getVisitorId } from '../visitor'
import CatalogApp from './CatalogApp'
import { getMonument, getMonuments } from './catalogClient'
import type { MonumentMapProps } from './MonumentMap'
import type { MonumentDetail, MonumentSummary } from './types'

// Harita yer tutucusu kendisine verilen eserleri listeler; konumsuz eserin haritaya hiç verilmediği doğrulanır.
vi.mock('./MonumentMap', () => ({
  default: ({ monuments, onSelect }: MonumentMapProps) => (
    <ul aria-label="Harita işaretleyicileri">
      {monuments.map((m) => (
        <li key={m.monument_id}>
          <button type="button" onClick={() => onSelect(m.monument_id)}>
            İşaretleyici: {m.name} ({m.location.latitude}, {m.location.longitude})
          </button>
        </li>
      ))}
    </ul>
  ),
}))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Kurgusal kayıtlar; BUR-9xxx kimlikleri gerçek V20 eserleri değildir.
const LOCATED: MonumentSummary = {
  monument_id: 'BUR-9001',
  name: 'Kurgusal Konumlu Eser',
  type: 'cami',
  city: 'Test',
  district: 'Test',
  address: 'Test Caddesi',
  location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20 },
  checkin_available: false,
  fact_count: 1,
  game_fact_count: 0,
  image_count: 0,
  illustration: 'representative_drawing',
}
const UNLOCATED: MonumentSummary = { ...LOCATED, monument_id: 'BUR-9002', name: 'Kurgusal Konumsuz Eser', location: null }
const sealsPath = () => `/users/${getVisitorId()}/seals`
const emptySeals = (monuments: { monument_id: string; name: string; quests: number; solved: number; checkin_available: boolean }[] = []) => ({
  user_id: getVisitorId(),
  knowledge_seals: [],
  visit_seals: [],
  monuments,
})
const catalogBody = (monuments: MonumentSummary[]) => ({
  published_count: monuments.length,
  data_version: 'V20:test',
  generated_at: '2026-10-23T12:00:00Z',
  monuments,
})
const DETAIL: MonumentDetail = {
  monument_id: 'BUR-9002',
  name: 'Kurgusal Konumsuz Eser',
  alternative_names: ['Eski Ad'],
  type: 'cami',
  city: 'Test',
  district: 'Test',
  address: 'Test Caddesi',
  facts: [
    {
      fact_id: 'BUR-9002-F001',
      title: 'Kurgusal',
      text: 'Kurgusal onaylı bilgi.',
      category: 'construction',
      certainty: 'documented',
      source: { title: 'Kurgusal Kaynak Cilt II', pdf_physical_page: 116, page_kind: 'physical' },
      game_use: false,
    },
  ],
  images: [],
  location: null,
  checkin_available: false,
  checkin: null,
  site_notice: 'Aktif ibadet mekânı.',
  illustration: 'representative_drawing',
}

describe('Gerçek Bursa Eserleri', () => {
  it('ana sayfa bölümleri istenen sırada: video giriş, nasıl oynanır, eserler, harita, hikâye, pasaport, alt bilgi', async () => {
    stubFetch({ '/monuments': { body: catalogBody([]) } })
    render(<CatalogApp />)
    await screen.findByText('Henüz yayımlanmış gerçek eser yok')
    const headings = screen
      .getAllByRole('heading', { level: 1 })
      .concat(screen.getAllByRole('heading', { level: 2 }))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((h) => h.textContent?.replace(/\s+/g, ' ').trim())
    expect(headings).toEqual([
      'VAKIFNAME',
      'Merak et.İzini sür.',
      'Gerçek Bursa Eserleri',
      'Bursa Keşif Haritası',
      'Bursa’nın Kayıp Vakfiyesi',
      'Dijital Miras Pasaportu',
    ])
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Giriş videosu ve çizimler temsilîdir')
    expect(screen.getByText(/kurgusal hikâyesidir/)).toBeInTheDocument()
  })

  it('yayımlanmış eser yoksa bunu açıkça söyler; demo veya geliştirme bağlantısı yoktur', async () => {
    stubFetch({ '/monuments': { body: catalogBody([]) } })
    render(<CatalogApp />)
    expect(await screen.findByText('Henüz yayımlanmış gerçek eser yok')).toBeInTheDocument()
    expect(screen.getByText(/kimliğini \(ad, tür, adres\) resmî kaynaklarla doğrulayıp/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Demo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Uygulama bölümleri' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Geliştirme ortamı|Demo Keşif Oyunu|Demo Mekân/)
    // Büyük boş harita kutusu yerine açıklayıcı boş durum ve kataloğa dönüş bağlantısı.
    expect(screen.getByText('Haritada henüz onaylı konum yok')).toBeInTheDocument()
    expect(screen.getByText(/tahmini nokta gösterilmez/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Keşif kataloğuna dön' })).toHaveAttribute('href', '#katalog')
    expect(screen.queryByRole('region', { name: 'Gerçek eser haritası' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Harita işaretleyicileri' })).not.toBeInTheDocument()
  })

  it('yalnızca konumu olan eseri haritaya verir; konumsuz eseri tahmini noktayla göstermez', async () => {
    stubFetch({ '/monuments': { body: catalogBody([LOCATED, UNLOCATED]) } })
    render(<CatalogApp />)
    const list = await screen.findByRole('list', { name: 'Gerçek eser listesi' })
    expect(within(list).getAllByRole('article')).toHaveLength(2)
    const markers = await screen.findByRole('list', { name: 'Harita işaretleyicileri' })
    expect(within(markers).getAllByRole('button')).toHaveLength(1)
    expect(markers).toHaveTextContent('Kurgusal Konumlu Eser (40.18, 29.06)')
    expect(markers).not.toHaveTextContent('Konumsuz')
    expect(screen.getByText(/1 eserin konumu henüz doğrulanmadığı için haritada işaretlenmedi/)).toBeInTheDocument()
    expect(within(list).getAllByText('Temsilî çizim · Eser fotoğrafı değildir')).toHaveLength(2)
  })

  it('eser hikâyesinde onaylı bilgileri kaynaklarıyla gösterir; ziyaret mührü kapalıdır', async () => {
    stubFetch({
      '/monuments': { body: catalogBody([UNLOCATED]) },
      '/monuments/BUR-9002': { body: DETAIL },
      '/monuments/BUR-9002/quests': { body: { monument_id: 'BUR-9002', quests: [], progress: { total: 0, solved: 0, solved_ids: [] } } },
      [sealsPath()]: { body: emptySeals() },
    })
    render(<CatalogApp />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayrıntıları gör: Kurgusal Konumsuz Eser' }))
    const story = await screen.findByRole('region', { name: 'Kurgusal Konumsuz Eser' })
    expect(await within(story).findByText('Kurgusal onaylı bilgi.')).toBeInTheDocument()
    expect(story).toHaveTextContent('Kaynakça: Kurgusal Kaynak Cilt II, s. 116')
    expect(story).toHaveTextContent('Fiziksel ziyaret mührü bu eserde henüz açık değil')
    expect(story).toHaveTextContent('Temsilî çizim · Lisansı onaylanmış fotoğraf henüz yok')
    const panel = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    expect(await within(panel).findByText(/Konum henüz doğrulanmadı; eser haritada gösterilmiyor./)).toBeInTheDocument()
    expect(window.location.search).toBe('?eser=BUR-9002')
  })

  it('proje arşivi koleksiyonunu ayrı galeride, arşiv sınıflandırması ve kimlik çelişkisiyle gösterir', async () => {
    const archive = {
      collection_id: 'test',
      source_label: 'Hackathon veri paketi / Proje ekibinin hazırladığı görsel arşiv',
      note: 'Arşivdeki klasör sınıflandırmasıyla gösterilir.',
      images: [
        { image_id: 'zip/a', file: `${'a'.repeat(64)}.jpg`, width: 800, height: 600, archive_folder: 'Kurgusal Klasör', identity: 'celiski_yok' as const },
        {
          image_id: 'zip/b',
          file: `${'b'.repeat(64)}.jpg`,
          width: 400,
          height: 300,
          archive_folder: 'Kurgusal Klasör',
          identity: 'belgelenmis_celiski' as const,
          identity_note: 'Eser kimliği doğrulanmadı: bu fotoğraf envanter kitabında başka bir yapının bölümünde basılı.',
        },
      ],
    }
    stubFetch({
      '/monuments': { body: catalogBody([UNLOCATED]) },
      '/monuments/BUR-9002': { body: { ...DETAIL, archive_collection: archive } },
      '/monuments/BUR-9002/quests': { body: { monument_id: 'BUR-9002', quests: [], progress: { total: 0, solved: 0, solved_ids: [] } } },
      [sealsPath()]: { body: emptySeals() },
    })
    render(<CatalogApp />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayrıntıları gör: Kurgusal Konumsuz Eser' }))
    const gallery = await screen.findByRole('region', { name: 'Kurgusal Konumsuz Eser — proje arşivi fotoğrafları' })
    // Onaylı fotoğraf olmadığı için temsilî çizim kalır; arşiv fotoğrafları onu yerinden etmez.
    expect(screen.getByText('Temsilî çizim · Lisansı onaylanmış fotoğraf henüz yok')).toBeInTheDocument()
    expect(gallery).toHaveTextContent('1 / 2')
    expect(gallery).toHaveTextContent('Arşivdeki sınıflandırma: Kurgusal Klasör')
    expect(gallery).toHaveTextContent('Kaynak: Hackathon veri paketi / Proje ekibinin hazırladığı görsel arşiv')
    expect(gallery).not.toHaveTextContent(/Eser kimliği doğrulanmadı|Lisans|CC /)
    await userEvent.click(within(gallery).getByRole('button', { name: 'Sonraki fotoğraf' }))
    expect(gallery).toHaveTextContent('2 / 2')
    expect(gallery).toHaveTextContent('Eser kimliği doğrulanmadı: bu fotoğraf envanter kitabında başka bir yapının bölümünde basılı.')
    expect(within(gallery).getAllByRole('img')[0]).toHaveAttribute('width', '400')
  })

  it('keşif sorusunu sunucuda denetletir; yanlışta cevabı açıklamaz, doğruda bilgi mührünü gösterir', async () => {
    const QUEST = { quest_id: 'BUR-9002-F001', fact_title: 'Kurgusal', question: 'Kurgusal soru?', choices: ['A', 'B'] }
    const progress = (solved: number) => ({ total: 1, solved, solved_ids: solved ? ['BUR-9002-F001'] : [] })
    const answers: unknown[] = []
    stubFetch({
      '/monuments': { body: catalogBody([UNLOCATED]) },
      '/monuments/BUR-9002': { body: { ...DETAIL, quests: [QUEST] } },
      '/monuments/BUR-9002/quests': { body: { monument_id: 'BUR-9002', quests: [QUEST], progress: progress(0) } },
      '/monuments/BUR-9002/quests/BUR-9002-F001/answer': async (init?: RequestInit) => {
        const body = JSON.parse(String(init?.body))
        answers.push(body)
        const correct = body.choice_index === 1
        return {
          body: {
            correct,
            already_solved: false,
            explanation: correct ? 'Çünkü kurgusal.' : null,
            fact: null,
            progress: progress(correct ? 1 : 0),
            knowledge_seal: correct
              ? { user_id: body.user_id, monument_id: 'BUR-9002', kind: 'knowledge', monument_name: 'Kurgusal Konumsuz Eser', earned_at: '2026-10-24T10:00:00+00:00', new: true }
              : null,
          },
        }
      },
      [sealsPath()]: { body: emptySeals() },
    })
    render(<CatalogApp />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayrıntıları gör: Kurgusal Konumsuz Eser' }))
    const quest = await screen.findByRole('group', { name: 'Kurgusal soru?' })
    await userEvent.click(within(quest).getByRole('radio', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cevapla' }))
    expect(await screen.findByText(/Doğru değil/)).toBeInTheDocument()
    expect(screen.queryByText(/Çünkü kurgusal/)).not.toBeInTheDocument()
    await userEvent.click(within(quest).getByRole('radio', { name: 'B' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cevapla' }))
    expect(await screen.findByText(/Çünkü kurgusal/)).toBeInTheDocument()
    expect(screen.getByText('Kurgusal Konumsuz Eser bilgi mührü pasaportunda')).toBeInTheDocument()
    expect(screen.getByText('1/1 soru çözüldü')).toBeInTheDocument()
    expect(answers).toEqual([
      { user_id: getVisitorId(), choice_index: 0 },
      { user_id: getVisitorId(), choice_index: 1 },
    ])
  })

  it('lisanslı kapak fotoğrafını yazar ve lisansıyla gösterir', async () => {
    const withCover: MonumentSummary = {
      ...LOCATED,
      image_count: 1,
      cover: { file: 'a'.repeat(64) + '.jpeg', attribution: 'Fotoğraf: Test Kişi, CC BY-SA 4.0, Wikimedia Commons', license: 'CC-BY-SA-4.0', title: null, source_url: null },
    }
    stubFetch({ '/monuments': { body: catalogBody([withCover]) }, [sealsPath()]: { body: emptySeals() } })
    render(<CatalogApp />)
    const list = await screen.findByRole('list', { name: 'Gerçek eser listesi' })
    const img = within(list).getByRole('img', { name: 'Kurgusal Konumlu Eser fotoğrafı' })
    expect(img.getAttribute('src')).toMatch(/\/monuments\/media\/a{64}\.jpeg$/)
    expect(list).toHaveTextContent('Fotoğraf: Test Kişi, CC BY-SA 4.0, Wikimedia Commons')
    expect(within(list).queryByText('Temsilî çizim · Eser fotoğrafı değildir')).not.toBeInTheDocument()
  })

  it('dahili API veya demo uçlarını çağırmaz', async () => {
    const fetchMock = stubFetch({ '/monuments': { body: catalogBody([LOCATED]) } })
    render(<CatalogApp />)
    await screen.findByRole('list', { name: 'Gerçek eser listesi' })
    const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
    // Yalnızca genel katalog ve gerçek eser mühürleri; demo pasaportu (`/users/…/passport`), `/places` veya `/internal` yok.
    expect(paths).toContain('/monuments')
    expect(paths.filter((p) => p !== '/monuments').every((p) => /^\/users\/ziyaretci-[\w-]+\/seals$/.test(p))).toBe(true)
    expect(paths.some((p) => p.startsWith('/internal') || p.startsWith('/places') || p.endsWith('/passport'))).toBe(false)
  })
})

describe('katalog istemcisi', () => {
  it.each([
    ['yarım koordinat', { ...LOCATED, location: { latitude: 40.18, longitude: null, accuracy_m: 5 } }],
    ['0,0 koordinatı', { ...LOCATED, location: { latitude: 0, longitude: 0, accuracy_m: 5 } }],
    ['aralık dışı enlem', { ...LOCATED, location: { latitude: 91, longitude: 29, accuracy_m: 5 } }],
    ['konumsuz check-in', { ...UNLOCATED, checkin_available: true }],
    ['gerçek olmayan kimlik', { ...LOCATED, monument_id: 'demo-mekan-a' }],
  ])('tutarsız katalog yanıtını reddeder: %s', async (_name, monument) => {
    stubFetch({ '/monuments': { body: catalogBody([monument as MonumentSummary]) } })
    await expect(getMonuments()).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('yayın sayısı listeyle uyuşmazsa reddeder', async () => {
    stubFetch({ '/monuments': { body: { ...catalogBody([LOCATED]), published_count: 3 } } })
    await expect(getMonuments()).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('başka bir eserin ayrıntısını reddeder ve yayımlanmamış eser için 404 döndürür', async () => {
    stubFetch({ '/monuments/BUR-9001': { body: DETAIL } })
    await expect(getMonument('BUR-9001')).rejects.toMatchObject({ kind: 'invalid-response' })
    stubFetch({ '/monuments/BUR-9003': { status: 404, body: { detail: 'Eser bulunamadı veya henüz yayımlanmadı.' } } })
    await expect(getMonument('BUR-9003')).rejects.toMatchObject({ kind: 'http', status: 404 })
  })
})

describe('gerçek eser pasaportu', () => {
  it('demo pasaportunu değil gerçek eser mühürlerini okur; mühür türlerini ayrı gösterir', async () => {
    const fetchMock = stubFetch({ '/monuments': { body: catalogBody([]) } })
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path === '/monuments') return new Response(JSON.stringify(catalogBody([])), { status: 200 })
      const id = path.split('/')[2]
      return new Response(JSON.stringify({ user_id: id, knowledge_seals: [], visit_seals: [], monuments: [] }), { status: 200 })
    })
    render(<CatalogApp />)
    const section = await screen.findByRole('region', { name: 'Dijital Miras Pasaportu' })
    expect(await within(section).findByText(/Henüz bilgi mührü yok/)).toBeInTheDocument()
    expect(within(section).getByText(/Ziyaret mühürleri, eserlerin güvenli giriş noktası sahada doğrulandıkça/)).toBeInTheDocument()
    expect(section).toHaveTextContent('hesap değildir')
    expect(within(section).queryByRole('link', { name: /Demo/ })).not.toBeInTheDocument()
    const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
    expect(paths.some((p) => p.endsWith('/seals'))).toBe(true)
    expect(paths.some((p) => p.endsWith('/passport'))).toBe(false)
  })
})
