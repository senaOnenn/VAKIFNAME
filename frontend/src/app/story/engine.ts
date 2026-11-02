/**
 * Hikâyesel ana sayfanın (7 sahne) saf hesapları: sahne ağırlıkları, kamera hareketi, görsel kutusu ve harita izdüşümü.
 * DOM'a dokunmaz; `useStoryEngine` bunları her karede kullanır, testler doğrudan çağırır.
 */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const ramp = (p: number, from: number, to: number) => clamp01((p - from) / (to - from))

/**
 * Telefon dikey düzeni. `cover`: odak noktasından kırpılır. `window`: odak aralığı ekran genişliğine sığdırılır.
 * `band`: görsel ekranın `h` kadarını kaplayan bir şerit (üste ya da alta yaslı), metin kalan gece zemininde durur;
 * `fx` şeridin yatay odağıdır. `map`: harita genişliğe sığar, kara parçasının üstü (`land`) başlığın altına hizalanır.
 */
type Mobile =
  | { mode: 'cover'; fx: number }
  | { mode: 'window'; x0: number; span: number; top: number }
  | { mode: 'band'; h: number; fx: number; edge: 'top' | 'bottom'; y?: number }
  | { mode: 'map'; x0: number; span: number; land: number; under: number }

export interface SceneArt {
  /** Özgün genişlik (büyütülmez) ve oran. */
  w: number
  h: number
  /** Sahnede kalırken hafif parallax (kutu yüksekliğinin yüzdesi). Harita sahnesinde 0: harita sabit kalır. */
  parallax: number
  mobile: Mobile
  /** Geniş ekranda yatay hizalama (0 sol, 0,5 orta, 1 sağ): ekranı kaplarken hangi kenarın kırpılacağı. */
  dfx?: number
}

export const SCENES: SceneArt[] = [
  // 1 karşılama: telefonda cami ve yolcu üstte; görselin taş yolu metnin arkasına uzanıp erir (tek sahne)
  { w: 1680, h: 944, parallax: 2, mobile: { mode: 'band', h: 0.8, fx: 0.69, edge: 'top', y: -0.07 } },
  // 2 yolculuk: telefonda metin görselin gökyüzünde, yolcu altta
  { w: 1920, h: 1080, parallax: 2, mobile: { mode: 'band', h: 0.84, fx: 0.6, edge: 'bottom' } },
  // 3 harita: Ege'den Hatay'a; kara parçası başlığın hemen altında
  { w: 1920, h: 1080, parallax: 0, mobile: { mode: 'map', x0: 0.05, span: 0.5, land: 0.27, under: 0.31 } },
  // 4 şehir: Ulu Cami ve han kesilmez (han sağ kenarda); telefonda panorama üstte, metin hanların koyu çatılarında
  { w: 1920, h: 1080, parallax: 2, mobile: { mode: 'band', h: 0.62, fx: 0.66, edge: 'top', y: 0.03 }, dfx: 1 },
  // 5 meydan: kartların arkasında derinlik; telefonda caminin çevresi
  { w: 1920, h: 1080, parallax: 2, mobile: { mode: 'cover', fx: 0.45 } },
  // 6 defter ve çizimler: telefonda defter üstte, rehber paneli altında
  { w: 1920, h: 1080, parallax: 2, mobile: { mode: 'band', h: 0.5, fx: 0.74, edge: 'top', y: 0.02 } },
  // 7 masa, parçalar, mühür: telefonda masa üstte
  { w: 1920, h: 1080, parallax: 2, mobile: { mode: 'band', h: 0.5, fx: 0.72, edge: 'top', y: 0.02 } },
]

/** Dikey telefon mu (görsel kırpma düzeni buna göre). CSS'teki `(max-aspect-ratio: 4/5)` ile aynı eşik. */
export const isPortrait = (vw: number, vh: number) => vw / vh <= 0.8

export interface Box {
  left: number
  top: number
  width: number
  height: number
  window: boolean
  /** Telefonda hangi kenarın gece zeminine eriyeceği: şerit üstteyse alt kenar, alttaysa üst kenar. */
  fade?: 'bottom' | 'top' | 'both'
}

