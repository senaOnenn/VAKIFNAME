// Tanıtım filmi derleyicisi. Sürüm 3 (8 Kasım, Talha): film ÜRÜNÜ tanıtır, eserleri değil — sitenin introsu, sonra
// uygulamanın gerçek ekranlarıyla (telefon çerçevesinde) ürün akışı: kâşif seç → şehir ve rota → rehber anlatır, sorarsın →
// sorular → yerinde ziyaret → Kayıp Vakfiye → kâşifin büyür → herkes için (TR/EN, erişilebilirlik) → kapanış. Tarihî
// bilgi verilmez. Senaryo docs/TANITIM_FILMI.md "Sürüm 3".
//
//   node film/tools/build.mjs [film|altyazili|dongu|dongu-mobil]   → film/index.html (o sürüm; HyperFrames projede tek kök
//                                          kompozisyon ister) + film/out/tanitim-tr.vtt, tanitim-en.vtt. Render: tools/render.sh
//
// Ekranlar: tools/ekran-kaydi.mjs ile yerel tanıtım sunucusundan alınır (canlı içeriğin kopyası, ayrı veritabanı; canlıya
// yazılmaz) → VAKIFNAME_FILM_EKRAN (varsayılan ~/vakifname-film-demo). Sesler: Zülal'in izinli klon sesi,
// film/assets/audio/v3/sahne-N.mp3 (repoya girmez). Görseller derlemede kopyalanır (assets/img, assets/ekran; repoda yok).
//
// Hız (SPEED): senaryo ve zaman çizelgesi özgün saniyelerle yazılır; çıktıda bütün konum/süreler SPEED'e bölünür (O(),
// scaleJs). İç içe çizelge + timeScale kullanılmaz: HyperFrames'in seek'i iç içe çizelgede sıfır anlı set'leri bozuyor.
// Ses atempo ile hızlanır (perde değişmez).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parchment, scatter } from './parsomen.mjs'

const FILM = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(FILM, '..')
const FRONT = join(ROOT, 'frontend')
const AUDIO = join(FILM, 'assets', 'audio', 'v3')
const IMG = join(FILM, 'assets', 'img')
const EKRAN = join(FILM, 'assets', 'ekran')
const EKRAN_SRC = process.env.VAKIFNAME_FILM_EKRAN ?? join(homedir(), 'vakifname-film-demo')
const W = 1920
const H = 1080
/** Film hızı (8 Kasım: 1,15 kat). */
const SPEED = 1.15
/** Özgün saniye → film saniyesi. */
const O = (x) => Number((x / SPEED).toFixed(3))
/** Telefon: uygulama ekranı 390 × 844 CSS piksel (kayıt @2x), filmde K katı. */
const K = 1.06
const SW = Number((390 * K).toFixed(1))
const SH = Number((844 * K).toFixed(1))

// --- Senaryo (sürüm 3) ----------------------------------------------------------------------------------------------
// voice: seslendirilen metin (okunuşu yazıyla); tr: altyazı; en: İngilizce altyazı. Tarihî bilgi yok, yalnızca ürün.
export const SCENES = [
  { id: 'intro', min: 5.7, overlap: 1.1 },
  { id: 'urun', n: 2, min: 8, lead: 0.6,
    voice: 'Vakıfname, vakıf eserlerini keşfetmenin yeni yolu.',
    tr: 'VAKIFNAME, vakıf eserlerini keşfetmenin yeni yolu.',
    en: 'VAKIFNAME: a new way to discover waqf monuments.' },
  { id: 'kasif', n: 3, min: 7, lead: 0.4,
    voice: 'Önce kâşifini seç.',
    tr: 'Önce kâşifini seç.',
    en: 'First, choose your explorer.' },
  { id: 'rota', n: 4, min: 8, lead: 0.4,
    voice: 'Şehrini seç; rota seni en yakın eserden başlatır.',
    tr: 'Şehrini seç; rota seni en yakın eserden başlatır.',
    en: 'Choose your city; the route starts you at the nearest monument.' },
  { id: 'rehber', n: 5, min: 10, lead: 0.4,
    voice: 'Eserin başında rehberin anlatır; merak ettiğini ona sor.',
    tr: 'Eserin başında rehberin anlatır; merak ettiğini ona sor.',
    en: 'At the monument your guide tells its story; ask whatever you are curious about.' },
  { id: 'soru', n: 6, min: 9.5, lead: 0.4,
    voice: 'Sonra bilgini sına: dört doğru, bir bilgi mührü.',
    tr: 'Sonra bilgini sına: dört doğru, bir bilgi mührü.',
    en: 'Then test what you know: four right answers, one knowledge seal.' },
  { id: 'ziyaret', n: 7, min: 7.5, lead: 0.4,
    voice: 'Eserin önüne gittiğinde mührün altına döner.',
    tr: 'Eserin önüne gittiğinde mührün altına döner.',
    en: 'Go to the monument and your seal turns gold.' },
  { id: 'vakfiye', n: 8, min: 9, lead: 0.4,
    voice: "Her mühür, Kayıp Vakfiye'nin bir parçası.",
    tr: "Her mühür, Kayıp Vakfiye'nin bir parçası.",
    en: 'Every seal is a piece of the Lost Waqfiye.' },
  { id: 'gelisim', n: 9, min: 8, lead: 0.4,
    voice: 'Keşfettikçe kâşifin büyür.',
    tr: 'Keşfettikçe kâşifin büyür.',
    en: 'The more you explore, the more your explorer grows.' },
  // 8 Kasım (Talha): erişilebilirlik sahnesi beş kullanıcı grubunu öne çıkarır (görme, işitme, renk körlüğü, hareket, dikkat).
  { id: 'herkes', n: '10b', min: 12.6, lead: 0.5,
    voice: 'Sesli anlatım, altyazı, büyük yazı ve süresiz sorularla Vakıfname herkes için.',
    tr: 'Sesli anlatım, altyazı, büyük yazı ve süresiz sorularla VAKIFNAME herkes için.',
    en: 'With narration, subtitles, large text and untimed questions, VAKIFNAME is for everyone.' },
  { id: 'kapanis', n: 11, min: 7.5, lead: 0.5,
    voice: 'Vakıfname ile vakıf eserlerini yerinde keşfet.',
    tr: 'VAKIFNAME ile vakıf eserlerini yerinde keşfet.',
    en: 'Discover waqf monuments where they stand, with VAKIFNAME.' },
]

