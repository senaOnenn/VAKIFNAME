import { createHash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * Ana sayfa giriş videosunun kontrollü dağıtımı. Video depoda tutulmaz (`.gitignore`); sunucudaki tek bir dosyadan
 * okunur. Yol `VAKIFNAME_HERO_VIDEO` ile değiştirilebilir; varsayılan depo kardeş dizinidir
 * (`../vakifname-video-assets/hero.mp4`).
 *
 * - Geliştirme sunucusu: yalnızca `<base>media/hero.mp4` rotası bu dosyayı sunar (Range destekli; başka dosya sunulmaz).
 * - Üretim derlemesi: dosya doğrulanıp `dist/media/hero.mp4` olarak kopyalanır; statik sunucu (nginx, `vite preview`)
 *   onu aynı adresten verir. Dosya yoksa derleme uyarı verir, sayfa temsilî çizimle açılır.
 * - `VITE_HERO_VIDEO_URL` (ör. CDN) verilmişse dosya derlemeye kopyalanmaz.
 */

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_HERO_VIDEO = resolve(here, '..', '..', 'vakifname-video-assets', 'hero.mp4')
export const HERO_VIDEO_FILE = 'media/hero.mp4'
/** Telefonlar için dikey, küçük sürüm (30 Ekim: yavaş ağda 2,3 MB yerine ~200 KB; ffmpeg ile ortadan 9:16 kesit, sessiz). */
export const DEFAULT_HERO_MOBILE_VIDEO = resolve(here, '..', '..', 'vakifname-video-assets', 'hero-mobil.mp4')
export const HERO_MOBILE_VIDEO_FILE = 'media/hero-mobil.mp4'
const MAX_BYTES = 25 * 1024 * 1024
/** Tanıtım filmi (Faz 9, `film/tools/render.sh` çıktısı): web sürümü ve iki altyazı. Varsayılan klasör depo kardeşi. */
export const DEFAULT_FILM_DIR = resolve(here, '..', '..', 'vakifname-video-assets', 'film')
export const FILM_ASSETS = [
  { name: 'tanitim-web.mp4', file: 'media/tanitim.mp4', type: 'video/mp4' },
  { name: 'tanitim-tr.vtt', file: 'media/tanitim-tr.vtt', type: 'text/vtt; charset=utf-8' },
  { name: 'tanitim-en.vtt', file: 'media/tanitim-en.vtt', type: 'text/vtt; charset=utf-8' },
] as const
const MAX_FILM_BYTES = 80 * 1024 * 1024
const MAX_VTT_BYTES = 64 * 1024

export type VideoCheck = { ok: true; size: number } | { ok: false; reason: string }

/** Dosyanın gerçekten küçük bir MP4 olduğunu denetler (ISO BMFF `ftyp` kutusu). */
export function inspectHeroVideo(path: string, maxBytes = MAX_BYTES): VideoCheck {
  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) return { ok: false, reason: 'dosya değil' }
    size = st.size
  } catch {
    return { ok: false, reason: 'bulunamadı' }
  }
  if (size < 12 || size > maxBytes) return { ok: false, reason: `boyut uygun değil (${size} bayt)` }
  const head = Buffer.alloc(12)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, head, 0, 12, 0)
  } finally {
    closeSync(fd)
  }
  if (head.toString('latin1', 4, 8) !== 'ftyp') return { ok: false, reason: 'MP4 değil' }
  return { ok: true, size }
}

/** Altyazı dosyası: küçük ve "WEBVTT" ile başlayan metin. */
export function inspectVtt(path: string): VideoCheck {
  try {
    const st = statSync(path)
    if (!st.isFile()) return { ok: false, reason: 'dosya değil' }
    if (st.size > MAX_VTT_BYTES) return { ok: false, reason: `boyut uygun değil (${st.size} bayt)` }
    if (!readFileSync(path, 'utf8').startsWith('WEBVTT')) return { ok: false, reason: 'WebVTT değil' }
    return { ok: true, size: st.size }
  } catch {
    return { ok: false, reason: 'bulunamadı' }
  }
}

