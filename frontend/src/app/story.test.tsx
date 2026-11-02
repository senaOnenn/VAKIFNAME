import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import { boxFor, camera, coverScale, mapPoint, MATCH, matchMove, nextStop, REST_P, SCENES, sceneMix, stopsOf, textVisibility } from './story/engine'
import VakifnameApp from './VakifnameApp'

// Ana sayfanın 7 sahnelik hikâyesi. Kimlikler kurgusaldır (gerçek katalog kimlikleri ön yüz kaynağına girmez).

const NAMES = [
  ['BUR-1001', 'Bursa Ulu Camii', 'cami'], ['BUR-1003', 'Muradiye Camii', 'cami'], ['BUR-1005', 'Muradiye Medresesi', 'medrese'],
  ['BUR-1007', 'Sultan II. Murad Türbesi', 'türbe'], ['BUR-1008', 'Cem Sultan Türbesi', 'türbe'], ['BUR-1009', 'Koza Han', 'han'],
  ['BUR-1013', 'Pirinç Han', 'han'], ['BUR-1014', 'Yıldırım Bayezid Bedesteni', 'bedesten'], ['BUR-1019', 'Osman Gazi Türbesi', 'türbe'],
  ['BUR-1020', 'Orhan Gazi Türbesi', 'türbe'],
] as const
const summary = ([id, name, type]: readonly [string, string, string]) => ({
  monument_id: id, name, alternative_names: [], type, city: 'Bursa', district: 'Osmangazi', address: '-',
  location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20 }, checkin_available: false, fact_count: 2, game_fact_count: 1, image_count: 1,
  cover: { file: `${id}-kapak.jpeg`, attribution: `Fotoğraf: ${name} çekeni, CC BY-SA 4.0, Wikimedia Commons`, license: 'CC-BY-SA-4.0', title: null, source_url: null },
  lead: `${name} kısa giriş.`, illustration: 'representative_drawing',
})
const CATALOG = { published_count: 10, data_version: 't', generated_at: null, monuments: NAMES.map(summary) }
const DETAIL = {
  monument_id: 'BUR-1014', name: 'Yıldırım Bayezid Bedesteni', alternative_names: [], type: 'bedesten', city: 'Bursa', district: 'Osmangazi',
  address: '-', location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20, represents: 'building_footprint_centroid' },
  checkin_available: false, checkin: null, site_notice: null, illustration: 'representative_drawing', facts: [], images: [],
}
const ANSWER = {
  question: 'x', mode: 'fallback_search', status: 'answered', message: 'Bunu kaynaklarımda bulamadım.',
  sentences: [], facts: [], identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [],
  photo: null, search: null, fallback_reason: null, notice: '', usage: { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_ms: 1 },
}