/** Sahne görselinin ekrandaki kutusu (piksel). Oran hiçbir düzende bozulmaz. */
export function boxFor(i: number, vw: number, vh: number): Box {
  const s = SCENES[i]
  const a = s.w / s.h
  if (!isPortrait(vw, vh)) {
    const width = Math.max(vw, vh * a)
    const height = width / a
    return { left: (vw - width) * (s.dfx ?? 0.5), top: (vh - height) / 2, width, height, window: false }
  }
  const m = s.mobile
  if (m.mode === 'band') {
    const height = m.h * vh
    const width = height * a
    const left = Math.min(0, Math.max(vw - width, vw / 2 - m.fx * width))
    return { left, top: (m.edge === 'top' ? 0 : vh - height) + (m.y ?? 0) * vh, width, height, window: true, fade: m.edge === 'top' ? 'bottom' : 'top' }
  }
  if (m.mode === 'map') {
    const width = vw / m.span
    const height = width / a
    return { left: -m.x0 * width, top: m.under * vh - m.land * height, width, height, window: true, fade: 'both' }
  }
  if (m.mode === 'cover') {
    const height = vh
    const width = height * a
    const left = Math.min(0, Math.max(vw - width, vw / 2 - m.fx * width))
    return { left, top: 0, width, height, window: false }
  }
  const width = vw / m.span
  const height = width / a
  return { left: -m.x0 * width, top: Math.min(m.top * vh, Math.max(0, vh - height)), width, height, window: true }
}

/**
 * Sahne geçişleri. `tops[j]`: j. sahnenin sayfadaki üst kenarı; `ym`: ekranın ortası (sayfa koordinatı); `z`: geçiş
 * bölgesinin yarı genişliği. `b[j]`: j. sahnenin girişi (0 → 1). Yeni sahne öncekinin üstüne biner: opaklığı `b[j]`,
 * önceki tamamen örtülene kadar görünür kalır (arada karanlık bir boşluk olmaz).
 */
export function sceneMix(tops: number[], ym: number, z: number) {
  const n = tops.length
  const b = tops.map((t, j) => (j === 0 ? 1 : clamp01((ym - (t - z)) / (2 * z))))
  const visible = b.map((v, i) => v > 0 && (i + 1 >= n || b[i + 1] < 1))
  // Her sahnenin payı (etkin sahne ve geçiş durumları için).
  const weight = b.map((v, i) => v * (i + 1 < n ? 1 - b[i + 1] : 1))
  let active = 0
  weight.forEach((w, i) => w > weight[active] && (active = i))
  return { b, visible, weight, active }
}

/** Bursa'nın harita görselindeki yeri (yüzde); 3 → 4 geçişinde kamera buraya yaklaşır. */
export const MAP_SIZE = { w: 1920, h: 1080 }

/**
 * Harita görseli (scene-3) için boylam/enlem → piksel. Görsel perspektifli ve stilize bir çizim; dönüşüm, görseldeki kıyı
 * noktalarına (Kıbrıs, Antalya ve İskenderun körfezleri, Çeşme, Karadeniz'in doğu ucu, Bursa) en küçük karelerle
 * uydurulmuştur. Ortalama sapma ±%2,5 (1920 px'te ~50 px). Şehir noktaları gerçek koordinattan hesaplanır.
 */
export function mapPoint(lng: number, lat: number): { x: number; y: number } {
  const px = 83.91 * lng + 8.99 * lat - 2393.15
  const py = 7.64 * lng - 69.04 * lat + 3023.87
  return { x: (px / MAP_SIZE.w) * 100, y: (py / MAP_SIZE.h) * 100 }
}

/**
 * Eşleştirmeli geçişler (match-move). İndis: gelen sahne (1 = 1 → 2). İki görselin ortak öğesi (`out`/`in`, görsel
 * kesri) geçiş boyunca ekranda aynı noktada tutulur ve çıkıştaki yerinden girişteki yerine kayar; giden görsel o nokta
 * etrafında `outScale`'e, gelen `inScale`'den 1'e ölçeklenir. Gelen görsel `fade` aralığında belirir (giden altta tam
 * opak kalır: arada boş/düz renk an olmaz). `shade`: ortak öğenin üstüne düşen yerel gölge (iki figür birlikte
 * görünmesin); `stars`: iki gece göğünü bağlayan yıldız katmanı.
 */
