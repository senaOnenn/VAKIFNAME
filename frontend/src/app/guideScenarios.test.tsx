import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch, type Routes } from '../test/fixtures'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import VakifnameApp from './VakifnameApp'

// R6.10 rehber senaryoları (A–F). Kurgusal eserler (BUR-9xxx gerçek katalog kimliği değildir); gerçek API çağrılmaz.
const LOC = { latitude: 40.18, longitude: 29.06, accuracy_m: 20 }
const fact = (id: string, n: number) => ({
  fact_id: `${id}-F00${n}`, title: `Kayıt ${n}`, text: `${id} kayıt ${n}.`, category: n === 1 ? 'construction' : 'function',
  certainty: 'documented', source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 20 + n, page_kind: 'physical' }, game_use: true,
})
const detail = (id: string, name: string) => ({
  monument_id: id, name, alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi', address: 'Deneme adresi',
  location: { ...LOC, represents: 'building_footprint_centroid' }, checkin_available: false, checkin: null, site_notice: null,
  illustration: 'representative_drawing', images: [], facts: [fact(id, 1), fact(id, 2)],
})
const summary = (id: string, name: string) => ({
  monument_id: id, name, alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi', address: 'Deneme adresi',
  location: LOC, checkin_available: false, fact_count: 2, game_fact_count: 2, image_count: 0, cover: null, lead: null,
  illustration: 'representative_drawing',
})
const ULU = detail('BUR-9001', 'Deneme Ulu Camii')
const KOZA = detail('BUR-9002', 'Deneme Koza Hanı')
const CATALOG = { published_count: 2, data_version: 't', generated_at: null,
  monuments: [summary('BUR-9001', 'Deneme Ulu Camii'), summary('BUR-9002', 'Deneme Koza Hanı')] }
const answer = (id: string | undefined) => ({
  question: 'q', mode: 'generative', status: 'answered', message: '',
  sentences: [{ text: id ? `${id} için kaynaklı cevap.` : 'Genel kaynaklı cevap.', sources: [id ? `${id}-F001` : 'BUR-9001-F001'] }],
  facts: [{ fact_id: id ? `${id}-F001` : 'BUR-9001-F001', monument_id: id ?? 'BUR-9001', monument_name: 'x', title: 'Kayıt 1', text: '...',
    category: 'construction', certainty: 'documented', certainty_label: 'Kaynaklarda belgelenmiş',
    sources: [{ title: 'K', publisher: 'Yayıncı', url: 'https://example.org/k' }], publication_decision_id: 'DEC-1' }],
  identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [], photo: null, search: null,
  fallback_reason: null, notice: '', usage: { calls: 1, prompt_tokens: 1, completion_tokens: 1, total_ms: 1 },
})

function open(path: string, extra: Routes = {}) {
  const fetchMock = stubFetch({
    '/auth/me': { status: 401, body: {} },
    '/monuments': { body: CATALOG },
    '/monuments/BUR-9001': { body: ULU },
    '/monuments/BUR-9002': { body: KOZA },
    '/route': { status: 500, body: { detail: 'x' } },
    '/guide/status': { body: { enabled: true, configured: true } },
    '/guide/ask': (init?: RequestInit) => ({ body: answer(JSON.parse(String(init!.body)).monument_id) }),
    ...extra,
  })
  window.history.replaceState(null, '', path)
  render(<VakifnameApp />)
  return fetchMock
}
const drawer = () => screen.queryByRole('dialog', { name: 'Rehber' })
const asks = (f: ReturnType<typeof stubFetch>) =>
  f.mock.calls.filter(([u]) => new URL(String(u)).pathname === '/guide/ask').map(([, init]) => JSON.parse(String(init!.body)))
