// Tanıtım filmi derleyicisi (Faz 9; senaryo docs/TANITIM_FILMI.md, 30 Ekim onaylı; 8 Kasım sürüm 2: 1,15 hız, 3D eser
// maketleri, kadın rehber, Buse'nin kâşifleri ve gelişimi, yırtık parşömen vakfiye).
//
//   node film/tools/build.mjs [film|altyazili|dongu|dongu-mobil]   → film/index.html (o sürüm; HyperFrames projede tek kök
//                                          kompozisyon ister) + film/out/tanitim-tr.vtt, tanitim-en.vtt. Render: tools/render.sh
//
// Çizimler ürünün kendi bileşenlerinden gelir (frontend/scripts/film-art.tsx, Vite SSR). Sahne süreleri ses dosyalarından
// (film/assets/audio/sahne-N.wav|mp3; repoya girmez) ölçülür; ses yoksa tahmini sürelerle sessiz taslak çıkar. Tarihî
// cümleler onaylı kayıtlardan aynen alınır; İngilizce altyazıdaki tarihî cümleler kitabın İngilizce bölümündendir.
//
// Hız (SPEED): senaryo ve zaman çizelgesi özgün saniyelerle yazılır; çıktıda bütün konum/süreler SPEED'e bölünür (O(),
// scaleJs). İç içe çizelge + timeScale kullanılmaz: HyperFrames'in seek'i iç içe çizelgede sıfır anlı set'leri bozuyor
// (8 Kasım denemesi). Ses atempo ile hızlanır (perde değişmez). 3D sahneler: tools/sahne3d.js.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parchment, scatter } from './parsomen.mjs'

const FILM = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(FILM, '..')
const FRONT = join(ROOT, 'frontend')
const AUDIO = join(FILM, 'assets', 'audio')
const IMG = join(FILM, 'assets', 'img')
const W = 1920
const H = 1080
/** Film hızı (8 Kasım: öncekinden 1,15 kat hızlı). */
const SPEED = 1.15
/** Özgün saniye → film saniyesi. */
const O = (x) => Number((x / SPEED).toFixed(3))
/** Kâşif gelişimi sahnesinde aşama geçişleri (sahne başından, özgün saniye). */
const FLIPS = [1.9, 3.9, 5.9]
const STAGES = [
  ['1', 'Çırak Kâşif'],
  ['3', 'Gezgin Seyyah'],
  ['5', 'Vakıf Muhafızı'],
  ['7', 'Başkâşif'],
]