export interface Match {
  out: [number, number]
  in: [number, number]
  outScale: number
  inScale: number
  fade: [number, number]
  shade: number
  stars: boolean
  /** Gelen görsel ortak öğenin çevresinden dairesel olarak açılır (3 → 4: Bursa'nın ışığından). */
  iris?: boolean
  /** Ortak öğede altın ışık (3 → 4). */
  bloom?: boolean
  /** Defterdeki mimari çizimlerin altın çizgileri belirginleşir (5 → 6). */
  sheen?: boolean
  /** Altın parçacıklar ortak öğede mühür olur (6 → 7). */
  merge?: boolean
}
export const MATCH: (Match | null)[] = [
  null,
  // 1 → 2: taş yolda yolcunun arkasından ilerleme; yalnızca yolcunun üstüne düşen kısa bir kemer gölgesi
  { out: [0.661, 0.8], in: [0.608, 0.8], outScale: 1.16, inScale: 1.06, fade: [0.44, 0.58], shade: 0.7, stars: false },
  // 2 → 3: kamera yükselir (sokak geri çekilir), yıldızlı gökyüzünden harita oturur; ay iki görselde aynı yerde
  { out: [0.14, 0.17], in: [0.13, 0.17], outScale: 0.9, inScale: 1.12, fade: [0.28, 0.8], shade: 0, stars: true },
  // 3 → 4: Bursa işaretinde altın ışık; harita geri çekilirken Bursa panoraması ışığın içinden açılır (Ulu Cami)
  { out: [0.2118, 0.4364] /* mapPoint(Bursa) */, in: [0.62, 0.38], outScale: 0.94, inScale: 1.18, fade: [0.12, 0.42], shade: 0, stars: false, iris: true, bloom: true },
  // 4 → 5: Ulu Cami'den meydandaki camiye iniş; panorama geride kalır, kartlar öne gelir
  { out: [0.62, 0.38], in: [0.43, 0.53], outScale: 1.2, inScale: 1.1, fade: [0.36, 0.68], shade: 0, stars: false },
  // 5 → 6: meydandaki camiden defterin üstündeki çizim camiye; çizgiler altınla belirginleşir
  { out: [0.43, 0.53], in: [0.71, 0.44], outScale: 1.14, inScale: 1.12, fade: [0.36, 0.68], shade: 0, stars: false, sheen: true },
  // 6 → 7: defterdeki bilgi parçacıkları mühürde birleşir; masadaki vakfiye parçaları belirir
  { out: [0.73, 0.6], in: [0.71, 0.66], outScale: 1.1, inScale: 1.08, fade: [0.52, 0.8], shade: 0, stars: false, merge: true },
]

export const smooth = (t: number) => t * t * (3 - 2 * t)
export const smoothRange = (t: number, a: number, b: number) => smooth(ramp(t, a, b))

/** Eşleştirmeli geçişte bir katmanın dönüşümü: ölçek ortak öğe etrafında, öteleme px. */
export function matchMove(m: Match, t: number, aOut: { x: number; y: number }, aIn: { x: number; y: number }, role: 'out' | 'in') {
  const e = smooth(clamp01(t))
  const mx = aOut.x + (aIn.x - aOut.x) * e
  const my = aOut.y + (aIn.y - aOut.y) * e
  const scale = role === 'out' ? 1 + (m.outScale - 1) * e : m.inScale + (1 - m.inScale) * e
  const a = role === 'out' ? aOut : aIn
  const f = role === 'out' ? m.out : m.in
  return { dx: mx - a.x, dy: my - a.y, scale, ox: f[0] * 100, oy: f[1] * 100, mx, my }
}

/**
 * Sabitlenen bölümde metnin görünürlüğü (0 → 1 → 0). `p`: bölümün sabit kaldığı aralıktaki ilerleme. Metin sahne
 * oturunca belirir, geçiş başlamadan çekilir; ilk sahne açılışta görünür.
 */
/** Sabitlenmeyen bölümde (içerik ekrandan uzunsa) metin, bölüm ekrana girerken belirir. */
export const flowVisibility = (top: number, vh: number) => ramp(vh - top, vh * 0.05, vh * 0.45)

/**
 * Sabitlenen bölümün zaman çizelgesi (`p`: sabit aralıktaki ilerleme). Metin ilk %30'da girer, ortada (dinlenme anı,
 * `REST_P`) tam ve hareketsizdir; sahneden ayrılırken dinlenme anının hemen ardından başlayıp sabit aralığın sonuna dek
 * usulca çekilir (yürüyüş eğrisinin yavaş kalkışıyla ~1 sn). Geçiş bölümler arasındaki bir ekran boyunda oynar; metin
 * geçiş anında ekranda olmaz.
 */
export const REST_P = 0.5
export const textIn = (p: number, first: boolean) => (first ? 1 : ramp(p, 0, 0.3))
export const textOut = (p: number) => 1 - smooth(ramp(p, 0.53, 1))
export function textVisibility(p: number, first: boolean) {
  return Math.min(textIn(p, first), textOut(p))
}

/**
 * Sahne durakları (tek kaydırma = bir durak): sabitlenen bölümde dinlenme anı, akıştaki (uzun içerikli) bölümde bölümün
 * başı, en sonda sayfanın sonu (final). Gezinme denetleyicisi ve dokunmatik yapışma noktaları aynı listeyi kullanır.
 */