/** Ürün akışının adımları (sol alttaki akış çizgisi). */
const FLOW = [
  ['kasif', 'Kâşif'],
  ['rota', 'Rota'],
  ['rehber', 'Rehber'],
  ['soru', 'Sorular'],
  ['ziyaret', 'Ziyaret'],
]

/** Kâşif aşamaları (Buse): seviye eşiği ve adı. */
const STAGES = [
  ['1', 'Çırak Kâşif'],
  ['3', 'Gezgin Seyyah'],
  ['5', 'Vakıf Muhafızı'],
  ['7', 'Başkâşif'],
]

/** Uygulama ekranları (kayıt adı → kaynak, VAKIFNAME_FILM_EKRAN altında). Doğru/yanlış sorusu ilk kayıttan (kayit-v1). */
const EKRANLAR = {
  'landing': 'kayit/01-landing.png', 'landing-1': 'kayit/01-landing-1.png', 'landing-2': 'kayit/01-landing-2.png',
  'landing-4': 'kayit/01-landing-4.png',
  'karakter': 'kayit/03-karakter.png', 'karakter-secili': 'kayit/03-karakter-secili.png', 'oda': 'kayit/03-oda.png',
  'sehir': 'kayit/04-sehir.png', 'rota': 'kayit/04-rota.png', 'rota-konum': 'kayit/04-rota-konum.png',
  'eser': 'kayit/05-eser.png', 'dinliyor': 'kayit/05-dinliyor.png', 'dinliyor-2': 'kayit/05-dinliyor-2.png',
  'rehber-soru': 'kayit/05-rehber-soru.png', 'rehber-cevap': 'kayit/05-rehber-cevap.png',
  'soru1': 'kayit-v1/06-soru1.png', 'soru1-dogru': 'kayit-v1/06-soru1-dogru.png', 'soru2-yanlis': 'kayit/06-soru2-yanlis.png',
  'sonuc': 'kayit/06-sonuc.png',
  'ziyaret': 'kayit/07-ziyaret-once.png', 'ziyaret-altin': 'kayit/07-ziyaret-altin.png',
  'defter': 'kayit/08-defter.png',
  'erisilebilirlik': 'kayit/10-erisilebilirlik.png', 'en-eser': 'kayit/10-en-eser.png', 'en-rota': 'kayit/10-en-rota.png',
  'a11y-menu': 'kayit/11-menu.png', 'a11y-gorme': 'kayit/11-gorme.png', 'a11y-altyazi': 'kayit/11-altyazi.png',
  'a11y-odak': 'kayit/11-odak.png', 'a11y-suresiz': 'kayit/11-suresiz.png',
  // Renk körlüğü: aynı soru ekranı filmde döteranopi süzgecinden geçirilir (#vk-deut).
  'soru2-deut': 'kayit/06-soru2-yanlis.png',
}

/** Erişilebilirlik sahnesindeki kullanıcı grupları ve telefondaki karşılıkları (an: sahne başından, özgün sn). */
const GRUPLAR = [
  { at: 0.6, ad: 'Görme engelli ve az gören', ne: 'Ekran okuyucu · Büyük yazı · Yüksek kontrast · Sesli anlatım' },
  { at: 3.2, ad: 'İşitme engelli', ne: 'Altyazı · Büyük altyazı · Anlatımın tam metni · Yazılı soru-cevap' },
  { at: 5.0, ad: 'Renk körlüğü', ne: 'Anlam yalnız renkle verilmez: ✓ / ✗ ve yazı' },
  { at: 7.6, ad: 'Hareket ve el kullanımı', ne: 'Klavyeyle tam kullanım · Geniş düğmeler · Süre sınırı olmadan' },
  { at: 10.2, ad: 'Dikkat ve anlama', ne: 'Hareketi azalt · Duraklat, cümle cümle ilerle, hızı ayarla' },
]

// --- Ses ve zamanlama -----------------------------------------------------------------------------------------------
function audioFile(s) {
  if (!s.n) return null
  const p = join(AUDIO, `sahne-${s.n}.mp3`)
  return existsSync(p) ? p : null
}
const probe = (p) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString())
const estimate = (text) => text.split(/\s+/).length / 2.3 + 0.4

export function timing() {
  let t = 0
  return SCENES.map((s) => {
    const file = audioFile(s)
    const voiceDur = s.voice ? (file ? probe(file) : estimate(s.voice)) : 0
    const dur = s.voice ? Math.max(s.min, s.lead + voiceDur + 1.0) : s.min
    const out = { ...s, start: t, dur, voiceAt: t + (s.lead ?? 0), voiceDur, file }
    t += dur - (s.overlap ?? 0)
    return out
  })
}

/** Hızlandırılmış ses (atempo; perde değişmez). Kaynaktan yeniyse yeniden üretilmez. Çıktı assets/audio/v3/hizli/. */
function fastAudio(file) {
  const dir = join(AUDIO, 'hizli')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, file.split('/').pop().replace(/\.\w+$/, '.mp3'))
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(file).mtimeMs) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-filter:a', `atempo=${SPEED}`, '-c:a', 'libmp3lame', '-q:a', '2', out])
  }
  return out
}

/** Ses zarfı (0–1, `step` saniyelik pencereler, üç pencerelik ortalama): rehberin halesi sesle parlar. */
function envelope(file, step = 0.1) {
  const sr = 8000
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 's16le', '-'], { maxBuffer: 64 << 20 })
  const n = Math.floor(sr * step)
  const rms = []
  for (let i = 0; i + n * 2 <= raw.length; i += n * 2) {
    let sum = 0
    for (let j = 0; j < n; j++) {
      const v = raw.readInt16LE(i + j * 2) / 32768
      sum += v * v
    }
    rms.push(Math.sqrt(sum / n))
  }
  const smooth = rms.map((_, i) => (rms[Math.max(0, i - 1)] + rms[i] + rms[Math.min(rms.length - 1, i + 1)]) / 3)
  const peak = Math.max(...smooth, 1e-6)
  return smooth.map((v) => Math.min(1, v / peak))
}