// --- Senaryo -------------------------------------------------------------------------------------------------------
// voice: seslendirilen metin (okunuşu yazıyla); tr: altyazı (kayıttaki cümle aynen); en: İngilizce altyazı.
export const SCENES = [
  { id: 1, min: 6.5, lead: 1.4,
    voice: 'Bu topraklarda yüzyıllardır ayakta duran eserler var. Her birinin bir hikâyesi.',
    tr: 'Bu topraklarda yüzyıllardır ayakta duran eserler var. Her birinin bir hikâyesi.',
    en: 'Across these lands stand monuments that have lasted for centuries. Each one has a story.' },
  { id: 2, min: 8, lead: 0.6,
    voice: 'Vakıf Eserleri Envanter Projesi bu eserleri kitaplara kaydetti. Vakıfname onları yanına getiriyor.',
    tr: 'Vakıf Eserleri Envanter Projesi bu eserleri kitaplara kaydetti. VAKIFNAME onları yanına getiriyor.',
    en: 'The Waqf Heritage Inventory Project recorded them in books. VAKIFNAME brings them to you.' },
  { id: 3, min: 6, lead: 0.8,
    voice: 'Rehberin seni en yakın eserden başlatır.',
    tr: 'Rehberin seni en yakın eserden başlatır.',
    en: 'Your guide starts you at the nearest monument.' },
  { id: 4, min: 13, lead: 0.8, guide: true,
    voice: "Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır. Yaklaşık elli beşe altmış dokuz metrelik dikdörtgen bir plana oturan cami, on iki ayağa dayanan yirmi kubbeyle örtülüdür.",
    tr: "Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır. Yaklaşık 55 × 69 metrelik dikdörtgen bir plana oturan cami, on iki ayağa dayanan yirmi kubbeyle örtülüdür.",
    // Kitap, Cilt I s. 20 ("…were commissioned by Sultan Yıldırım Bayezid") ve s. 25–26.
    en: 'The mosque was commissioned by Sultan Yıldırım Bayezid. Bursa Ulucami is a rectangular-plan building measuring approximately 55 × 69 m; its twenty domes sit on twelve square piers.' },
  { id: 5, min: 8, lead: 0.6,
    voice: 'Dinle, sor, bilgini sına. Dört doğru, bir mühür.',
    tr: 'Dinle, sor, bilgini sına. Dört doğru, bir mühür.',
    en: 'Listen, ask, test what you know. Four right answers, one seal.' },
  { id: 6, min: 8, lead: 0.6,
    voice: 'Koza Han, yapıldığı günden bu yana ticaret için kullanılmaktadır.',
    tr: 'Koza Han, yapıldığı günden bu yana ticaret için kullanılmaktadır.',
    // Kitap, Cilt II s. 11.
    en: 'Today, the Koza Han has become one of the most heavily used commercial areas in the Bursa Bazaar.' },
  { id: 7, min: 10, lead: 0.6,
    voice: "Bugünkü türbeyi bin sekiz yüz altmış üçte Sultan Abdülaziz yeniden yaptırmıştır. Eserin önüne gittiğinde mührün altına döner.",
    tr: "Bugünkü türbeyi 1863'te Sultan Abdülaziz yeniden yaptırmıştır. Eserin önüne gittiğinde mührün altına döner.",
    // Kitap, Cilt II s. 119.
    en: 'The tomb that stands today was rebuilt by Sultan Abdulaziz in 1863. Go to the monument and your seal turns gold.' },
  // 8 Kasım: kâşif gelişimi (Buse'nin dört aşaması; XP dinleme, bilgi ve ziyaretten gelir, bkz. backend/app/xp.py).
  { id: 10, min: 9, lead: 0.6, kasif: true,
    voice: 'Keşfettikçe kâşifin büyür; çıraktan başkâşife yükselir.',
    tr: 'Keşfettikçe kâşifin büyür; çıraktan başkâşife yükselir.',
    en: 'The more you explore, the more your explorer grows, from apprentice to master explorer.' },
  { id: 8, min: 8, lead: 0.6,
    voice: 'Her eser bir parça. Hepsini ziyaret edersen vakfiye altın olur.',
    tr: 'Her eser bir parça. Hepsini ziyaret edersen vakfiye altın olur.',
    en: 'Every monument is a piece. Visit them all and the waqfiye turns gold.' },
  { id: 9, min: 7, lead: 0.8,
    voice: 'Vakıf eserlerini yerinde keşfet.',
    tr: 'Vakıf eserlerini yerinde keşfet.',
    en: 'Discover waqf monuments where they stand.' },
]