/** `Range: bytes=a-b` başlığı. Geçersiz veya çoklu aralıkta `invalid`, başlık yoksa `null`. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  let start: number
  let end: number
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return 'invalid'
  return { start, end }
}

function send(path: string, size: number, rangeHeader: string | undefined, method: string, res: ServerResponse, type = 'video/mp4') {
  res.setHeader('Content-Type', type)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const range = parseRange(rangeHeader, size)
  if (range === 'invalid') {
    res.statusCode = 416
    res.setHeader('Content-Range', `bytes */${size}`)
    res.end()
    return
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  res.statusCode = range ? 206 : 200
  if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  res.setHeader('Content-Length', String(end - start + 1))
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(path, { start, end }).pipe(res)
}

export function heroVideoAsset(
  source = process.env.VAKIFNAME_HERO_VIDEO ?? DEFAULT_HERO_VIDEO,
  file = HERO_VIDEO_FILE,
  label = 'Giriş videosu',
): Plugin {
  let base = '/'
  return {
    name: file === HERO_VIDEO_FILE ? 'vakifname-hero-video' : `vakifname-video:${file}`,
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      const route = `${base.replace(/\/$/, '')}/${file}`
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (path !== route || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        const check = inspectHeroVideo(source)
        if (!check.ok) {
          server.config.logger.warn(`${label} sunulamadı (${check.reason}): ${source}`, { timestamp: true })
          res.statusCode = 404
          res.end()
          return
        }
        send(source, check.size, req.headers.range, req.method, res)
      })
    },
    generateBundle() {
      if (file === HERO_VIDEO_FILE && process.env.VITE_HERO_VIDEO_URL) return
      const check = inspectHeroVideo(source)
      if (!check.ok) {
        this.warn(`${label} derlemeye eklenmedi (${check.reason}): ${source}. Sayfa temsilî çizimle açılır.`)
        return
      }
      this.emitFile({ type: 'asset', fileName: file, source: readFileSync(source) })
    },
  }
}

/**
 * Tanıtım filmi: üç dosya birlikte (film + TR/EN altyazı). Biri eksik ya da geçersizse hiçbiri derlemeye girmez ve
 * tanıtım sayfasındaki "Tanıtım filmini izle" düğmesi görünmez (sayfa dosyanın varlığını sorar).
 */
export function filmAssets(dir = process.env.VAKIFNAME_FILM_DIR ?? DEFAULT_FILM_DIR): Plugin {
  let base = '/'
  const check = (a: (typeof FILM_ASSETS)[number]) =>
    a.type === 'video/mp4' ? inspectHeroVideo(resolve(dir, a.name), MAX_FILM_BYTES) : inspectVtt(resolve(dir, a.name))
  return {
    name: 'vakifname-film',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        const asset = FILM_ASSETS.find((a) => path === `${base.replace(/\/$/, '')}/${a.file}`)
        if (!asset || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        const c = check(asset)
        if (!c.ok) {
          res.statusCode = 404
          res.end()
          return
        }
        send(resolve(dir, asset.name), c.size, req.headers.range, req.method, res, asset.type)
      })
    },
    generateBundle() {
      const bad = FILM_ASSETS.map((a) => [a, check(a)] as const).filter(([, c]) => !c.ok)
      if (bad.length) {
        this.warn(`Tanıtım filmi derlemeye eklenmedi (${bad.map(([a, c]) => `${a.name}: ${(c as { reason: string }).reason}`).join(', ')}): ${dir}`)
        return
      }
      for (const a of FILM_ASSETS) this.emitFile({ type: 'asset', fileName: a.file, source: readFileSync(resolve(dir, a.name)) })
    },
  }
}

/**
 * Medya sürümü: tanıtım videoları ve filmin içeriğinden kısa özet. Adreslere `?v=` olarak eklenir; dosya adları sabit
 * olduğu için önbellek (Cloudflare, 1 gün) yeni dosyayı ancak adres değişince alır. İçerik aynıysa sürüm de aynı kalır.
 */
export function mediaVersion(paths: string[]): string {
  const h = createHash('sha1')
  for (const p of paths) if (existsSync(p) && statSync(p).isFile()) h.update(readFileSync(p))
  return h.digest('hex').slice(0, 10)
}

/**
 * Ana sayfa hikâyesinin 7 sahne görseli: `scripts/landing-art.sh` çıktısı, depo kardeşi
 * `../vakifname-assets/story-v2/web/` (veya `VAKIFNAME_LANDING_ART_DIR`). Depoya girmez. Yalnızca bu listedeki dosyalar
 * `<base>media/sahne/<ad>` adresinden sunulur ve derlemeye kopyalanır. Biri eksikse sayfa o katmanı gece zeminiyle
 * gösterir (görsel olmadan da okunur). Genişlikler özgün dosyanınkidir (büyütme yok): sahne 1 1680 px, diğerleri 1920 px.
 */
export const DEFAULT_LANDING_ART_DIR = resolve(here, '..', '..', 'vakifname-assets', 'story-v2', 'web')
export const SCENE_WIDTHS = [1680, 1920, 1920, 1920, 1920, 1920, 1920] as const
export const LANDING_ART = SCENE_WIDTHS.flatMap((w, i) => [`scene-${i + 1}-1280.webp`, `scene-${i + 1}-${w}.webp`])
const MAX_ART_BYTES = 2 * 1024 * 1024

/** Dosyanın küçük bir WebP olduğunu denetler (`RIFF....WEBP`). */
export function inspectWebp(path: string): VideoCheck {
  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) return { ok: false, reason: 'dosya değil' }
    size = st.size
  } catch {
    return { ok: false, reason: 'bulunamadı' }
  }
  if (size < 16 || size > MAX_ART_BYTES) return { ok: false, reason: `boyut uygun değil (${size} bayt)` }
  const head = Buffer.alloc(12)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, head, 0, 12, 0)
  } finally {
    closeSync(fd)
  }
  if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WEBP') return { ok: false, reason: 'WebP değil' }
  return { ok: true, size }
}

export function landingArt(dir = process.env.VAKIFNAME_LANDING_ART_DIR ?? DEFAULT_LANDING_ART_DIR): Plugin {
  let base = '/'
  return {
    name: 'vakifname-landing-art',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      const prefix = `${base.replace(/\/$/, '')}/media/sahne/`
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (!path.startsWith(prefix) || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        const name = path.slice(prefix.length)
        const c = LANDING_ART.includes(name) ? inspectWebp(resolve(dir, name)) : ({ ok: false, reason: 'listede yok' } as const)
        if (!c.ok) {
          res.statusCode = 404
          res.end()
          return
        }
        send(resolve(dir, name), c.size, req.headers.range, req.method, res, 'image/webp')
      })
    },
    generateBundle() {
      const bad = LANDING_ART.filter((n) => !inspectWebp(resolve(dir, n)).ok)
      if (bad.length) this.warn(`Ana sayfa illüstrasyonlarından ${bad.length} tanesi derlemeye eklenmedi (${bad.slice(0, 3).join(', ')}…): ${dir}`)
      for (const n of LANDING_ART) if (!bad.includes(n)) this.emitFile({ type: 'asset', fileName: `media/sahne/${n}`, source: readFileSync(resolve(dir, n)) })
    },
  }
}