/** Görseller derlemede kopyalanır (repoya girmez): Buse'nin kâşifleri, kadın rehber ve uygulama ekranları. */
function copyImages() {
  mkdirSync(IMG, { recursive: true })
  const kasif = join(FRONT, 'src/assets/kasif')
  for (const name of readdirSync(kasif).filter((x) => x.endsWith('.webp'))) copyFileSync(join(kasif, name), join(IMG, name))
  copyFileSync(join(FRONT, 'src/assets/guide/rehber-kadin-640.webp'), join(IMG, 'rehber.webp'))
  mkdirSync(EKRAN, { recursive: true })
  const missing = []
  for (const [name, rel] of Object.entries(EKRANLAR)) {
    const src = join(EKRAN_SRC, rel)
    if (existsSync(src)) copyFileSync(src, join(EKRAN, `${name}.png`))
    else if (!existsSync(join(EKRAN, `${name}.png`))) missing.push(rel)
  }
  if (missing.length) throw new Error(`Ekran kaydı eksik (${EKRAN_SRC}): ${missing.join(', ')} — tools/ekran-kaydi.mjs`)
}

// --- Yardımcılar ----------------------------------------------------------------------------------------------------
const f = (n) => Number(n.toFixed(3))
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GOLD_RULE = '<svg viewBox="0 0 240 12" aria-hidden="true"><line x1="0" y1="6" x2="104" y2="6" stroke="#c9a24b" stroke-width="1"/><line x1="136" y1="6" x2="240" y2="6" stroke="#c9a24b" stroke-width="1"/><polygon points="120,0 126,6 120,12 114,6" fill="#e9c874"/></svg>'

// --- Döngü (tanıtım sayfası arka planı) için Bursa haritası -----------------------------------------------------
/** Bursa merkezi ana yolları (ürünün çevrimdışı harita verisi, © OpenStreetMap katkıcıları). */
function roads(project) {
  const doc = JSON.parse(readFileSync(join(FRONT, 'src/app/components/offline-map/bursa.json'), 'utf8'))
  const decode = (flat) => {
    const pts = []
    let lat = 0
    let lng = 0
    for (let i = 0; i + 1 < flat.length; i += 2) {
      lat += flat[i]
      lng += flat[i + 1]
      pts.push(project(lat / 1e5, lng / 1e5))
    }
    return 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')
  }
  return ['river', 'minor', 'major']
    .map((cls) => doc[cls].map((ln) => `<path class="road road-${cls}" d="${decode(ln)}"/>`).join(''))
    .join('')
}

const MON = {
  ulu: { lat: 40.183926, lng: 29.061884, name: 'Bursa Ulu Camii' },
  koza: { lat: 40.18437, lng: 29.063537, name: 'Koza Han' },
  osman: { lat: 40.186831, lng: 29.057366, name: 'Osman Gazi Türbesi' },
  // Ziyaretçinin konumu (temsilî): Ulu Cami'nin güneyi — en yakın eser 1 numara olur, rota kendini kesmez.
  start: { lat: 40.1812, lng: 29.0612 },
}
// Film için Bursa görünümü: 1,67 × 2,55 km, ~648 px/km.
const bursa = (lat, lng) => ({ x: 135 + ((lng - 29.045) / 0.03) * 1650, y: ((40.193 - lat) / 0.015) * 1080 })


function bursaMap(id, withRoute = true, kasif = false) {
  const p = (m) => bursa(m.lat, m.lng)
  const [s, a, b, c] = [p(MON.start), p(MON.ulu), p(MON.koza), p(MON.osman)]
  const route = `M${s.x} ${s.y} L${a.x} ${a.y} L${b.x} ${b.y} L${c.x} ${c.y}`
  const pin = (q, n, name, side = 1) => `<g class="pin pin-${n}">
      <circle class="pin-glow" cx="${q.x}" cy="${q.y}" r="34"/><circle class="pin-body" cx="${q.x}" cy="${q.y}" r="22"/>
      <text class="pin-n" x="${q.x}" y="${q.y + 8}" text-anchor="middle">${n}</text>
      <text class="pin-name" x="${q.x + 34 * side}" y="${q.y + 8}" text-anchor="${side > 0 ? 'start' : 'end'}">${esc(name)}</text></g>`
  return `<svg class="map" id="${id}" viewBox="0 0 ${W} ${H}"><g class="bursa-roads">${roads(bursa)}</g>
    ${withRoute ? `<path class="route draw" d="${route}" pathLength="1"/>
    <circle class="you" cx="${s.x}" cy="${s.y}" r="11"/>
    ${kasif ? `<g class="you-kasif"><clipPath id="${id}-kc"><circle cx="${s.x}" cy="${s.y - 96}" r="58"/></clipPath>
      <path d="M${s.x - 13} ${s.y - 36} L${s.x} ${s.y - 16} L${s.x + 13} ${s.y - 36} Z" fill="#E9C874"/>
      <circle cx="${s.x}" cy="${s.y - 96}" r="63" fill="#0f1330" stroke="#E9C874" stroke-width="5"/>
      <image href="assets/img/kadin-1-portre.webp" x="${s.x - 58}" y="${s.y - 154}" width="116" height="116" clip-path="url(#${id}-kc)"/></g>` : ''}
    ${pin(a, 1, MON.ulu.name, -1)}${pin(b, 2, MON.koza.name)}${pin(c, 3, MON.osman.name, -1)}` : ''}</svg>`
}