// --- Ses ve zamanlama -----------------------------------------------------------------------------------------------
function audioFile(id) {
  for (const ext of ['wav', 'mp3', 'm4a']) {
    const p = join(AUDIO, `sahne-${id}.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}
const probe = (p) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString())
const estimate = (text) => text.split(/\s+/).length / 2.3 + 0.4

export function timing() {
  let t = 0
  return SCENES.map((s) => {
    const file = audioFile(s.id)
    const voiceDur = file ? probe(file) : estimate(s.voice)
    const dur = Math.max(s.min, s.lead + voiceDur + 1.0)
    const out = { ...s, start: t, dur, voiceAt: t + s.lead, voiceDur, file }
    t += dur
    return out
  })
}

/** Hızlandırılmış ses (atempo; perde değişmez). Kaynaktan yeniyse yeniden üretilmez. Çıktı assets/audio/hizli/. */
function fastAudio(file) {
  const dir = join(AUDIO, 'hizli')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, file.split('/').pop().replace(/\.\w+$/, '.mp3'))
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(file).mtimeMs) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-filter:a', `atempo=${SPEED}`, '-c:a', 'libmp3lame', '-q:a', '2', out])
  }
  return out
}

/** Ses zarfı (0–1, `step` saniyelik pencereler, üç pencerelik ortalama): rehberin konuşurken parlayan halesi için. */
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

/** Görseller ürünün kaynağından kopyalanır (repoya ikinci kez girmez): Buse'nin kâşifleri ve kadın rehber. */
function copyImages() {
  mkdirSync(IMG, { recursive: true })
  const kasif = join(FRONT, 'src/assets/kasif')
  for (const name of readdirSync(kasif).filter((x) => x.endsWith('.webp'))) copyFileSync(join(kasif, name), join(IMG, name))
  copyFileSync(join(FRONT, 'src/assets/guide/rehber-kadin-640.webp'), join(IMG, 'rehber.webp'))
}

// --- Yardımcılar ----------------------------------------------------------------------------------------------------
const f = (n) => Number(n.toFixed(3))
/** Aynı belgede birden çok SVG: useId kimlikleri çakışmasın diye önek eklenir. */
function uniq(svg, tag) {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  let out = svg
  for (const id of new Set(ids)) {
    const safe = `${tag}-${id.replace(/[^A-Za-z0-9_-]/g, '')}`
    out = out.split(`id="${id}"`).join(`id="${safe}"`).split(`url(#${id})`).join(`url(#${safe})`).split(`href="#${id}"`).join(`href="#${safe}"`)
  }
  return out
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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

// --- Çizimler (ürün bileşenleri) ------------------------------------------------------------------------------------
async function loadArt() {
  const { createServer } = await import(pathToFileURL(join(FRONT, 'node_modules/vite/dist/node/index.js')).href)
  const vite = await createServer({ root: FRONT, logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
  try {
    const mod = await vite.ssrLoadModule(join(FRONT, 'scripts/film-art.tsx'))
    return mod.art()
  } finally {
    await vite.close()
  }
}

// --- Sahne işaretlemesi ---------------------------------------------------------------------------------------------
// Batıdaki yakın şehirlerin (İzmir, Manisa) etiketleri çakışmasın.
const LABEL = { izmir: { dx: -10, dy: 22, anchor: 'end' }, manisa: { dx: -10, dy: -10, anchor: 'end' } }

function turkeyMap(art, id) {
  const cities = art.cities
    .map(
      (c) => `<g class="city city-${c.slug}" data-slug="${c.slug}">
        <circle class="city-halo" cx="${c.x}" cy="${c.y}" r="${c.slug === 'bursa' ? 18 : 12}"/>
        <circle class="city-dot" cx="${c.x}" cy="${c.y}" r="${c.slug === 'bursa' ? 6.5 : 4.5}"/>
        <text class="city-name" x="${c.x + (LABEL[c.slug]?.dx ?? 10)}" y="${c.y + (LABEL[c.slug]?.dy ?? -12)}" text-anchor="${LABEL[c.slug]?.anchor ?? 'start'}">${esc(c.name)}</text>
      </g>`,
    )
    .join('')
  return `<svg class="map" id="${id}" viewBox="0 0 ${W} ${H}">
    <g transform="translate(160 190) scale(1.6)"><g class="tr-zoom">
      <path class="tr-land draw" d="${art.turkey.path}" pathLength="1"/>
      ${cities}
    </g></g></svg>`
}

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

function visitInset() {
  // Osman Gazi Türbesi çevresi, ~2400 px/km: 50 m halka ≈ 120 px.
  const k = 2.4
  const c0 = { x: 230, y: 230 }
  const proj = (lat, lng) => ({ x: c0.x + (lng - MON.osman.lng) * 85.06 * 1000 * k, y: c0.y - (lat - MON.osman.lat) * 111.0 * 1000 * k })
  return `<svg class="inset" viewBox="0 0 460 460"><defs><clipPath id="inset-clip"><circle cx="230" cy="230" r="226"/></clipPath></defs>
    <g clip-path="url(#inset-clip)"><rect width="460" height="460" fill="#141a44"/>${roads(proj)}
      <circle class="ring" cx="230" cy="230" r="120"/><circle class="target" cx="230" cy="230" r="10"/>
      <circle class="visitor" cx="230" cy="230" r="12"/></g>
    <circle cx="230" cy="230" r="226" fill="none" stroke="#C9A24B" stroke-width="3"/>
    <text class="ring-label" x="230" y="96" text-anchor="middle">50 m</text></svg>`
}

// Parşömenler bir kez üretilir (aynı tohum: Koza Han'daki küçük vakfiye ile büyük vakfiye aynı yırtığı taşır).
const PM6 = parchment({ id: 'pm6', holes: true })
const PV8 = parchment({ id: 'pv8', holes: true, whole: true })
const kasifImg = (who, n) => `assets/img/${who}-${n}-boy.webp`

function sceneHtml(t, art) {
  const S = Object.fromEntries(t.map((s) => [s.id, s]))
  const clip = (id, extra = '') => `class="clip scene${extra}" id="s${id}" data-start="${O(S[id].start)}" data-duration="${O(S[id].dur)}" data-track-index="1"`
  const title = (txt, extra = '') => `<h2 class="mon-title${extra}">${esc(txt)}</h2>`
  const source = (txt) => `<p class="source">Kaynak: ${esc(txt)}</p>`
  const canvas = (id) => `<canvas id="${id}" class="g3d" width="${W}" height="${H}"></canvas>`
  return `
  <section ${clip(1)}>${canvas('g1')}</section>

  <section ${clip(2)}>${turkeyMap(art, 'tr2')}<p class="kicker">Vakıf Eserleri Envanter Projesi</p></section>

  <section ${clip(3)}>${turkeyMap(art, 'tr3')}${bursaMap('bm3', true, true)}</section>

  <section ${clip(4)}>
    ${canvas('g4')}
    ${title(MON.ulu.name)}
    <div class="medal"><div class="medal-ring"><span>Y.B.</span></div><p><small>Eserin banisi</small>Yıldırım Bayezid</p></div>
    ${source('Bursa Vakıf Eserleri, Cilt I · s. 20, 25')}
  </section>

  <section ${clip(5)}>
    <div class="quiz"><p class="quiz-kicker">Rozeti al · Soru 1 / 5</p><p class="quiz-q">Ulu Cami'yi kim yaptırdı?</p>
      <ol class="quiz-c"><li>Orhan Gazi</li><li class="ok">Yıldırım Bayezid <b>✓</b></li><li>II. Murad</li></ol></div>
    <div class="seal-k">${uniq(art.seals.knowledge, 'sk5')}<p>Bilgi mührü</p></div>
  </section>

  <section ${clip(6)}>
    ${canvas('g6')}
    ${title(MON.koza.name)}
    <div class="mini">${PM6.svg}</div>
    ${source('Bursa Vakıf Eserleri, Cilt II · s. 11')}
  </section>

  <section ${clip(7)}>
    ${canvas('g7')}
    ${title(MON.osman.name)}
    <div class="visit">${visitInset()}</div>
    <div class="seal-v"><div class="sv-k">${uniq(art.seals.knowledge, 'sk7')}</div><div class="sv-g">${uniq(art.seals.gold, 'sg7')}<i class="shine"></i></div><p>Altın mühür</p></div>
    ${source('Bursa Vakıf Eserleri, Cilt II · s. 120')}
  </section>

  <section ${clip(10)}>
    <div class="flash"></div>
    ${canvas('g10')}
    ${title('Çıraktan Başkâşife', ' center')}
    <div class="stage">
      ${STAGES.map(([lv, name], i) => `<p class="stage-name st-${i}"><small>Seviye ${lv}</small>${esc(name)}</p>`).join('')}
      <ol class="stage-track">${STAGES.map((_, i) => `<li class="sn-${i}"></li>`).join('')}</ol>
    </div>
  </section>

  <section ${clip(8)}>
    ${title('Kayıp Vakfiye', ' center')}
    <div class="big">${PV8.svg}</div>
  </section>

  <section ${clip(9)}>${turkeyMap(art, 'tr9')}
    <img class="end-kasif ek-l" src="${kasifImg('kadin', 4)}" alt=""/><img class="end-kasif ek-r" src="${kasifImg('erkek', 4)}" alt=""/>
    <div class="end"><p class="wordmark">VAKIFNAME</p><div class="rule">${art.rule}</div><p class="tagline">Vakıf eserlerini yerinde keşfet.</p></div>
    <p class="credits">Bilgiler: Vakıf Eserleri Envanter Projesi yayınları · Harita verisi: © OpenStreetMap katkıcıları · Eser modelleri temsilîdir · Ses: Zülal'in sesinden, izniyle, yapay zekâ ile üretildi · Rehber ve kâşifler canlandırmadır</p>
  </section>`
}

/** 3D sahnelerin ayarı (sahne3d.js okur); zamanlar film saniyesidir. */
function config3d(t) {
  const S = Object.fromEntries(t.map((s) => [s.id, s]))
  const at = (id) => ({ start: O(S[id].start), dur: O(S[id].dur) })
  return {
    scenes: [
      { canvas: 'g1', kind: 'trio', ...at(1), w: W, h: H },
      // Maket ekranın solunda (sağda rehber / vakfiye / ziyaret): görüş merkezi kaydırılır (center, piksel).
      { canvas: 'g4', kind: 'ulu', ...at(4), w: W, h: H, center: [610, 560] },
      { canvas: 'g6', kind: 'koza', ...at(6), w: W, h: H, center: [600, 545] },
      { canvas: 'g7', kind: 'turbe', ...at(7), w: W, h: H, center: [600, 560] },
      {
        canvas: 'g10', kind: 'kasif', ...at(10), w: W, h: H, spread: 5.2, flips: FLIPS.map(O),
        images: { kadin: [1, 2, 3, 4].map((n) => kasifImg('kadin', n)), erkek: [1, 2, 3, 4].map((n) => kasifImg('erkek', n)) },
      },
    ],
  }
}

// --- Zaman çizelgesi (GSAP; özgün saniyelerle yazılır, çıktıda SPEED'e bölünür) ----------------------------------------
/** Üretilen çizelgedeki süre ve aralıkları film saniyesine çevirir (konumlar zaten at() ile çevrilir). */
const scaleJs = (js) => js.replace(/\b(duration|stagger):(-?[0-9.]+)/g, (_, k, v) => `${k}:${f(Number(v) / SPEED)}`)

function timelineJs(t, env4) {
  const S = Object.fromEntries(t.map((s) => [s.id, s]))
  const L = []
  const at = (n) => O(n)
  const fadeIn = (sel, t0, d = 0.6, from = {}) => L.push(`tl.fromTo(${JSON.stringify(sel)},{opacity:0,...${JSON.stringify(from)}},{opacity:1,y:0,x:0,scale:1,duration:${d},ease:"power2.out"},${at(t0)});`)
  const fadeOut = (sel, t0, d = 0.5) => L.push(`tl.to(${JSON.stringify(sel)},{opacity:0,duration:${d},ease:"power1.in"},${at(t0)});`)
  const draw = (sel, t0, d, stagger = 0) => L.push(`tl.to(${JSON.stringify(sel)},{strokeDashoffset:0,duration:${d},ease:"power1.inOut",stagger:${stagger}},${at(t0)});`)
  const end = (s) => s.start + s.dur

  // 1 — üç eserin maketi sırayla yükselir (3D; sahne3d.js). Burada yalnızca giriş/çıkış.
  fadeIn('#g1', S[1].start, 0.8)
  fadeOut('#g1', end(S[1]) - 0.6, 0.6)

  // 2 — Türkiye haritası, envanter şehirleri sırayla yanar (yayın yılı sırası: Hatay, Konya, Bursa, Kütahya, İzmir, Manisa).
  draw('#tr2 .tr-land', S[2].start, 1.8)
  L.push(`tl.fromTo("#tr2 .tr-land",{fillOpacity:0},{fillOpacity:1,duration:1.2},${at(S[2].start + 1.2)});`)
  fadeIn('#s2 .kicker', S[2].start + 0.6, 0.8, { y: 20 })
  ;['hatay', 'konya', 'bursa', 'kutahya', 'izmir', 'manisa'].forEach((slug, i) => {
    fadeIn(`#tr2 .city-${slug}`, S[2].start + 2.0 + i * 0.55, 0.5, { scale: 0.4, transformOrigin: '50% 50%' })
  })

  // 3 — Bursa'ya yakınlaşma, yollar, kâşif (Çırak) ve rota.
  L.push(`tl.set("#tr3 .tr-land",{strokeDashoffset:0},0);`)
  L.push(`tl.fromTo("#tr3 .tr-zoom",{scale:1},{scale:7,svgOrigin:"178 137",duration:1.6,ease:"power2.in"},${at(S[3].start)});`)
  fadeOut('#tr3', S[3].start + 1.0, 0.6)
  fadeIn('#bm3 .bursa-roads', S[3].start + 1.1, 0.8, { scale: 0.85, transformOrigin: '50% 50%' })
  fadeIn('#bm3 .you', S[3].start + 1.6, 0.4)
  fadeIn('#bm3 .you-kasif', S[3].start + 1.7, 0.6, { y: 24 })
  draw('#bm3 .route', S[3].start + 2.0, 2.4)
  ;[1, 2, 3].forEach((n, i) => fadeIn(`#bm3 .pin-${n}`, S[3].start + 2.3 + i * 0.7, 0.45, { scale: 0.3, transformOrigin: '50% 50%' }))

  // 4 — Ulu Cami: 3D maket yükselir; rehber (sabit görsel) konuşurken halesi sesle parlar; banisi madalyonu, kaynak.
  fadeIn('#g4', S[4].start, 0.5)
  fadeIn('#s4 .mon-title', S[4].start + 0.2, 0.7, { y: 24 })
  fadeIn('#s4 .medal', S[4].start + 2.6, 0.7, { scale: 0.7, transformOrigin: '50% 50%' })
  fadeIn('#s4 .source', S[4].start + 3.2, 0.6, { y: 10 })
  fadeIn('.guide-wrap', S[4].start + 0.3, 0.8, { x: 60 })
  fadeOut('.guide-wrap', end(S[4]) - 0.6, 0.5)
  env4.forEach((v, i) => {
    L.push(`tl.to(".guide-halo",{opacity:${f(0.22 + 0.78 * v)},scale:${f(1 + 0.07 * v)},duration:0.1,ease:"none"},${at(S[4].voiceAt + i * 0.1)});`)
  })
  L.push(`tl.to(".guide-halo",{opacity:0.22,scale:1,duration:0.4},${at(S[4].voiceAt + S[4].voiceDur)});`)

  // 5 — soru, doğru şık (üründeki gibi yeşil ✓), bilgi mührü basılır.
  fadeIn('#s5 .quiz', S[5].start + 0.2, 0.6, { y: 30 })
  L.push(`tl.fromTo("#s5 .quiz-c li",{opacity:0,x:-20},{opacity:1,x:0,duration:0.4,stagger:0.15},${at(S[5].start + 0.7)});`)
  L.push(`tl.to("#s5 .ok",{backgroundColor:"rgba(63,174,114,0.22)",borderColor:"#3fae72",duration:0.4},${at(S[5].start + 2.2)});`)
  fadeIn('#s5 .ok b', S[5].start + 2.3, 0.3, { scale: 0.2 })
  L.push(`tl.fromTo("#s5 .seal-k",{opacity:0,scale:2.4,rotation:-18},{opacity:1,scale:1,rotation:0,duration:0.8,ease:"back.out(1.6)"},${at(S[5].start + 3.2)});`)

  // 6 — Koza Han: 3D maket; küçük vakfiyede Ulu Cami'nin parçası yerinde, yenisi maketten uçup yerine oturur.
  fadeIn('#g6', S[6].start, 0.5)
  fadeIn('#s6 .mon-title', S[6].start + 0.2, 0.7, { y: 24 })
  fadeIn('#s6 .mini', S[6].start + 1.4, 0.6)
  {
    const p = PM6.pieces[1]
    L.push(`tl.fromTo("#s6 .tp-1",{opacity:0,x:-1250,y:180,rotation:-30,scale:1.5,svgOrigin:"${p.cx} ${p.cy}"},{opacity:1,x:0,y:0,rotation:0,scale:1,duration:1.2,ease:"power3.out"},${at(S[6].start + 3.0)});`)
  }
  fadeIn('#s6 .source', S[6].start + 2.6, 0.6, { y: 10 })

  // 7 — Osman Gazi Türbesi: 3D maket; ziyaretçi 50 m halkasına girer, mühür altına döner.
  fadeIn('#g7', S[7].start, 0.5)
  fadeIn('#s7 .mon-title', S[7].start + 0.2, 0.7, { y: 24 })
  fadeIn('#s7 .visit', S[7].start + 1.0, 0.7, { scale: 0.85, transformOrigin: '50% 50%' })
  L.push(`tl.fromTo("#s7 .visitor",{x:190,y:-150},{x:30,y:-20,duration:2.4,ease:"power1.inOut"},${at(S[7].start + 1.6)});`)
  L.push(`tl.to("#s7 .ring",{stroke:"#E9C874",strokeWidth:5,duration:0.4},${at(S[7].start + 3.9)});`)
  fadeIn('#s7 .seal-v', S[7].start + 2.0, 0.6, { scale: 0.8, transformOrigin: '50% 50%' })
  L.push(`tl.fromTo("#s7 .sv-g",{opacity:0,scale:1.25},{opacity:1,scale:1,duration:0.7,ease:"back.out(1.4)"},${at(S[7].start + 4.2)});`)
  L.push(`tl.fromTo("#s7 .shine",{xPercent:-160},{xPercent:160,duration:1.1,ease:"power1.inOut"},${at(S[7].start + 4.9)});`)
  fadeIn('#s7 .source', S[7].start + 2.6, 0.6, { y: 10 })

  // 10 — kâşif gelişimi: iki kâşif (3D kabartma) dört aşamadan geçer; her geçişte kart döner (sahne3d.js), ad değişir.
  fadeIn('#g10', S[10].start, 0.6)
  fadeIn('#s10 .mon-title', S[10].start + 0.2, 0.7, { y: 24 })
  fadeIn('#s10 .stage', S[10].start + 0.5, 0.6, { y: 16 })
  FLIPS.forEach((fl, i) => {
    const tt = S[10].start + fl
    L.push(`tl.to("#s10 .st-${i}",{opacity:0,y:-16,duration:0.22},${at(tt - 0.22)});`)
    L.push(`tl.fromTo("#s10 .st-${i + 1}",{opacity:0,y:16},{opacity:1,y:0,duration:0.35,ease:"power2.out"},${at(tt + 0.04)});`)
    L.push(`tl.to("#s10 .sn-${i + 1}",{backgroundColor:"#E9C874",boxShadow:"0 0 18px rgba(233,200,116,0.9)",duration:0.3},${at(tt)});`)
    L.push(`tl.fromTo("#s10 .flash",{opacity:0},{opacity:0.6,duration:0.14,yoyo:true,repeat:1},${at(tt - 0.1)});`)
  })
  fadeOut('#s10 .stage, #s10 .mon-title, #g10', end(S[10]) - 0.5, 0.5)

  // 8 — Kayıp Vakfiye: yırtık parşömen parçaları uçup birleşir, dikişler kaybolur, vakfiye altınlaşır.
  fadeIn('#s8 .mon-title', S[8].start + 0.2, 0.6, { y: 20 })
  fadeIn('#s8 .big', S[8].start + 0.3, 0.6)
  const sc = scatter(10, 5)
  const order = [5, 2, 8, 3, 9, 4, 7, 6]
  order.forEach((i, k) => {
    const p = PV8.pieces[i]
    const s0 = sc[i]
    L.push(`tl.fromTo("#s8 .tp-${i}",{opacity:0,x:${f(s0.x * 1.3)},y:${f(s0.y * 1.3)},rotation:${s0.rot},scale:1.25,svgOrigin:"${p.cx} ${p.cy}"},{opacity:1,x:0,y:0,rotation:0,scale:1,duration:0.95,ease:"back.out(1.15)"},${at(S[8].start + 0.7 + k * 0.27)});`)
  })
  const done = S[8].start + 0.7 + (order.length - 1) * 0.27 + 0.95
  L.push(`tl.fromTo("#s8 .seam-glow",{opacity:0},{opacity:1,duration:0.3,yoyo:true,repeat:1},${at(done + 0.05)});`)
  L.push(`tl.to("#s8 .whole",{opacity:1,duration:0.45},${at(done + 0.15)});`)
  L.push(`tl.to("#s8 .whole .wash",{opacity:0.62,duration:1.1,ease:"power1.inOut"},${at(done + 0.6)});`)
  L.push(`tl.to("#s8 .whole .gilt",{opacity:1,duration:1.1,ease:"power1.inOut"},${at(done + 0.6)});`)
  L.push(`tl.fromTo("#s8 .whole .sweep",{x:-1400},{x:1400,duration:1.4,ease:"power1.inOut"},${at(done + 1.2)});`)

  // 9 — kapanış: harita ışıkları, iki Başkâşif, VAKIFNAME.
  L.push(`tl.set("#tr9 .tr-land",{strokeDashoffset:0,fillOpacity:0.55},0);`)
  L.push(`tl.fromTo("#tr9",{opacity:0},{opacity:0.32,duration:0.8},${at(S[9].start)});`)
  L.push(`tl.fromTo("#tr9 .city",{opacity:0},{opacity:1,duration:0.4,stagger:0.12},${at(S[9].start + 0.4)});`)
  fadeIn('#s9 .ek-l', S[9].start + 0.5, 0.9, { x: -50 })
  fadeIn('#s9 .ek-r', S[9].start + 0.5, 0.9, { x: 50 })
  fadeIn('#s9 .wordmark', S[9].start + 0.9, 0.9, { y: 20 })
  fadeIn('#s9 .rule', S[9].start + 1.4, 0.6)
  fadeIn('#s9 .tagline', S[9].start + 1.7, 0.7, { y: 14 })
  fadeIn('#s9 .credits', S[9].start + 2.6, 0.8)
  fadeOut('#s9 .end, #s9 .credits, #tr9, #s9 .end-kasif', end(S[9]) - 0.8, 0.8)
  return scaleJs(L.join('\n'))
}

// --- Altyazılar -----------------------------------------------------------------------------------------------------
function cues(t, lang) {
  const out = []
  for (const s of t) {
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

function mainFilm(t, art, subtitles) {
  const total = O(t[t.length - 1].start + t[t.length - 1].dur)
  const audio = t
    .filter((s) => s.file)
    .map((s) => {
      const fast = fastAudio(s.file)
      return `<audio id="ses-${s.id}" class="clip" data-start="${O(s.voiceAt)}" data-duration="${f(probe(fast))}" data-track-index="5" data-volume="1" src="assets/audio/hizli/${fast.split('/').pop()}"></audio>`
    })
    .join('\n')
  const g = t.find((s) => s.guide)
  const guide = `<div class="clip guide-wrap" data-start="${O(g.start)}" data-duration="${O(g.dur)}" data-track-index="2">
    <div class="guide-halo"></div><img class="guide-img" src="assets/img/rehber.webp" alt=""/><p class="role">Rehber · canlandırma</p></div>`
  const subs = subtitles
    ? cuesOut(t, 'tr')
        .map((c) => `<p class="clip sub" data-start="${f(c.a)}" data-duration="${f(c.b - c.a)}" data-track-index="4"><span>${esc(c.text)}</span></p>`)
        .join('\n')
    : ''
  const env4 = g.file ? envelope(g.file) : []
  // 3D: çizim hazır olana kadar render bekler (buildReady); hf-seek zamanı modül yüklenmeden gelirse saklanır.
  const head = `<script>
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady.vk3d = new Promise((ok, no) => { window.__vk3dDone = ok; window.__vk3dFail = no; });
window.addEventListener('hf-seek', (e) => { window.__vk3dTime = e.detail.time; });
window.__vk3d = ${JSON.stringify(config3d(t))};
</script>`
  return page({
    id: subtitles ? 'altyazili' : 'main', body: sceneHtml(t, art) + guide + subs + audio, js: timelineJs(t, env4), duration: total,
    head, tail: '<script type="module" src="tools/sahne3d.js"></script>',
  })
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
  const jobs = SCENES.map((s) => ({ file: `sahne-${s.id}.mp3`, lang: 'tr', text: s.voice, monument_id: `film-${s.id}`, ready: false }))
  writeFileSync(process.argv[3], JSON.stringify({ voice: { tr: 'zulal-1' }, jobs }, null, 1))
  console.log(`${jobs.length} ses satırı → ${process.argv[3]}`)
  process.exit(0)
}
const art = await loadArt()
const t = timing()
copyImages()
mkdirSync(join(FILM, 'assets', 'fonts'), { recursive: true })
mkdirSync(join(FILM, 'out'), { recursive: true })
copyFileSync(join(FRONT, 'src/assets/fonts/cormorant-garamond-latin-ext.woff2'), join(FILM, 'assets/fonts/cormorant-garamond-latin-ext.woff2'))
const variant = process.argv[2] ?? 'film'
const html = { film: () => mainFilm(t, art, false), altyazili: () => mainFilm(t, art, true), dongu: () => loop(false), 'dongu-mobil': () => loop(true) }[variant]
if (!html) throw new Error(`Bilinmeyen sürüm: ${variant} (film | altyazili | dongu | dongu-mobil)`)
writeFileSync(join(FILM, 'index.html'), html())
writeFileSync(join(FILM, 'out', 'tanitim-tr.vtt'), vtt(cuesOut(t, 'tr')))
writeFileSync(join(FILM, 'out', 'tanitim-en.vtt'), vtt(cuesOut(t, 'en')))
const total = t[t.length - 1].start + t[t.length - 1].dur
console.log(`${variant} · film ${O(total).toFixed(1)} sn (özgün ${total.toFixed(1)} sn, ×${SPEED}) · ses: ${t.filter((s) => s.file).length}/${t.length} sahne`)
for (const s of t) console.log(`  ${s.id}: ${O(s.start).toFixed(1)}–${O(s.start + s.dur).toFixed(1)} sn${s.file ? '' : ' (tahmini; ses yok)'}`)