function open(extra: Record<string, unknown> = {}) {
  const f = stubFetch({
    '/auth/me': { status: 401, body: {} },
    '/monuments': { body: CATALOG },
    '/monuments/BUR-1014': { body: DETAIL },
    '/guide/status': { body: { enabled: false } },
    ...(extra as Record<string, never>),
  })
  window.history.replaceState(null, '', '/')
  render(<VakifnameApp />)
  return f
}
const scene = (n: number) => document.querySelector<HTMLElement>(`section[data-scene="${n}"]`)!

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('hikâye motoru (saf hesaplar)', () => {
  it('sahne geçişi: yeni sahne öncekinin üstüne biner; önceki tamamen örtülünce gizlenir', () => {
    const tops = [0, 1000, 2000, 3000, 4000, 5000, 6000]
    const at = (ym: number) => sceneMix(tops, ym, 300)
    expect(at(400).b.slice(0, 3)).toEqual([1, 0, 0])
    expect(at(400).visible.slice(0, 3)).toEqual([true, false, false])
    const mid = at(1000) // sınırın tam ortası
    expect(mid.b[1]).toBeCloseTo(0.5)
    expect(mid.visible.slice(0, 3)).toEqual([true, true, false])
    const after = at(1400)
    expect(after.b[1]).toBe(1)
    expect(after.visible.slice(0, 2)).toEqual([false, true])
    expect(after.active).toBe(1)
    expect(at(6900).active).toBe(6)
  })

  it('görsel kutusu oranı korur; masaüstünde ekranı kaplar, telefonda harita Ege’den Hatay’a sığar', () => {
    for (const i of SCENES.keys()) {
      const b = boxFor(i, 1440, 900)
      expect(b.width / b.height).toBeCloseTo(SCENES[i].w / SCENES[i].h, 5)
      expect(b.width).toBeGreaterThanOrEqual(1440)
      expect(b.height).toBeGreaterThanOrEqual(899.9)
      expect(b.left).toBeLessThanOrEqual(0)
    }
    const map = boxFor(2, 390, 844)
    expect(map.window).toBe(true)
    for (const p of [mapPoint(27.1428, 38.4237), mapPoint(36.1606, 36.2025)]) {
      const x = map.left + (p.x / 100) * map.width
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(390)
    }
    // 1. sahne telefonda üstte bir şerit; taş yolu metnin arkasına uzanıp erir. Genişliği kaplar, yolcu kadrajda ve
    // ayakları metnin (ekranın %64'ünden aşağısı) üstünde kalır.
    const s1 = boxFor(0, 390, 844)
    expect(s1.fade).toBe('bottom')
    expect(s1.height).toBeCloseTo(0.8 * 844)
    expect(s1.top + 0.89 * s1.height).toBeLessThan(0.66 * 844)
    expect(s1.left).toBeLessThanOrEqual(0)
    expect(s1.left + s1.width).toBeGreaterThanOrEqual(390)
    const traveler = s1.left + 0.661 * s1.width
    expect(traveler).toBeGreaterThan(0)
    expect(traveler).toBeLessThan(390)
  })

  it('harita izdüşümü: Bursa görseldeki büyük ışıklı caminin üstünde; şehirler doğru yönlerde', () => {
    const bursa = mapPoint(29.061, 40.1885)
    expect(Math.abs(bursa.x - (405 / 1920) * 100)).toBeLessThan(1)
    expect(Math.abs(bursa.y - (450 / 1080) * 100)).toBeLessThan(2.5)
    const konya = mapPoint(32.4932, 37.8746)
    const hatay = mapPoint(36.1606, 36.2025)
    expect(konya.x).toBeGreaterThan(bursa.x)
    expect(hatay.x).toBeGreaterThan(konya.x)
    expect(hatay.y).toBeGreaterThan(konya.y) // güney aşağıda
  })

  it('eşleştirmeli geçiş: ortak öğe (1 → 2 yolcu) iki görselde ekranın aynı noktasında; yeni görsel ekrandan küçülmez', () => {
    const m = MATCH[1]!
    const out = { x: 950, y: 720 }
    const inn = { x: 875, y: 720 }
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const a = matchMove(m, t, out, inn, 'out')
      const b = matchMove(m, t, out, inn, 'in')
      expect(out.x + a.dx).toBeCloseTo(inn.x + b.dx, 6)
      expect(out.y + a.dy).toBeCloseTo(inn.y + b.dy, 6)
      expect(b.scale).toBeGreaterThanOrEqual(1)
    }
    // Metin geçiş anında yok: kısa sabit aralığın başında belirir, ortada (dinlenme anı) tam, sonunda çekilir.
    expect(textVisibility(0, true)).toBe(1)
    expect(textVisibility(-0.2, false)).toBe(0)
    expect(textVisibility(REST_P, false)).toBe(1)
    expect(textVisibility(1, false)).toBe(0)
  })

  it('tek kaydırma = bir durak: sabit sahnede dinlenme anı, akıştaki sahnede içerik bitene kadar yerel kaydırma', () => {
    const vh = 800
    // 0: sabit, 1: sabit, 2: akışta (içerik 2 ekran boyu), sonra final
    const m = { tops: [0, 1200, 2600], heights: [1200, 1400, 1600], pinned: [true, true, false], vh, docEnd: 3800 }
    const stops = stopsOf(m)
    expect(stops).toEqual([0, 1200 + 600 * REST_P, 2600, 3800])
    expect(nextStop(m, 0, 1)).toBe(stops[1]) // hızlı da olsa yalnızca bir sonraki
    expect(nextStop(m, stops[1], 1)).toBe(2600)
    expect(nextStop(m, 2600, 1)).toBeNull() // akıştaki sahnede içerik sürüyor: yerel kaydırma
    expect(nextStop(m, 3400, 1)).toBe(3800) // içerik bitti: finale
    expect(nextStop(m, 2600, -1)).toBe(stops[1]) // akıştaki sahnenin başında geri: önceki durak
    expect(nextStop(m, 3000, -1)).toBeNull()
    expect(nextStop(m, 0, -1)).toBeNull()
  })

  it('kaplama düzeltmesi: ötelenen görsel ekranda boş şerit bırakmaz', () => {
    const b = { left: -80, top: 0, width: 1600, height: 900, window: false }
    // Sağa 200 px ötelenen kutu sol kenarda boşluk bırakırdı; düzeltilmiş ölçekle kaplar.
    const s = coverScale(b, 0.5, 0.5, 1, 200, 0, 1440, 900)
    const Ox = b.left + 0.5 * b.width
    expect(Ox + (b.left - Ox) * s + 200).toBeLessThanOrEqual(0.001)
    expect(coverScale(b, 0.5, 0.5, 1, 0, 0, 1440, 900)).toBe(1) // zaten kaplıyorsa değişmez
  })

  it('kamera: harita sahnede sabit (parallax yok); 3 → 4 geçişinde Bursa’ya yaklaşır', () => {
    const bursa = mapPoint(29.061, 40.1885)
    expect(camera(2, 1, 0, 0.1, bursa).ty).toBeCloseTo(0)
    expect(camera(2, 1, 0, 0.9, bursa).ty).toBeCloseTo(0)
    const zoom = camera(2, 1, 1, 0.5, bursa)
    expect(zoom.scale).toBeCloseTo(1.4)
    expect([zoom.ox, zoom.oy]).toEqual([bursa.x, bursa.y])
  })
})