// --- Telefon akışı --------------------------------------------------------------------------------------------------
// [sahne, an (sahne başından, özgün sn), ekran, geçiş, dokunma?]. Geçiş: ilk | it (sağdan itme) | kaydir (aşağı kaydırma)
// | sol (çapraz solma) | yukari (alttan açılan panel). Dokunma: {x, y} uygulama CSS pikseli, t: geçişe göre (eksi = önce).
const AKIS_A = [
  ['urun', 0, 'landing', 'ilk'],
  ['urun', 2.3, 'landing-1', 'kaydir'],
  ['urun', 4.0, 'landing-2', 'kaydir'],
  ['urun', 5.7, 'landing-4', 'kaydir'],
  ['kasif', 0, 'karakter', 'it', { x: 110, y: 602, t: -0.45 }],
  ['kasif', 1.9, 'karakter-secili', 'sol', { x: 195, y: 301, t: -0.3 }],
  ['kasif', 3.9, 'oda', 'it', { x: 139, y: 682, t: -0.3 }],
  ['rota', 0, 'sehir', 'it'],
  ['rota', 2.2, 'rota', 'it', { x: 195, y: 638, t: -0.3 }],
  ['rota', 4.6, 'rota-konum', 'sol', { x: 115, y: 684, t: -0.3 }],
  ['rehber', 0, 'eser', 'it'],
  ['rehber', 1.8, 'dinliyor', 'yukari', { x: 82, y: 735, t: -0.3 }],
  ['rehber', 4.3, 'dinliyor-2', 'sol'],
  ['rehber', 5.9, 'rehber-soru', 'sol'],
  ['rehber', 7.3, 'rehber-cevap', 'sol', { x: 328, y: 620, t: -0.3 }],
  ['soru', 0, 'soru1', 'it'],
  ['soru', 2.4, 'soru1-dogru', 'sol', { x: 102, y: 579, t: -0.3 }],
  ['soru', 4.6, 'soru2-yanlis', 'it'],
  ['soru', 6.8, 'sonuc', 'sol'],
  ['ziyaret', 0, 'ziyaret', 'it'],
  ['ziyaret', 2.6, 'ziyaret-altin', 'sol', { x: 121, y: 677, t: -0.45, konum: true }],
  ['vakfiye', 0, 'defter', 'it'],
]
const AKIS_B = [
  ['herkes', 0, 'a11y-menu', 'ilk'],
  ['herkes', 1.7, 'a11y-gorme', 'sol'],
  ['herkes', 3.2, 'a11y-altyazi', 'it'],
  ['herkes', 5.0, 'soru2-yanlis', 'it'],
  ['herkes', 6.1, 'soru2-deut', 'sol'],
  ['herkes', 7.6, 'a11y-odak', 'it'],
  ['herkes', 8.8, 'a11y-suresiz', 'sol'],
  ['herkes', 10.2, 'dinliyor-2', 'it'],
]

function phone(id, akis, from, to, extra = '') {
  const imgs = akis.map(([, , name], i) => `<img class="scr${i === 0 ? ' first' : ''}" id="${id}-${name}" src="assets/ekran/${name}.png" alt=""/>`).join('')
  const taps = akis
    .map(([, , , , tap], i) => (tap ? `<i class="tap" id="${id}-tap${i}" style="left:${f(tap.x * K)}px;top:${f(tap.y * K)}px"></i>${tap.konum ? `<i class="pulse" id="${id}-pulse${i}" style="left:${f(tap.x * K)}px;top:${f(tap.y * K)}px"></i>` : ''}` : ''))
    .join('')
  return `<div class="clip tel" id="${id}" data-start="${O(from)}" data-duration="${O(to - from)}" data-track-index="2">
    <div class="tel-screen">${imgs}${taps}${extra}</div></div>`
}

// --- Parşömen (Kayıp Vakfiye) ----------------------------------------------------------------------------------------
const PV = parchment({ id: 'pv', holes: true, whole: true })
const kasifImg = (who, n) => `assets/img/${who}-${n}-boy.webp`

// --- Sahneler -------------------------------------------------------------------------------------------------------
function cap(k, title, sub, extra = '') {
  return `<div class="cap">${extra}<p class="cap-k">${esc(k)}</p><h2 class="cap-t">${esc(title)}</h2>${sub ? `<p class="cap-s">${esc(sub)}</p>` : ''}</div>`
}
function rail(current) {
  const at = FLOW.findIndex(([id]) => id === current)
  return `<ol class="rail">${FLOW.map(([, label], i) => `<li class="${i < at ? 'done' : i === at ? 'on' : ''}"><i></i>${esc(label)}</li>`).join('')}</ol>`
}

function sceneHtml(t) {
  const S = Object.fromEntries(t.map((s) => [s.id, s]))
  const clip = (id, track = 1) => `class="clip scene" id="s-${id}" data-start="${O(S[id].start)}" data-duration="${O(S[id].dur)}" data-track-index="${track}"`
  const letters = (cls) => [...'VAKIFNAME'].map((ch) => `<span class="${cls}">${ch}</span>`).join('')
  return `
  <section ${clip('intro', 3)}>
    <div class="i-halo"></div>
    <div class="i-center"><h1 class="i-title">${letters('i-letter')}</h1><div class="i-rule">${GOLD_RULE}</div>
      <p class="i-tag">Geçmişin izinde, geleceğe bir miras</p></div>
  </section>

  <section ${clip('urun')}>${cap('VAKIFNAME', 'Vakıf eserlerini keşfetmenin yeni yolu', 'Rehberli, oyunlu ve yerinde: telefonunda.')}</section>

  <section ${clip('kasif')}>${cap('Adım 1', 'Kâşifini seç', 'Kadın ya da erkek kâşif; seviyen yükseldikçe görünümü gelişir.')}${rail('kasif')}</section>

  <section ${clip('rota')}>${cap('Adım 2', 'Şehrini ve rotanı seç', 'Konumuna göre en yakın eserden başlar.')}${rail('rota')}</section>

  <section ${clip('rehber')}>${cap('Adım 3', 'Rehberin anlatır, sen sorarsın', 'Sesli anlatım ve altyazı; her cevap kaynaklı.',
    '<div class="cap-guide"><div class="guide-halo"></div><img src="assets/img/rehber.webp" alt=""/></div>')}${rail('rehber')}</section>

  <section ${clip('soru')}>${cap('Adım 4', 'Bilgini sına', 'Her soruya 30 saniye. Dört doğru, bir bilgi mührü.')}${rail('soru')}</section>

  <section ${clip('ziyaret')}>${cap('Adım 5', 'Eseri yerinde ziyaret et', '50 metre içindeysen mührün altına döner.')}${rail('ziyaret')}</section>

  <section ${clip('vakfiye')}>
    ${cap('Kayıp Vakfiye', 'Her mühür bir parça', 'On eser, on parça: vakfiyeyi tamamla.')}
    <h2 class="v-title">Kayıp Vakfiye</h2>
    <div class="big">${PV.svg}</div>
  </section>

  <section ${clip('gelisim')}>
    <div class="flash"></div>
    <h2 class="g-title">Çıraktan Başkâşife</h2>
    ${['kadin', 'erkek'].map((who) => `<div class="kf kf-${who}">${[1, 2, 3, 4].map((n, i) => `<img class="st st-${i}" src="${kasifImg(who, n)}" alt=""/>`).join('')}</div>`).join('')}
    <div class="stage">
      ${STAGES.map(([lv, name], i) => `<p class="stage-name st-${i}"><small>Seviye ${lv}</small>${esc(name)}</p>`).join('')}
      <ol class="stage-track">${STAGES.map((_, i) => `<li class="sn-${i}"></li>`).join('')}</ol>
    </div>
  </section>

  <section ${clip('herkes')}>
    <svg class="defs" width="0" height="0" aria-hidden="true"><filter id="vk-deut" color-interpolation-filters="linearRGB">
      <feColorMatrix type="matrix" values="0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0"/></filter></svg>
    <div class="cap cap-a11y"><p class="cap-k">Herkes için</p><h2 class="cap-t">Erişilebilir tasarım</h2>
      <ol class="groups">${GRUPLAR.map((g, i) => `<li class="g g-${i}"><i></i><b>${esc(g.ad)}</b><span>${esc(g.ne)}</span></li>`).join('')}</ol></div>
  </section>

  <section ${clip('kapanis')}>
    <div class="i-halo"></div>
    <img class="end-kasif ek-l" src="${kasifImg('kadin', 4)}" alt=""/><img class="end-kasif ek-r" src="${kasifImg('erkek', 4)}" alt=""/>
    <div class="i-center c-center"><p class="i-title c-title">${letters('c-letter')}</p><div class="i-rule c-rule">${GOLD_RULE}</div>
      <p class="i-tag c-tag">Vakıf eserlerini yerinde keşfet.</p></div>
  </section>`
}

