import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import { useRef } from 'react'
import { boxFor, camera, coverScale, mapPoint, MATCH, matchMove, nextStop, REST_P, SCENES, sceneMix, stopsOf, textVisibility, type StopModel } from './story/engine'
import { useSceneNavigator } from './story/navigator'
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
    const tops = [0, 1000, 2000, 3000, 4000, 5000]
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
    expect(at(5900).active).toBe(5)
  })

  it('görsel kutusu oranı korur; masaüstünde ekranı kaplar, telefonda harita Ege’den Hatay’a sığar', () => {
    for (const i of SCENES.keys()) {
      const b = boxFor(i, 1440, 900)
      expect(b.width / b.height).toBeCloseTo(SCENES[i].w / SCENES[i].h, 5)
      expect(b.width).toBeGreaterThanOrEqual(1440)
      expect(b.height).toBeGreaterThanOrEqual(899.9)
      expect(b.left).toBeLessThanOrEqual(0)
    }
    const map = boxFor(1, 390, 844)
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

  it('eşleştirmeli geçiş: ortak öğe (1 → 2 ay) iki görselde ekranın aynı noktasında; yeni görsel ekrandan küçülmez', () => {
    const m = MATCH[1]!
    // Karşılamadan haritaya: kamera yükselir, iki gece göğü yıldızlarla bağlanır; ay iki görselde aynı yerde.
    expect(m.stars).toBe(true)
    expect(m.outScale).toBeLessThan(1)
    expect(Math.hypot(m.out[0] - m.in[0], m.out[1] - m.in[1])).toBeLessThan(0.02)
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

  it('R6.2: final ekranı yok; son sabit sahnenin durağı bölümün sonudur, ardında boş bir durak kalmaz', () => {
    const vh = 800
    const m = { tops: [0, 1200, 2600], heights: [1200, 1400, 1120], pinned: [true, true, true], vh, docEnd: 2600 + 1120 - vh }
    const stops = stopsOf(m)
    expect(stops).toEqual([0, 1200 + 600 * REST_P, m.docEnd])
    expect(nextStop(m, stops[1], 1)).toBe(m.docEnd)
    expect(nextStop(m, m.docEnd, 1)).toBeNull()
  })

  it('kaplama düzeltmesi: ötelenen görsel ekranda boş şerit bırakmaz', () => {
    const b = { left: -80, top: 0, width: 1600, height: 900, window: false }
    // Sağa 200 px ötelenen kutu sol kenarda boşluk bırakırdı; düzeltilmiş ölçekle kaplar.
    const s = coverScale(b, 0.5, 0.5, 1, 200, 0, 1440, 900)
    const Ox = b.left + 0.5 * b.width
    expect(Ox + (b.left - Ox) * s + 200).toBeLessThanOrEqual(0.001)
    expect(coverScale(b, 0.5, 0.5, 1, 0, 0, 1440, 900)).toBe(1) // zaten kaplıyorsa değişmez
  })

  it('kamera: harita sahnede sabit (parallax yok); 2 → 3 geçişinde Bursa’ya yaklaşır', () => {
    const bursa = mapPoint(29.061, 40.1885)
    expect(camera(1, 1, 0, 0.1, bursa).ty).toBeCloseTo(0)
    expect(camera(1, 1, 0, 0.9, bursa).ty).toBeCloseTo(0)
    const zoom = camera(1, 1, 1, 0.5, bursa)
    expect(zoom.scale).toBeCloseTo(1.4)
    expect([zoom.ox, zoom.oy]).toEqual([bursa.x, bursa.y])
    // Karşılama sahnesinden çıkarken kamera yükselir (geri çekilir): haritaya geçiş.
    expect(camera(0, 1, 1, 0.5, bursa).scale).toBeLessThan(camera(0, 1, 0, 0.5, bursa).scale)
  })

  it('yolculuk sahnesi kaldırıldı: 6 sahne, geçiş ve görsel dosyası listeleri aynı uzunlukta; scene-2 görseli kullanılmaz', () => {
    expect(SCENES).toHaveLength(6)
    expect(MATCH).toHaveLength(SCENES.length)
    expect(SCENES.map((s) => s.art)).toEqual([1, 3, 4, 5, 6, 7])
  })
})

describe('altı sahne', () => {
  it('sahneler sırayla ve gerçek HTML; ilk başlık slogan; uzak sahnelerin görselleri ilk açılışta yüklenmez', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Geçmişi Keşfet, Mirası Yaşat.' })).toBeInTheDocument()
    expect([...document.querySelectorAll('section[data-scene]')].map((s) => s.getAttribute('data-scene'))).toEqual(['1', '2', '3', '4', '5', '6'])
    // R6.12: ilk açılışta yalnızca ilk sahnenin görseli iner; haritanın görseli (ikinci katman, eski 3. sahne dosyası)
    // ilk sahne çizildikten sonra boşta gelir. Kaldırılan yolculuk görseli hiç yüklenmez.
    expect(document.querySelector('[data-layer="1"] img')).toBeNull()
    expect(document.querySelector('img[src*="scene-2-"]')).toBeNull()
    const img = document.querySelector('[data-layer="0"] img')!
    expect(img).toHaveAttribute('alt', '')
    expect(img.getAttribute('srcset')).toMatch(/scene-1-1280\.webp\?v=\w+ 1280w, .*scene-1-1680\.webp\?v=\w+ 1680w/)
    expect(document.querySelector('[data-layer="4"] img')).toBeNull()
    await waitFor(() => expect(document.querySelector('[data-layer="1"] img')?.getAttribute('src')).toMatch(/scene-3-1920\.webp/), { timeout: 4000 })
  })

  it('"Keşfe Başla" doğrudan harita sahnesine kaydırır (yolculuk sahnesi yok); menüdeki Keşfet eserlere götürür', async () => {
    open()
    const link = await screen.findByRole('link', { name: /Keşfe Başla/ })
    // Ana sayfada sahne gezgini (navigator.ts) aynı durak modeliyle götürür.
    const goto = vi.spyOn(window as unknown as { __vkGoto: (id: string) => boolean }, '__vkGoto')
    await userEvent.click(link)
    expect(goto).toHaveBeenCalledWith('sehirler')
    expect(link).toHaveAttribute('href', '#sehirler')
    expect(document.getElementById('yolculuk')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Her Yolculuk Bir Adımla Başlar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Haritaya kaydır' })).toBeInTheDocument()
    const nav = (await screen.findAllByRole('navigation', { name: 'Ana menü' }))[0]
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#eserler', '/harita', '/oyun'])
  })

  it('harita: Bursa açık ve katalogdaki sayıyı gösterir; yakındaki şehir bilgi verir; Bursa seçilince şehir sahnesine geçer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    open()
    const legend = within(await screen.findByRole('list', { name: 'Şehirler' }))
    const bursa = await legend.findByRole('button', { name: /Bursa\s*10 Eser Aktif/ })
    expect(legend.getByRole('button', { name: /Konya\s*Yakında/ })).toBeEnabled()
    await userEvent.click(legend.getByRole('button', { name: /Konya/ }))
    expect(within(scene(2)).getByRole('status')).toHaveTextContent('Konya yakında VAKIFNAME’de. Şimdilik keşfe Bursa ile başla.')
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
    const s3 = within(scene(3))
    expect(await s3.findByRole('heading', { name: 'Bursa’nın Vakıf Mirasını Keşfet' })).toBeInTheDocument()
    expect(await s3.findByText('10')).toBeInTheDocument()
    expect(scene(3).textContent).not.toMatch(/başkent/i)
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
    const s5 = within(scene(5))
    expect(await s5.findByText('Rehber şu anda kapalı; soru gönderilemez.')).toBeInTheDocument()
    expect(s5.getByRole('textbox')).toBeDisabled()
    expect(s5.queryByLabelText(/Fotoğraf ekle/)).not.toBeInTheDocument()  // R3.13: kapalıyken fotoğraf seçeneği yok
    expect(s5.queryByText('AI Rehberi Aç')).not.toBeInTheDocument()
    for (const b of within(s5.getByRole('group', { name: 'Örnek sorular' })).getAllByRole('button')) expect(b).toBeDisabled()
  })

  // R6.14: ana sayfadaki rehber bölümü soruyu sayfa değiştirmeden sağ alttaki "Rehbere Sor" panelinde sorar.
  const drawer = () => screen.getByRole('dialog', { name: 'Rehber' })
  const asks = (f: ReturnType<typeof open>) => f.mock.calls.filter(([u]) => String(u).includes('/guide/ask'))

  it('R6.14 rehber açıkken: soru aynı sayfada paneli açar, panelde bir kez sorulur, cevap panelde; ana sayfa kutusu boşalır', async () => {
    const f = open({ '/guide/status': { body: { enabled: true } }, '/guide/ask': { body: ANSWER } })
    const s5 = within(scene(5))
    const box = s5.getByRole('textbox')
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, "Bursa Ulu Camii'ni kim yaptırdı?")
    const send = s5.getByRole('button', { name: 'Sor' })
    await userEvent.click(send)
    await userEvent.click(send)  // ikinci tıklama: kutu boşaldığı için düğme kapalı, ikinci soru gitmez
    expect(window.location.pathname).toBe('/')
    expect(await within(drawer()).findByText('Bunu kaynaklarımda bulamadım.')).toBeInTheDocument()
    expect(within(drawer()).getByText("Bursa Ulu Camii'ni kim yaptırdı?")).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(send).toBeDisabled()
    expect(asks(f)).toHaveLength(1)
    const body = JSON.parse(String(asks(f)[0][1]!.body))
    expect(body).toMatchObject({ question: "Bursa Ulu Camii'ni kim yaptırdı?" })
    expect(body).not.toHaveProperty('monument_id')
    expect(screen.queryByRole('heading', { level: 1, name: 'Rehbere sor' })).not.toBeInTheDocument()  // eski sayfa yok
  })

  it('R6.14 Enter düğmeyle aynıdır; "Selam" panelde yerel karşılık alır (API yok); boş soru gönderilmez', async () => {
    const f = open({ '/guide/status': { body: { enabled: true } }, '/guide/ask': { body: ANSWER } })
    const s5 = within(scene(5))
    const box = s5.getByRole('textbox')
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, '   {Enter}')
    expect(screen.queryByRole('dialog', { name: 'Rehber' })).not.toBeInTheDocument()
    await userEvent.type(box, 'Selam{Enter}')
    expect(await within(drawer()).findByText(/Merhaba! Ben VAKIFNAME’nin yerel rehberiyim/)).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(asks(f)).toHaveLength(0)
    expect(window.location.pathname).toBe('/')
  })

  it('R6.14 panel kapatılıp yeniden açılınca ya da sayfa değişince aynı soru tekrar gönderilmez', async () => {
    const f = open({ '/guide/status': { body: { enabled: true } }, '/guide/ask': { body: ANSWER } })
    const s5 = within(scene(5))
    const box = s5.getByRole('textbox')
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, 'Külliye nedir?{Enter}')
    await within(drawer()).findByText('Bunu kaynaklarımda bulamadım.')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Rehbere Sor' }))
    await userEvent.click(within(screen.getAllByRole('navigation', { name: 'Ana menü' })[0]).getByRole('link', { name: 'Harita' }))
    await waitFor(() => expect(window.location.pathname).toBe('/harita'))
    await new Promise((r) => setTimeout(r, 300))
    expect(asks(f)).toHaveLength(1)
  })

  it('R6.14 panel henüz hazır değilken (durumu gelmeden) gönderilen soru kaybolmaz; durum gelince bir kez sorulur', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    let calls = 0
    const f = open({
      // 1. istek ana sayfa bölümünün (hemen), 2. istek panelin kendi durumu (bekletilir).
      '/guide/status': async () => (++calls > 1 ? (await gate, { body: { enabled: true } }) : { body: { enabled: true } }),
      '/guide/ask': { body: ANSWER },
    })
    const s5 = within(scene(5))
    const box = s5.getByRole('textbox')
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, 'Vakfiye nedir?{Enter}')
    await within(drawer()).findByRole('textbox', { name: 'Sorunu yaz' })
    await new Promise((r) => setTimeout(r, 200))
    expect(asks(f)).toHaveLength(0)  // panelin durumu belli değil: istek bekliyor
    expect(box).toHaveValue('')
    release()
    expect(await within(drawer()).findByText('Bunu kaynaklarımda bulamadım.')).toBeInTheDocument()
    expect(asks(f)).toHaveLength(1)
  })

  it('rehber ve fotoğraf analizi açıkken: seçilen fotoğraf onay kutusu işaretlenmeden gönderilmez; onayla gönderilir', async () => {
    const f = open({ '/guide/status': { body: { enabled: true, photo: true } }, '/guide/ask': { body: ANSWER } })
    const input = (await within(scene(5)).findByLabelText(/Fotoğraf ekle/)) as HTMLInputElement
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([255, 216, 255, 224])], 'cami.jpg', { type: 'image/jpeg' })] } })
    // R6.14: fotoğraf aynı sayfada açılan panelde önizlenir.
    expect(await within(drawer()).findByRole('img', { name: 'Seçilen fotoğraf' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Sor' }))
    expect(await within(drawer()).findByText('Fotoğrafı göndermek için onay kutusunu işaretle.')).toBeInTheDocument()
    expect(f.mock.calls.some(([u]) => String(u).includes('/guide/ask'))).toBe(false)
    await userEvent.click(within(drawer()).getByRole('checkbox', { name: /göndermeyi onaylıyorum/ }))
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Sor' }))
    await within(drawer()).findByText('Bunu kaynaklarımda bulamadım.')
    const body = JSON.parse(String(f.mock.calls.find(([u]) => String(u).includes('/guide/ask'))![1]!.body))
    expect(body.question).toBe('Bu fotoğraftaki yapı hangisi?')
    expect(body.image).toMatchObject({ consent: true, mime: 'image/jpeg' })
  })

  it('R3.13 tek soru yolu: üç hazır soru yalnızca kutuyu doldurur; fotoğraf yazılan soruyla taşınır (onay yine istenir)', async () => {
    const f = open({ '/guide/status': { body: { enabled: true, photo: true } }, '/guide/ask': { body: ANSWER } })
    const s5 = within(scene(5))
    const chips = within(s5.getByRole('group', { name: 'Örnek sorular' })).getAllByRole('button')
    expect(chips).toHaveLength(3)
    await waitFor(() => expect(chips[2]).toBeEnabled())
    await userEvent.click(s5.getByRole('button', { name: 'Vakfiye nedir?' }))
    expect(s5.getAllByRole('textbox')).toHaveLength(1)
    expect(s5.getByRole('textbox')).toHaveValue('Vakfiye nedir?')
    expect(f.mock.calls.some(([u]) => String(u).includes('/guide/ask'))).toBe(false)
    fireEvent.change(await s5.findByLabelText(/Fotoğraf ekle/), { target: { files: [new File([new Uint8Array([255, 216, 255, 224])], 'kapi.jpg', { type: 'image/jpeg' })] } })
    expect(await within(drawer()).findByRole('img', { name: 'Seçilen fotoğraf' })).toBeInTheDocument()
    expect(within(drawer()).getByRole('textbox', { name: 'Sorunu yaz' })).toHaveValue('Vakfiye nedir?')
    expect(f.mock.calls.some(([u]) => String(u).includes('/guide/ask'))).toBe(false)
  })

  it('R5.3/R3.13: fotoğraf analizi kapalıyken sahnede fotoğraf seçeneği yok ve bu söylenir; metin sorusu çalışır', async () => {
    const f = open({ '/guide/status': { body: { enabled: true, photo: false } }, '/guide/ask': { body: ANSWER } })
    const s5 = within(scene(5))
    expect(await s5.findByText(/Fotoğrafla soru şu anda kapalı/)).toBeInTheDocument()
    expect(s5.queryByLabelText(/Fotoğraf ekle/)).not.toBeInTheDocument()
    const box = s5.getByRole('textbox')
    await waitFor(() => expect(box).toBeEnabled())
    await userEvent.type(box, 'Vakfiye nedir?')
    await userEvent.click(s5.getByRole('button', { name: 'Sor' }))
    await within(drawer()).findByText('Bunu kaynaklarımda bulamadım.')
    const body = JSON.parse(String(f.mock.calls.find(([u]) => String(u).includes('/guide/ask'))![1]!.body))
    expect(body.image ?? null).toBeNull()
  })

  it('oyun tanıtımı (R6.1): sade editoryal metin, kart yok; parça sayısı katalogdan; "Maceraya Başla" girişten oyuna geçer (R6.2)', async () => {
    open()
    const s6 = within(scene(6))
    expect(s6.getByRole('heading', { level: 2, name: 'Kayıp Vakfiyenin İzinde' })).toBeInTheDocument()
    expect(s6.getByText(/VAKIFNAME · Kayıp Vakfiye/)).toBeInTheDocument()
    // Bursa'da katalogda 10 eser var (her eser bir parça): sayı uydurulmaz, katalogdan gelir.
    expect(await s6.findByText(/On tarihî eser\. On kayıp parça\./)).toBeInTheDocument()
    expect(s6.getByText(/Geçmişin izlerini takip et, vakfiyeyi yeniden bir araya getir\./)).toBeInTheDocument()
    expect(s6.getByText('Eserleri keşfet · Mühürleri kazan · Vakfiyeyi tamamla')).toBeInTheDocument()
    // Eski üç bilgi kutusu ve örnek yapboz yok.
    for (const gone of ['Mühürler ve rozetler', 'Tarihî Rotalar', 'Örnek görünüm', 'Keşfet. Çöz. Mirası Tamamla.']) {
      expect(s6.queryByText(gone)).not.toBeInTheDocument()
    }
    expect(scene(6).querySelector('.vk-quest, .vk-puzzle')).toBeNull()
    // R6.2: final ekranı yok (slogan yalnızca açılış başlığında); hikâye bu sahneyle biter.
    expect(screen.getAllByText('Geçmişi Keşfet, Mirası Yaşat.')).toHaveLength(1)
    expect(document.querySelector('.vk-final')).toBeNull()
    expect(screen.getByRole('link', { name: 'Aydınlatma metni' })).toHaveAttribute('href', '/gizlilik')
    // Oyun hesap ister: oturumsuz ziyaretçi girişe gider, dönüş adresi /oyun; misafir olarak oyuna sokulmaz.
    await userEvent.click(s6.getByRole('link', { name: 'Maceraya Başla' }))
    await waitFor(() => expect(window.location.pathname).toBe('/giris'))
    expect(new URLSearchParams(window.location.search).get('sonra')).toBe('/oyun')
    expect(window.localStorage.getItem('vakifname.guest')).toBeNull()
  })

  it('"Oyun Nasıl Oynanır?" kısa bir pencere açar: üç adım, gerçek kurallar, rota bağlantısı; Kapat ve Esc ile kapanır', async () => {
    open()
    const s6 = within(scene(6))
    const how = s6.getByRole('button', { name: 'Oyun Nasıl Oynanır?' })
    expect(how).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(how)
    expect(how).toHaveAttribute('aria-expanded', 'true')
    const dlg = await screen.findByRole('dialog', { name: 'Oyun nasıl oynanır?' })
    expect(how).toHaveAttribute('aria-controls', dlg.id)
    const steps = within(within(dlg).getByRole('list')).getAllByRole('listitem')
    expect(steps.map((li) => li.querySelector('strong')!.textContent)).toEqual(['Eseri seç', 'Rozeti Al', 'Ziyaret et (bonus)'])
    expect(within(dlg).getByText(/5 kısa sorudan en az 4’ünü doğru yanıtla/)).toBeInTheDocument()
    expect(within(dlg).getByText(/Konumun kaydedilmez/)).toBeInTheDocument()
    expect(within(dlg).getByText(/hepsi baştan açık/)).toBeInTheDocument()  // R6.7: kilit yok
    expect(within(dlg).getByRole('link', { name: 'Bursa rotasını gör' })).toHaveAttribute('href', '/oyun/rota/bursa')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Kapat' }))
    expect(how).toHaveAttribute('aria-expanded', 'false')
    expect(how).toHaveFocus()
    // Esc (tarayıcının `cancel` olayı) da kapatır.
    await userEvent.click(how)
    fireEvent(dlg, new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(how).toHaveAttribute('aria-expanded', 'false'))
  })

  it('oyun sahnesinin ışıkları: zerrecik ve mühür yansıması; görseldeki parçalar kopyalanmaz, telefonda zerrecik yarıya iner', () => {
    open()
    const layer = document.querySelector('[data-layer="5"] [data-cam="5"]')!
    expect(layer.querySelectorAll('.vk-glint')).toHaveLength(3)
    const dust = layer.querySelectorAll('.vk-dust')
    expect(dust.length).toBeGreaterThanOrEqual(10)
    expect(layer.querySelectorAll('.vk-dust--extra').length).toBe(Math.floor(dust.length / 2))
    // Süsler yalnızca boş (aria-hidden sahnede) ışık öğeleridir: ek görsel ya da parça kopyası yok.
    expect(layer.querySelectorAll('img').length).toBeLessThanOrEqual(1)
    expect(layer.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('dokunmatik gezinme (8 Kasım: parmak kalkınca titreme)', () => {
  // Durağın ortası: 1350; 3. sahne akışta [2000, 3200]; sayfa sonu 4200.
  const model: StopModel = { tops: [0, 1000, 2000], heights: [1500, 1500, 3000], pinned: [true, true, false], vh: 800, docEnd: 4200, ends: [1500, 2500, 4000] }
  function Harness() {
    const root = useRef<HTMLDivElement>(null)
    useSceneNavigator(root, model)
    return <div ref={root}><section data-scene="1" /></div>
  }
  const touchEv = (type: string, x: number, y: number, end = false) => {
    const e = new Event(type, { bubbles: true, cancelable: true })
    const pt = [{ clientX: x, clientY: y }]
    Object.defineProperty(e, 'touches', { value: end ? [] : pt })
    Object.defineProperty(e, 'changedTouches', { value: pt })
    window.dispatchEvent(e)
    return e
  }
  const at = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
  afterEach(() => at(0))

  it('sabit sahnede dikey parmak hareketi sayfayı kaydırmaz; parmak kalkınca sonraki durağa gidiş başlar', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    at(0)
    render(<Harness />)
    touchEv('touchstart', 200, 600)
    expect(touchEv('touchmove', 202, 560).defaultPrevented).toBe(true)
    expect(touchEv('touchmove', 204, 480).defaultPrevented).toBe(true)
    touchEv('touchend', 204, 480, true)
    await waitFor(() => expect(scrollTo).toHaveBeenCalled())
    const last = scrollTo.mock.calls.at(-1)!
    expect(last[1]).toBeGreaterThanOrEqual(0)
    expect(last[1]).toBeLessThanOrEqual(1350)
  })

  it('yatay hareket (kart şeridi) ve akıştaki sahnenin içi tarayıcıya kalır; akışta parmak kalkınca gidiş başlamaz', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    at(1350)
    render(<Harness />)
    touchEv('touchstart', 300, 500)
    expect(touchEv('touchmove', 200, 495).defaultPrevented).toBe(false)
    expect(touchEv('touchmove', 150, 400).defaultPrevented).toBe(false) // karar ilk adımda verildi
    touchEv('touchend', 150, 495, true)
    at(2500)
    touchEv('touchstart', 200, 600)
    expect(touchEv('touchmove', 200, 560).defaultPrevented).toBe(false)
    touchEv('touchend', 200, 450, true)
    await new Promise((r) => setTimeout(r, 60))
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