describe('yedi sahne', () => {
  it('sahneler sırayla ve gerçek HTML; ilk başlık slogan; uzak sahnelerin görselleri ilk açılışta yüklenmez', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Geçmişi Keşfet, Mirası Yaşat.' })).toBeInTheDocument()
    expect([...document.querySelectorAll('section[data-scene]')].map((s) => s.getAttribute('data-scene'))).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    const img = document.querySelector('[data-layer="0"] img')!
    expect(img).toHaveAttribute('alt', '')
    expect(img.getAttribute('srcset')).toMatch(/scene-1-1280\.webp\?v=\w+ 1280w, .*scene-1-1680\.webp\?v=\w+ 1680w/)
    expect(document.querySelector('[data-layer="4"] img')).toBeNull()
  })

  it('"Keşfe Başla" yolculuk sahnesine kaydırır; menüdeki Keşfet eserlere götürür', async () => {
    open()
    const link = await screen.findByRole('link', { name: /Keşfe Başla/ })
    // Ana sayfada sahne gezgini (navigator.ts) aynı durak modeliyle götürür.
    const goto = vi.spyOn(window as unknown as { __vkGoto: (id: string) => boolean }, '__vkGoto')
    await userEvent.click(link)
    expect(goto).toHaveBeenCalledWith('yolculuk')
    const nav = (await screen.findAllByRole('navigation', { name: 'Ana menü' }))[0]
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#eserler', '/harita', '/rehber', '/oyun'])
  })

  it('harita: Bursa açık ve katalogdaki sayıyı gösterir; yakındaki şehir bilgi verir; Bursa seçilince şehir sahnesine geçer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    open()
    const legend = within(await screen.findByRole('list', { name: 'Şehirler' }))
    const bursa = await legend.findByRole('button', { name: /Bursa\s*10 Eser Aktif/ })
    expect(legend.getByRole('button', { name: /Konya\s*Yakında/ })).toBeEnabled()
    await userEvent.click(legend.getByRole('button', { name: /Konya/ }))
    expect(within(scene(3)).getByRole('status')).toHaveTextContent('Konya yakında VAKIFNAME’de. Şimdilik keşfe Bursa ile başla.')
    const goto = vi.spyOn(window as unknown as { __vkGoto: (id: string) => boolean }, '__vkGoto')
    await userEvent.click(bursa)
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    expect(goto).toHaveBeenLastCalledWith('sehir')
    expect(document.querySelector('.vk-mark--open')).toHaveClass('is-chosen')
    // Harita işaretleri yalnızca fare/dokunma içindir; ekran okuyucu ve klavye lejantı kullanır.
    expect(document.querySelector('.vk-mapclip')).toHaveAttribute('aria-hidden', 'true')
  })

  it('şehir sahnesi: başlık ve sayı veriden; doğrulanmamış tarihî iddia yok', async () => {
    open()
    const s4 = within(scene(4))
    expect(await s4.findByRole('heading', { name: 'Bursa’nın Vakıf Mirasını Keşfet' })).toBeInTheDocument()
    expect(await s4.findByText('10')).toBeInTheDocument()
    expect(scene(4).textContent).not.toMatch(/başkent/i)
  })

  it('eserler sahnesi: 10 kart, kilit yok; "Tüm Eserleri Gör" eser listesine götürür', async () => {
    open()
    const list = await screen.findByRole('list', { name: 'Eserler' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    expect(within(list).getByRole('link', { name: /Yıldırım Bayezid Bedesteni/ })).toHaveAttribute('href', '/eser/BUR-1014')
    expect(screen.queryByText('Kilitli')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Tüm Eserleri Gör' }))
    expect(window.location.pathname).toBe('/eserler')
  })

  it('rehber kapalıyken soru formu kapalı ve bu açıkça yazılır', async () => {
    open()
    const s6 = within(scene(6))
    expect(await s6.findByText('Rehber şu anda kapalı; soru gönderilemez.')).toBeInTheDocument()
    expect(s6.getByRole('textbox')).toBeDisabled()
    expect(s6.getByLabelText(/Fotoğraf Ekle/)).toBeDisabled()
    expect(s6.getByLabelText(/Mimariyi Analiz Et/)).toBeDisabled()
    for (const b of within(s6.getByRole('group', { name: 'Örnek sorular' })).getAllByRole('button')) expect(b).toBeDisabled()
  })

  it('rehber açıkken: yazılan soru Rehber sayfasında eser seçmeden sorulur', async () => {
    const f = open({ '/guide/status': { body: { enabled: true } }, '/guide/ask': { body: ANSWER } })
    const s6 = within(scene(6))
    const box = s6.getByRole('textbox')
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, 'Külliye nedir?')
    await userEvent.click(s6.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Rehbere sor' })).toBeInTheDocument()
    expect(await screen.findByText('Bunu kaynaklarımda bulamadım.')).toBeInTheDocument()
    const body = JSON.parse(String(f.mock.calls.find(([u]) => String(u).includes('/guide/ask'))![1]!.body))
    expect(body).toMatchObject({ question: 'Külliye nedir?' })
    expect(body).not.toHaveProperty('monument_id')
  })

  it('rehber açıkken: seçilen fotoğraf onay kutusu işaretlenmeden gönderilmez; onayla gönderilir', async () => {
    const f = open({ '/guide/status': { body: { enabled: true } }, '/guide/ask': { body: ANSWER } })
    const input = within(scene(6)).getByLabelText(/Fotoğraf Ekle/) as HTMLInputElement
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([255, 216, 255, 224])], 'cami.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByRole('img', { name: 'Seçilen fotoğraf' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByText('Fotoğrafı göndermek için onay kutusunu işaretle.')).toBeInTheDocument()
    expect(f.mock.calls.some(([u]) => String(u).includes('/guide/ask'))).toBe(false)
    await userEvent.click(screen.getByRole('checkbox', { name: /göndermeyi onaylıyorum/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    await screen.findByText('Bunu kaynaklarımda bulamadım.')
    const body = JSON.parse(String(f.mock.calls.find(([u]) => String(u).includes('/guide/ask'))![1]!.body))
    expect(body.question).toBe('Bu fotoğraftaki yapı hangisi?')
    expect(body.image).toMatchObject({ consent: true, mime: 'image/jpeg' })
  })

  it('rehber açıkken: örnek soru yalnızca kutuyu doldurur; "Mimariyi Analiz Et" fotoğrafı hazır soruyla taşır (onay yine istenir)', async () => {
    const f = open({ '/guide/status': { body: { enabled: true } }, '/guide/ask': { body: ANSWER } })
    const s6 = within(scene(6))
    const chip = await s6.findByRole('button', { name: 'Vakfiye nedir?' })
    await waitFor(() => expect(chip).toBeEnabled())
    await userEvent.click(chip)
    expect(s6.getByRole('textbox')).toHaveValue('Vakfiye nedir?')
    expect(f.mock.calls.some(([u]) => String(u).includes('/guide/ask'))).toBe(false)
    fireEvent.change(s6.getByLabelText(/Mimariyi Analiz Et/), { target: { files: [new File([new Uint8Array([255, 216, 255, 224])], 'kapi.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByRole('img', { name: 'Seçilen fotoğraf' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('Bu fotoğraftaki yapının mimari ayrıntılarını anlatır mısın?')
    expect(f.mock.calls.some(([u]) => String(u).includes('/guide/ask'))).toBe(false)
  })

  it('oyun sahnesi: gerçek mühür türleri, oyun paneline ve rotaya geçiş; final sloganı', async () => {
    open()
    const s7 = within(scene(7))
    expect(s7.getByRole('img', { name: 'Bilgi mührü' })).toBeInTheDocument()
    expect(s7.getByRole('img', { name: 'Altın mühür' })).toBeInTheDocument()
    expect(s7.getByText('Örnek görünüm')).toBeInTheDocument() // örnek yapboz gerçek ilerleme gibi sunulmaz
    expect(screen.getAllByText('Geçmişi Keşfet, Mirası Yaşat.').length).toBe(2) // açılış başlığı + final
    expect(await s7.findByRole('link', { name: 'Rotaları Keşfet' })).toHaveAttribute('href', '/oyun/rota/bursa')
    await userEvent.click(s7.getByRole('link', { name: 'Maceraya Başla' }))
    expect(window.location.pathname).toBe('/oyun')
    expect(window.localStorage.getItem('vakifname.guest')).toBe('1')
  })
})