// --- Zaman çizelgesi (GSAP; özgün saniyelerle yazılır, çıktıda SPEED'e bölünür) ----------------------------------------
/** Üretilen çizelgedeki süre ve aralıkları film saniyesine çevirir (konumlar zaten at() ile çevrilir). */
const scaleJs = (js) => js.replace(/\b(duration|stagger):(-?[0-9.]+)/g, (_, k, v) => `${k}:${f(Number(v) / SPEED)}`)

function timelineJs(t, env) {
  const S = Object.fromEntries(t.map((s) => [s.id, s]))
  const L = []
  const at = (n) => O(n)
  const J = JSON.stringify
  const fadeIn = (sel, t0, d = 0.6, from = {}) => L.push(`tl.fromTo(${J(sel)},{opacity:0,...${J(from)}},{opacity:1,y:0,x:0,scale:1,duration:${d},ease:"power2.out"},${at(t0)});`)
  const fadeOut = (sel, t0, d = 0.5) => L.push(`tl.to(${J(sel)},{opacity:0,duration:${d},ease:"power1.in"},${at(t0)});`)
  const end = (s) => s.start + s.dur
  const caption = (id, outAt = end(S[id]) - 0.45) => {
    fadeIn(`#s-${id} .cap-k`, S[id].start + 0.15, 0.5, { y: 14 })
    fadeIn(`#s-${id} .cap-t`, S[id].start + 0.3, 0.7, { y: 22 })
    fadeIn(`#s-${id} .cap-s`, S[id].start + 0.55, 0.6, { y: 14 })
    fadeOut(`#s-${id} .cap`, outAt, 0.4)
  }

  // Açılış: sitedeki intro (Intro.tsx / intro.css) aynı zamanlamayla; perde 4,6 sn'de çözülür, alttan ürün açılır.
  const I = S.intro.start
  L.push(`tl.fromTo("#s-intro .i-halo",{scale:1,opacity:0.8},{scale:1.08,opacity:1,duration:6,ease:"sine.inOut"},${at(I)});`)
  ;[...'VAKIFNAME'].forEach((_, i) => {
    L.push(`tl.fromTo("#s-intro .i-letter:nth-child(${i + 1})",{opacity:0,filter:"blur(14px)",y:18,scale:1.12,letterSpacing:"0.08em"},{opacity:1,filter:"blur(0px)",y:0,scale:1,letterSpacing:"0.04em",duration:1.1,ease:"expo.out"},${at(I + 0.7 + i * 0.12)});`)
  })
  L.push(`tl.fromTo("#s-intro .i-letter",{backgroundPosition:"0% 0"},{backgroundPosition:"-120% 0",duration:2.6,ease:"sine.inOut"},${at(I + 2.6)});`)
  L.push(`tl.fromTo("#s-intro .i-rule",{opacity:0,scaleX:0.2},{opacity:1,scaleX:1,duration:1.2,ease:"expo.out"},${at(I + 2.2)});`)
  L.push(`tl.fromTo("#s-intro .i-tag",{opacity:0,y:10},{opacity:1,y:0,duration:1.1,ease:"expo.out"},${at(I + 2.7)});`)
  L.push(`tl.to("#s-intro",{opacity:0,duration:1.1,ease:"power2.inOut"},${at(I + 4.6)});`)

  // Telefonlar: giriş/çıkış, ekran geçişleri, dokunmalar.
  const phoneJs = (id, akis, enterAt, exitAt, exitTo) => {
    L.push(`tl.fromTo("#${id}",{opacity:0,y:140,scale:0.96},{opacity:1,y:0,scale:1,duration:1.0,ease:"power3.out"},${at(enterAt)});`)
    L.push(`tl.to("#${id}",{opacity:0,duration:0.7,ease:"power2.in",...${J(exitTo)}},${at(exitAt)});`)
    akis.forEach(([sid, rel, name, how, tap], i) => {
      const T = S[sid].start + rel
      const next = `#${id}-${name}`
      if (i > 0) {
        const prev = `#${id}-${akis[i - 1][2]}`
        if (how === 'it') {
          L.push(`tl.fromTo(${J(next)},{opacity:1,xPercent:100},{xPercent:0,duration:0.5,ease:"power2.inOut"},${at(T)});`)
          L.push(`tl.to(${J(prev)},{xPercent:-28,duration:0.5,ease:"power2.inOut"},${at(T)});`)
          L.push(`tl.set(${J(prev)},{opacity:0},${at(T + 0.5)});`)
        } else if (how === 'kaydir') {
          L.push(`tl.fromTo(${J(next)},{opacity:1,yPercent:100},{yPercent:0,duration:0.7,ease:"power2.inOut"},${at(T)});`)
          L.push(`tl.to(${J(prev)},{yPercent:-100,duration:0.7,ease:"power2.inOut"},${at(T)});`)
          L.push(`tl.set(${J(prev)},{opacity:0},${at(T + 0.7)});`)
        } else if (how === 'yukari') {
          L.push(`tl.fromTo(${J(next)},{opacity:1,yPercent:100},{yPercent:0,duration:0.55,ease:"power3.out"},${at(T)});`)
          L.push(`tl.set(${J(prev)},{opacity:0},${at(T + 0.55)});`)
        } else {
          L.push(`tl.fromTo(${J(next)},{opacity:0},{opacity:1,duration:0.35,ease:"power1.inOut"},${at(T)});`)
          L.push(`tl.set(${J(prev)},{opacity:0},${at(T + 0.35)});`)
        }
      }
      if (tap) {
        const tt = T + tap.t
        L.push(`tl.fromTo("#${id}-tap${i}",{opacity:0,scale:0.3},{opacity:1,scale:0.85,duration:0.14,ease:"power2.out"},${at(tt)});`)
        L.push(`tl.to("#${id}-tap${i}",{opacity:0,scale:1.7,duration:0.5,ease:"power2.out"},${at(tt + 0.16)});`)
        // immediateRender:false — başlangıç hâli (opaklık 0,9) ancak dokunma anında uygulanır; yoksa halka baştan görünür.
        if (tap.konum) L.push(`tl.fromTo("#${id}-pulse${i}",{opacity:0.9,scale:0.2},{opacity:0,scale:3.2,duration:1.1,ease:"power2.out",immediateRender:false},${at(tt + 0.1)});`)
      }
    })
  }
  phoneJs('telA', AKIS_A, S.urun.start, S.vakfiye.start + 2.6, { x: 320, scale: 0.92 })
  phoneJs('telB', AKIS_B, S.herkes.start, end(S.herkes) - 0.7, { y: 120 })

  // Başlıklar.
  // Ürün başlığı intronun perdesi çözüldükten sonra gelir.
  fadeIn('#s-urun .cap-k', S.urun.start + 1.0, 0.5, { y: 14 })
  fadeIn('#s-urun .cap-t', S.urun.start + 1.15, 0.7, { y: 22 })
  fadeIn('#s-urun .cap-s', S.urun.start + 1.4, 0.6, { y: 14 })
  fadeOut('#s-urun .cap', end(S.urun) - 0.45, 0.4)
  ;['kasif', 'rota', 'rehber', 'soru', 'ziyaret'].forEach((id) => caption(id))
  caption('vakfiye', S.vakfiye.start + 2.3)
  // Akış çizgisi: o anki adım parlar.
  ;['kasif', 'rota', 'rehber', 'soru', 'ziyaret'].forEach((id) => {
    L.push(`tl.fromTo("#s-${id} .rail li.on i",{scale:0.4},{scale:1,duration:0.5,ease:"back.out(2.4)"},${at(S[id].start + 0.2)});`)
  })
  fadeIn('#s-kasif .rail', S.kasif.start, 0.6, { y: 16 })

  // Rehber: hale sesle parlar.
  fadeIn('#s-rehber .cap-guide', S.rehber.start + 0.1, 0.6, { scale: 0.85 })
  ;(env.rehber ?? []).forEach((v, i) => {
    L.push(`tl.to("#s-rehber .guide-halo",{opacity:${f(0.22 + 0.78 * v)},scale:${f(1 + 0.08 * v)},duration:0.1,ease:"none"},${at(S.rehber.voiceAt + i * 0.1)});`)
  })

  // Kayıp Vakfiye: telefon çekilir, yırtık parşömen birleşir ve altınlaşır.
  const V = S.vakfiye.start
  fadeIn('#s-vakfiye .v-title', V + 2.8, 0.7, { y: 20 })
  fadeIn('#s-vakfiye .big', V + 2.9, 0.7, { scale: 0.96 })
  const sc = scatter(10, 5)
  const order = [1, 5, 2, 8, 3, 9, 4, 7, 6]
  order.forEach((i, k) => {
    const p = PV.pieces[i]
    const s0 = sc[i]
    L.push(`tl.fromTo("#s-vakfiye .tp-${i}",{opacity:0,x:${f(s0.x * 1.3)},y:${f(s0.y * 1.3)},rotation:${s0.rot},scale:1.25,svgOrigin:"${p.cx} ${p.cy}"},{opacity:1,x:0,y:0,rotation:0,scale:1,duration:0.9,ease:"back.out(1.15)"},${at(V + 3.3 + k * 0.22)});`)
  })
  const done = V + 3.3 + (order.length - 1) * 0.22 + 0.9
  L.push(`tl.fromTo("#s-vakfiye .seam-glow",{opacity:0},{opacity:1,duration:0.3,yoyo:true,repeat:1},${at(done + 0.05)});`)
  L.push(`tl.to("#s-vakfiye .whole",{opacity:1,duration:0.45},${at(done + 0.15)});`)
  L.push(`tl.to("#s-vakfiye .whole .wash",{opacity:0.62,duration:1.0,ease:"power1.inOut"},${at(done + 0.5)});`)
  L.push(`tl.to("#s-vakfiye .whole .gilt",{opacity:1,duration:1.0,ease:"power1.inOut"},${at(done + 0.5)});`)
  L.push(`tl.fromTo("#s-vakfiye .whole .sweep",{x:-1400},{x:1400,duration:1.3,ease:"power1.inOut"},${at(done + 1.0)});`)
  fadeOut('#s-vakfiye .v-title, #s-vakfiye .big', end(S.vakfiye) - 0.45, 0.4)

  // Kâşif gelişimi: düz görseller, altın parıltıyla aşama geçişi (3D yok).
  const G = S.gelisim.start
  fadeIn('#s-gelisim .g-title', G + 0.15, 0.7, { y: 22 })
  fadeIn('#s-gelisim .kf-kadin', G + 0.2, 0.8, { x: -60 })
  fadeIn('#s-gelisim .kf-erkek', G + 0.3, 0.8, { x: 60 })
  fadeIn('#s-gelisim .stage', G + 0.5, 0.6, { y: 16 })
  ;[1.7, 3.3, 4.9].forEach((rel, i) => {
    const T = G + rel
    L.push(`tl.fromTo("#s-gelisim .st.st-${i + 1}",{opacity:0,scale:1.04},{opacity:1,scale:1,duration:0.45,ease:"power2.out"},${at(T)});`)
    L.push(`tl.to("#s-gelisim .st.st-${i}",{opacity:0,duration:0.45,ease:"power1.inOut"},${at(T)});`)
    L.push(`tl.fromTo("#s-gelisim .flash",{opacity:0},{opacity:0.6,duration:0.16,yoyo:true,repeat:1},${at(T - 0.08)});`)
    L.push(`tl.to("#s-gelisim .stage-name.st-${i}",{opacity:0,y:-16,duration:0.22},${at(T - 0.1)});`)
    L.push(`tl.fromTo("#s-gelisim .stage-name.st-${i + 1}",{opacity:0,y:16},{opacity:1,y:0,duration:0.35,ease:"power2.out"},${at(T + 0.12)});`)
    L.push(`tl.to("#s-gelisim .sn-${i + 1}",{backgroundColor:"#E9C874",boxShadow:"0 0 18px rgba(233,200,116,0.9)",duration:0.3},${at(T)});`)
  })
  fadeOut('#s-gelisim .g-title, #s-gelisim .kf, #s-gelisim .stage', end(S.gelisim) - 0.45, 0.4)

  // Herkes için: beş kullanıcı grubu sırayla; o anki grup parlar, telefonda karşılığı görünür.
  const E = S.herkes.start
  fadeIn('#s-herkes .cap-k', E + 0.15, 0.5, { y: 14 })
  fadeIn('#s-herkes .cap-t', E + 0.3, 0.7, { y: 22 })
  GRUPLAR.forEach((g, i) => {
    L.push(`tl.fromTo("#s-herkes .g-${i}",{opacity:0,x:-24},{opacity:1,x:0,duration:0.45,ease:"power2.out"},${at(E + g.at)});`)
    L.push(`tl.fromTo("#s-herkes .g-${i} i",{scaleY:0},{scaleY:1,duration:0.35,ease:"power2.out"},${at(E + g.at)});`)
    if (i > 0) {
      L.push(`tl.to("#s-herkes .g-${i - 1}",{opacity:0.5,duration:0.35},${at(E + g.at)});`)
      L.push(`tl.to("#s-herkes .g-${i - 1} i",{scaleY:0,duration:0.3},${at(E + g.at)});`)
    }
  })
  fadeIn('#telB-badge', E + 6.1, 0.4, { y: -10 })
  fadeOut('#telB-badge', E + 7.45, 0.3)
  fadeOut('#s-herkes .cap', end(S.herkes) - 0.45, 0.4)

  // Kapanış: introyla aynı yazı, iki Başkâşif.
  const C = S.kapanis.start
  L.push(`tl.fromTo("#s-kapanis .i-halo",{opacity:0,scale:1},{opacity:1,scale:1.06,duration:${f(S.kapanis.dur)},ease:"sine.inOut"},${at(C)});`)
  L.push(`tl.fromTo("#s-kapanis .c-letter",{opacity:0,filter:"blur(12px)",y:16},{opacity:1,filter:"blur(0px)",y:0,duration:0.9,ease:"expo.out",stagger:0.07},${at(C + 0.2)});`)
  L.push(`tl.fromTo("#s-kapanis .c-letter",{backgroundPosition:"0% 0"},{backgroundPosition:"-120% 0",duration:2.2,ease:"sine.inOut"},${at(C + 1.5)});`)
  L.push(`tl.fromTo("#s-kapanis .c-rule",{opacity:0,scaleX:0.2},{opacity:1,scaleX:1,duration:1.0,ease:"expo.out"},${at(C + 1.0)});`)
  fadeIn('#s-kapanis .c-tag', C + 1.3, 0.8, { y: 12 })
  fadeIn('#s-kapanis .ek-l', C + 0.6, 0.9, { x: -60 })
  fadeIn('#s-kapanis .ek-r', C + 0.6, 0.9, { x: 60 })
  fadeOut('#s-kapanis .c-center, #s-kapanis .end-kasif, #s-kapanis .i-halo', end(S.kapanis) - 0.8, 0.8)
  return scaleJs(L.join('\n'))
}