export interface StopModel {
  tops: number[]
  heights: number[]
  pinned: boolean[]
  vh: number
  docEnd: number
  /** Akıştaki bölümde içeriğin bittiği sayfa konumu (sonrasındaki boşluk okunacak bir şey değildir). */
  ends?: number[]
}
export function stopsOf(m: StopModel): number[] {
  const stops = m.tops.map((t, i) => (i === 0 ? 0 : m.pinned[i] ? t + Math.max(0, m.heights[i] - m.vh) * REST_P : t))
  if (m.docEnd > stops[stops.length - 1] + 4) stops.push(m.docEnd)
  return stops
}
/** Akıştaki bölümün kendi içinde serbest kaydırma aralığı [baş, son]. */
export function flowRange(m: StopModel, i: number): [number, number] {
  const a = m.tops[i]
  const sectionEnd = a + Math.max(0, m.heights[i] - m.vh)
  const contentEnd = m.ends?.[i] !== undefined ? m.ends[i] - m.vh : sectionEnd
  return [a, Math.max(a, Math.min(sectionEnd, contentEnd))]
}

/**
 * Bir kaydırma hareketinin hedefi. Akıştaki bölümün içindeyken (içerik bitmeden) hedef yoktur: yerel kaydırma sürer.
 * Aksi hâlde yönüne göre bir sonraki/önceki durak (tek hareket bir durak; atlama yok).
 */
export function nextStop(m: StopModel, y: number, dir: 1 | -1): number | null {
  const stops = stopsOf(m)
  for (let i = 0; i < m.tops.length; i++) {
    if (m.pinned[i]) continue
    const [a, b] = flowRange(m, i)
    if (dir > 0 && y >= a - 2 && y < b - 2) return null
    if (dir < 0 && y > a + 2 && y <= b + 2) return null
  }
  if (dir > 0) return stops.find((s) => s > y + 2) ?? null
  for (let k = stops.length - 1; k >= 0; k--) if (stops[k] < y - 2) return stops[k]
  return null
}

/**
 * Kaplama düzeltmesi: dönüştürülen görsel (ölçek `s`, `o` noktası etrafında, sonra `d` kadar öteleme) ekranı tam
 * kaplamıyorsa en küçük ek ölçek. Geçişte görselin kenarı ekranda ince bir şerit bırakmasın.
 */
export function coverScale(b: Box, ox: number, oy: number, s: number, dx: number, dy: number, vw: number, vh: number) {
  const Ox = b.left + ox * b.width
  const Oy = b.top + oy * b.height
  let need = s
  const lim = (num: number, den: number) => (den > 0 ? num / den : 0)
  need = Math.max(need, lim(Ox + dx, Ox - b.left)) // sol kenar ≤ 0
  need = Math.max(need, lim(vw - Ox - dx, b.left + b.width - Ox)) // sağ kenar ≥ vw
  need = Math.max(need, lim(Oy + dy, Oy - b.top)) // üst kenar ≤ 0
  need = Math.max(need, lim(vh - Oy - dy, b.top + b.height - Oy)) // alt kenar ≥ vh
  return need
}

export interface Camera {
  scale: number
  /** Kutu boyutunun yüzdesi. */
  tx: number
  ty: number
  /** Ölçek merkezi (kutunun yüzdesi). */
  ox: number
  oy: number
}

/**
 * Sahne kamerası. `bIn`: bu sahnenin girişi, `bOut`: sonrakinin girişi (bu sahneden çıkış), `u`: sahnedeki ilerleme.
 * Taban ölçek parallax payı kadardır (kenarda boşluk görünmesin); geçişlerdeki ölçek kısa sürer ve kaybolur.
 */
export function camera(i: number, bIn: number, bOut: number, u: number, bursa: { x: number; y: number }): Camera {
  const p = SCENES[i].parallax
  let scale = 1 + p / 100
  let ty = (0.5 - u) * p
  let ox = 50
  let oy = 50
  switch (i) {
    case 0: // taş yolda ileri yürüyüş
      scale *= 1 + 0.08 * bOut
      oy = 75
      break
    case 1: // yola girerken yerine oturur; çıkarken kamera yükselir, şehir uzaklaşır
      scale *= (1.06 - 0.06 * bIn) * (1 - 0.08 * bOut)
      ty += 5 * bOut
      break
    case 2: // harita yukarıdan belirir; Bursa seçilince kamera Bursa'ya yaklaşır
      scale *= (1.12 - 0.12 * bIn) * (1 + 0.4 * bOut)
      ox = bursa.x
      oy = bursa.y
      break
    case 3:
      scale *= (1.08 - 0.08 * bIn) * (1 + 0.05 * bOut)
      break
    case 4:
      scale *= 1.05 - 0.05 * bIn
      ty += 3 * (1 - bIn)
      break
    default:
      scale *= 1.04 - 0.04 * bIn
  }
  return { scale, tx: 0, ty, ox, oy }
}