const go = async (path: string) => {
  await act(async () => {
    window.history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}
async function openGuide() {
  await userEvent.click(await screen.findByRole('button', { name: 'Rehbere Sor' }))
  return drawer()!
}
async function say(text: string) {
  const d = drawer()!
  // R6.12: panelin içeriği ilk açılışta ayrı parçadan yüklenir.
  await within(d).findAllByRole('textbox', { name: 'Sorunu yaz' })
  const boxes = within(d).getAllByRole('textbox', { name: 'Sorunu yaz' }).filter((b) => !b.closest('[hidden]'))
  expect(boxes).toHaveLength(1)
  await userEvent.type(boxes[0], text)
  await userEvent.click(within(boxes[0].closest('form')!).getByRole('button', { name: 'Sor' }))
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('R6.10 rehber senaryoları', () => {
  it('A: Keşfet sayfasında "Selam" normal karşılık alır; kaynak taranmaz, API çağrılmaz', async () => {
    const f = open('/eserler')
    const d = await openGuide()
    await say('Selam')
    expect(await within(d).findByText(/Merhaba! Ben VAKIFNAME’nin yerel rehberiyim/)).toBeInTheDocument()
    expect(within(d).queryByText('Kaynaklar taranıyor…')).not.toBeInTheDocument()
    expect(asks(f)).toHaveLength(0)
  })

  it('B: eser sayfasında "Bu eserin banisi kim?" o eserin kimliğiyle kaynaklı hatta gider', async () => {
    const f = open('/eser/BUR-9001')
    await screen.findByRole('heading', { level: 1, name: 'Deneme Ulu Camii' })
    const d = await openGuide()
    expect(within(d).getByText('Yerel rehber, canlandırma. Konu: Deneme Ulu Camii')).toBeInTheDocument()
    await say('Bu eserin banisi kim?')
    expect(await within(d).findByText('BUR-9001 için kaynaklı cevap.')).toBeInTheDocument()
    expect(asks(f).map((b) => b.monument_id)).toEqual(['BUR-9001'])
  })

  it('C: başka esere geçince eski bağlam taşınmaz; yeni eser yüklenene dek eski eserin sohbeti gösterilmez', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    const f = open('/eser/BUR-9001', { '/monuments/BUR-9002': async () => (await gate, { body: KOZA }) })
    await screen.findByRole('heading', { level: 1, name: 'Deneme Ulu Camii' })
    const d = await openGuide()
    await say('Bu eserin banisi kim?')
    await within(d).findByText('BUR-9001 için kaynaklı cevap.')
    await go('/eser/BUR-9002')
    // Koza Hanı henüz yüklenmedi: panel Ulu Camii bağlamını göstermez (genel sohbet).
    expect(within(drawer()!).queryByText('Yerel rehber, canlandırma. Konu: Deneme Ulu Camii')).not.toBeInTheDocument()
    await act(async () => release())
    await screen.findByRole('heading', { level: 1, name: 'Deneme Koza Hanı' })
    expect(await within(drawer()!).findByText('Yerel rehber, canlandırma. Konu: Deneme Koza Hanı')).toBeInTheDocument()
    const visibleText = (s: string) => within(drawer()!).queryAllByText(s).filter((e) => !e.closest('[hidden]'))
    expect(visibleText('BUR-9001 için kaynaklı cevap.')).toHaveLength(0)
    await say('Bu eser ne amaçla kullanılmış?')
    expect(await within(drawer()!).findByText('BUR-9002 için kaynaklı cevap.')).toBeInTheDocument()
    expect(asks(f).map((b) => b.monument_id)).toEqual(['BUR-9001', 'BUR-9002'])
    // Eski eserin konuşması yeni eserin geçmişi olarak gönderilmez.
    expect(asks(f)[1].history).toEqual([])
  })

  it('D: Keşfet → eser → Harita: genel sohbet korunur; haritada seçili eser varsa o eserin bağlamı', async () => {
    const f = open('/eserler')
    const d = await openGuide()
    await say('Selam')
    await within(d).findByText(/Merhaba! Ben VAKIFNAME’nin yerel rehberiyim/)
    await go('/eser/BUR-9001')
    await screen.findByRole('heading', { level: 1, name: 'Deneme Ulu Camii' })
    expect(await within(drawer()!).findByText('Yerel rehber, canlandırma. Konu: Deneme Ulu Camii')).toBeInTheDocument()
    await go('/harita')
    expect(await within(drawer()!).findByText('Yerel rehber, canlandırma. Konu: bütün eserler')).toBeInTheDocument()
    const shown = within(drawer()!).getAllByText(/Merhaba! Ben VAKIFNAME’nin yerel rehberiyim/).filter((e) => !e.closest('[hidden]'))
    expect(shown).toHaveLength(1)  // genel sohbet yerinde
    await go('/harita?eser=BUR-9002')
    expect(await within(drawer()!).findByText('Yerel rehber, canlandırma. Konu: Deneme Koza Hanı')).toBeInTheDocument()
    await say('Bu eser ne amaçla kullanılmış?')
    expect(await within(drawer()!).findByText('BUR-9002 için kaynaklı cevap.')).toBeInTheDocument()
    expect(asks(f).map((b) => b.monument_id)).toEqual(['BUR-9002'])
  })

  it('E: sunucuya ulaşılamazsa sonsuz bekleme yok; anlaşılır hata ve "Tekrar dene" aynı soruyu yeniden gönderir', async () => {
    let fail = true
    const f = open('/eserler', {
      '/guide/ask': (init?: RequestInit) => (fail ? new TypeError('Failed to fetch') : { body: answer(JSON.parse(String(init!.body)).monument_id) }),
    })
    const d = await openGuide()
    await say('Külliye nedir?')
    expect(await within(d).findByText('Rehbere ulaşılamadı. Bağlantını kontrol edip tekrar dene.')).toBeInTheDocument()
    expect(within(d).queryByText('Kaynaklar taranıyor…')).not.toBeInTheDocument()
    expect(within(d).getByRole('textbox', { name: 'Sorunu yaz' })).toBeEnabled()
    fail = false
    await userEvent.click(within(d).getByRole('button', { name: 'Tekrar dene' }))
    expect(await within(d).findByText('Genel kaynaklı cevap.')).toBeInTheDocument()
    expect(within(d).queryByText(/Rehbere ulaşılamadı/)).not.toBeInTheDocument()
    expect(within(d).getAllByText('Külliye nedir?')).toHaveLength(1)
    expect(asks(f)).toHaveLength(2)
  })

  it('E: uzun süren soru "Durdur" ile bırakılır; bekleme biter, kutu kullanılabilir', async () => {
    open('/eserler', { '/guide/ask': () => new Promise(() => undefined) })
    const d = await openGuide()
    await say('Külliye nedir?')
    expect(await within(d).findByText('Kaynaklar taranıyor…')).toBeInTheDocument()
    await userEvent.click(within(d).getByRole('button', { name: 'Durdur' }))
    expect(within(d).queryByText('Kaynaklar taranıyor…')).not.toBeInTheDocument()
    expect(within(d).getByText('Soruyu durdurdun.')).toBeInTheDocument()
    expect(within(d).getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument()
    await userEvent.type(within(d).getByRole('textbox', { name: 'Sorunu yaz' }), 'Teşekkürler{Enter}')
    expect(await within(d).findByText('Rica ederim! Başka bir sorun olursa buradayım.')).toBeInTheDocument()
  })

  it('F: Rozeti Al sorularında rehber yoktur (cevap sızmaz); açık panel kapanır', async () => {
    open('/eser/BUR-9001')
    await screen.findByRole('heading', { level: 1, name: 'Deneme Ulu Camii' })
    await openGuide()
    await go('/oyun/eser/BUR-9001/rozet')
    expect(drawer()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rehbere Sor' })).not.toBeInTheDocument()
  })

  describe('R6.12 rehber panelinde fotoğraf', () => {
    const jpg = () => new File([new Uint8Array([255, 216, 255, 224])], 'yapi.jpg', { type: 'image/jpeg' })
    const PHOTO_OK = { enabled: true, configured: true, photo: true, max_image_mb: 6 }
    const MATCHED = {
      ...answer('BUR-9001'), status: 'answered',
      photo: { is_architecture: true, building_type: 'cami', features: ['iki minare', 'çok kubbeli çatı'], visible_text: '',
        architecture_explanation: '', description: 'Fotoğrafta iki minareli, çok kubbeli bir yapı görülüyor.', material_guess: '',
        identity: null, synthetic_signs: [], candidates: [], metadata_removed: ['EXIF/XMP'], observed: true },
    }
    async function pick(d: HTMLElement, file = jpg()) {
      // accept süzgeci kapalı: tarayıcının seçicisini aşan (sürükle-bırak, "tüm dosyalar") dosya da denenir.
      await userEvent.setup({ applyAccept: false }).upload(await within(d).findByLabelText(/Fotoğraf ekle/), file)
    }

    it('Keşfet panelinde kamera simgeli "Fotoğraf ekle"; önizleme, kaldırma, onay ve gönderim; görülenler ile kaynaklı cevap ayrı', async () => {
      const f = open('/eserler', { '/guide/status': { body: PHOTO_OK }, '/guide/ask': { body: MATCHED } })
      const d = await openGuide()
      const input = await within(d).findByLabelText(/Fotoğraf ekle/)
      expect(input).not.toHaveAttribute('capture')  // kamera kendiliğinden açılmaz; cihazın seçicisi
      expect(input.closest('label')!.querySelector('svg')).not.toBeNull()
      await pick(d)
      expect(await within(d).findByRole('img', { name: 'Seçilen fotoğraf' })).toBeInTheDocument()
      await userEvent.click(within(d).getByRole('button', { name: 'Fotoğrafı kaldır' }))
      expect(within(d).queryByRole('img', { name: 'Seçilen fotoğraf' })).not.toBeInTheDocument()
      await pick(d)
      await within(d).findByRole('img', { name: 'Seçilen fotoğraf' })
      await userEvent.click(within(d).getByRole('checkbox', { name: /göndermeyi onaylıyorum/ }))
      await userEvent.click(within(d).getByRole('button', { name: 'Sor' }))
      expect(await within(d).findByRole('region', { name: 'Fotoğrafta görülenler' })).toBeInTheDocument()
      expect(within(d).getByText('Kaynaklı cevap')).toBeInTheDocument()
      const body = asks(f)[0]
      expect(body).toMatchObject({ image: { consent: true, mime: 'image/jpeg' } })
      expect(body).not.toHaveProperty('monument_id')  // genel panel: eser varsayılmaz
    })

    it('yüz/mahremiyet reddi anlaşılır gösterilir; "Tekrar dene" aynı fotoğrafı yeniden gönderir', async () => {
      let n = 0
      const f = open('/eserler', {
        '/guide/status': { body: PHOTO_OK },
        '/guide/ask': () => (++n === 1
          ? { status: 400, body: { detail: 'Fotoğrafta insan yüzü olabilir; gizlilik için analiz edilmedi.' } }
          : { body: MATCHED }),
      })
      const d = await openGuide()
      await pick(d)
      await within(d).findByRole('img', { name: 'Seçilen fotoğraf' })
      await userEvent.click(within(d).getByRole('checkbox', { name: /göndermeyi onaylıyorum/ }))
      await userEvent.click(within(d).getByRole('button', { name: 'Sor' }))
      expect(await within(d).findByText('Fotoğrafta insan yüzü olabilir; gizlilik için analiz edilmedi.')).toBeInTheDocument()
      await userEvent.click(within(d).getByRole('button', { name: 'Tekrar dene' }))
      await within(d).findByRole('region', { name: 'Fotoğrafta görülenler' })
      expect(asks(f)).toHaveLength(2)
      expect(asks(f)[1].image).toEqual(asks(f)[0].image)
    })

    it('desteklenmeyen dosya ve görsel servis hatası anlaşılır; sonsuz bekleme yok', async () => {
      open('/eserler', { '/guide/status': { body: PHOTO_OK }, '/guide/ask': { status: 503, body: { detail: 'Yapay zekâ rehberi şu anda kapalı.' } } })
      const d = await openGuide()
      await pick(d, new File(['x'], 'belge.pdf', { type: 'application/pdf' }))
      expect(await within(d).findByText(/Bu dosya türü desteklenmiyor/)).toBeInTheDocument()
      expect(within(d).queryByRole('img', { name: 'Seçilen fotoğraf' })).not.toBeInTheDocument()
      await pick(d)
      await within(d).findByRole('img', { name: 'Seçilen fotoğraf' })
      await userEvent.click(within(d).getByRole('checkbox', { name: /göndermeyi onaylıyorum/ }))
      await userEvent.click(within(d).getByRole('button', { name: 'Sor' }))
      expect(await within(d).findByText('Yapay zekâ rehberi şu anda kapalı.')).toBeInTheDocument()
      expect(within(d).queryByText(/Fotoğraf inceleniyor/)).not.toBeInTheDocument()
    })

    it('sunucu fotoğrafa hazır değilse (photo: false) seçenek sunulmaz', async () => {
      open('/eserler', { '/guide/status': { body: { ...PHOTO_OK, photo: false } } })
      const d = await openGuide()
      await within(d).findByRole('textbox', { name: 'Sorunu yaz' })
      expect(within(d).queryByLabelText(/Fotoğraf ekle/)).not.toBeInTheDocument()
    })
  })
})