// --- Altyazılar -----------------------------------------------------------------------------------------------------
function cues(t, lang) {
  const out = []
  for (const s of t) {
    if (!s[lang]) continue
    const parts = s[lang].split(/(?<=[.!?])\s+/)
    const chars = parts.reduce((a, p) => a + p.length, 0)
    let acc = 0
    for (const p of parts) {
      const a = s.voiceAt + (acc / chars) * s.voiceDur
      acc += p.length
      const b = s.voiceAt + (acc / chars) * s.voiceDur + 0.35
      out.push({ a, b: Math.min(b, s.start + s.dur), text: p })
    }
  }
  // Bir satır bir sonraki başlamadan biter (iki altyazı üst üste görünmesin).
  for (let i = 0; i + 1 < out.length; i++) out[i].b = Math.min(out[i].b, out[i + 1].a - 0.04)
  return out
}
const vttTime = (x) => {
  const ms = Math.round(x * 1000)
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, '0')}`
}
/** Altyazılar film saniyesiyle (hızlandırılmış). */
const cuesOut = (t, lang) => cues(t, lang).map((c) => ({ a: c.a / SPEED, b: c.b / SPEED, text: c.text }))
const vtt = (list) => 'WEBVTT\n\n' + list.map((c, i) => `${i + 1}\n${vttTime(c.a)} --> ${vttTime(c.b)}\n${c.text}\n`).join('\n')

// --- Sayfa ----------------------------------------------------------------------------------------------------------
const CSS = readFileSync(join(FILM, 'tools', 'film.css'), 'utf8')

/** `duration` ve `js` film saniyesiyle. `head`/`tail`: 3D için ek betikler. */
function page({ id, body, js, duration, width = W, height = H, extraCss = '', head = '', tail = '' }) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=${width}, height=${height}"/>
<script src="vendor/gsap.min.js"></script>
${head}
<style>${CSS}
html,body{width:${width}px;height:${height}px}#root{width:${width}px;height:${height}px}
${extraCss}</style>
</head>
<body>
<div id="root" data-composition-id="${id}" data-start="0" data-duration="${f(duration)}" data-width="${width}" data-height="${height}" data-fps="30">
<div class="clip bg" data-start="0" data-duration="${f(duration)}" data-track-index="0"></div>
${body}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${js}
tl.set({}, {}, ${f(duration)});
window.__timelines["${id}"] = tl;
tl.seek(0);
</script>
${tail}
</body>
</html>
`
}

function mainFilm(t, subtitles) {
  const S = Object.fromEntries(t.map((s) => [s.id, s]))
  const last = t[t.length - 1]
  const total = O(last.start + last.dur)
  const audio = t
    .filter((s) => s.file)
    .map((s) => {
      const fast = fastAudio(s.file)
      return `<audio id="ses-${s.id}" class="clip" data-start="${O(s.voiceAt)}" data-duration="${f(probe(fast))}" data-track-index="5" data-volume="1" src="assets/audio/v3/hizli/${fast.split('/').pop()}"></audio>`
    })
    .join('\n')
  const phones = phone('telA', AKIS_A, S.urun.start, S.vakfiye.start + 3.4) + phone('telB', AKIS_B, S.herkes.start, S.herkes.start + S.herkes.dur, '<p class="tel-badge" id="telB-badge">Renk körlüğü görünümü · döteranopi</p>')
  const subs = subtitles
    ? cuesOut(t, 'tr')
        .map((c) => `<p class="clip sub" data-start="${f(c.a)}" data-duration="${f(c.b - c.a)}" data-track-index="4"><span>${esc(c.text)}</span></p>`)
        .join('\n')
    : ''
  const env = { rehber: S.rehber.file ? envelope(S.rehber.file) : [] }
  return page({ id: subtitles ? 'altyazili' : 'main', body: sceneHtml(t) + phones + subs + audio, js: timelineJs(t, env), duration: total })
}

/** Tanıtım sayfası arka planı: 12 sn, yazısız, sessiz; başı ve sonu aynı kare (dikişsiz döngü). */
function loop(portrait) {
  const width = portrait ? 1080 : W
  const height = portrait ? 1920 : H
  // Dikey çerçevede rota merkeze alınır.
  // Dikeyde harita 1,8 kat büyütülür (1080 px yükseklik 1944 px olur, ekranı doldurur); durakların ortası (≈985,650)
  // yatayda ortada, dikeyde ekranın ~%60'ında kalır.
  const shift = portrait ? 'transform:translate(-1233px,-24px) scale(1.8);transform-origin:0 0' : ''
  const body = `<section class="clip scene" id="l1" data-start="0" data-duration="12" data-track-index="1">
    <div class="loop-map" style="${shift}">${bursaMap('lm')}</div></section>`
  const js = [
    `tl.fromTo("#l1 .loop-map",{opacity:0},{opacity:1,duration:1.2},0);`,
    `tl.fromTo("#lm",{scale:1.0,transformOrigin:"50% 50%"},{scale:1.12,duration:12,ease:"none"},0);`,
    `tl.fromTo("#lm .you",{opacity:0},{opacity:1,duration:0.4},1.0);`,
    `tl.to("#lm .route",{strokeDashoffset:0,duration:4.5,ease:"power1.inOut"},1.4);`,
    `tl.fromTo("#lm .pin",{opacity:0,scale:0.3,transformOrigin:"50% 50%"},{opacity:1,scale:1,duration:0.5,stagger:1.3,ease:"back.out(1.6)"},2.0);`,
    `tl.to("#lm .pin-3 .pin-body",{fill:"#E9C874",duration:0.6},7.2);`,
    `tl.to("#l1 .loop-map",{opacity:0,duration:1.6},10.4);`,
  ].join('\n')
  return page({ id: portrait ? 'dongu-mobil' : 'dongu', body, js, duration: 12, width, height, extraCss: '.pin-name{display:none}' + (portrait ? '.loop-map .map{width:1920px;height:1080px;right:auto;bottom:auto}' : '') })
}

// --- Çalıştır -------------------------------------------------------------------------------------------------------
// `ses-isleri <dosya>`: filmin ses satırları, backend/scripts/voice/generate.py iş listesi biçiminde (sahne-N.mp3).
if (process.argv[2] === 'ses-isleri') {
  const jobs = SCENES.filter((s) => s.voice).map((s) => ({ file: `sahne-${s.n}.mp3`, lang: 'tr', text: s.voice, monument_id: `film3-${s.n}`, ready: false }))
  writeFileSync(process.argv[3], JSON.stringify({ voice: { tr: 'zulal-1' }, jobs }, null, 1))
  console.log(`${jobs.length} ses satırı → ${process.argv[3]}`)
  process.exit(0)
}
const t = timing()
copyImages()
mkdirSync(join(FILM, 'assets', 'fonts'), { recursive: true })
mkdirSync(join(FILM, 'out'), { recursive: true })
copyFileSync(join(FRONT, 'src/assets/fonts/cormorant-garamond-latin-ext.woff2'), join(FILM, 'assets/fonts/cormorant-garamond-latin-ext.woff2'))
const variant = process.argv[2] ?? 'film'
const html = { film: () => mainFilm(t, false), altyazili: () => mainFilm(t, true), dongu: () => loop(false), 'dongu-mobil': () => loop(true) }[variant]
if (!html) throw new Error(`Bilinmeyen sürüm: ${variant} (film | altyazili | dongu | dongu-mobil)`)
writeFileSync(join(FILM, 'index.html'), html())
writeFileSync(join(FILM, 'out', 'tanitim-tr.vtt'), vtt(cuesOut(t, 'tr')))
writeFileSync(join(FILM, 'out', 'tanitim-en.vtt'), vtt(cuesOut(t, 'en')))
const last = t[t.length - 1]
const total = last.start + last.dur
console.log(`${variant} · film ${O(total).toFixed(1)} sn (özgün ${total.toFixed(1)} sn, ×${SPEED}) · ses: ${t.filter((s) => s.file).length}/${t.filter((s) => s.voice).length} sahne`)
for (const s of t) console.log(`  ${s.id}: ${O(s.start).toFixed(1)}–${O(s.start + s.dur).toFixed(1)} sn${s.voice && !s.file ? ' (tahmini; ses yok)' : ''}`)
