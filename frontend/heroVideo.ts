import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync } from 'node:fs'
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
const MAX_BYTES = 25 * 1024 * 1024

export type VideoCheck = { ok: true; size: number } | { ok: false; reason: string }

/** Dosyanın gerçekten küçük bir MP4 olduğunu denetler (ISO BMFF `ftyp` kutusu). */
export function inspectHeroVideo(path: string): VideoCheck {
  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) return { ok: false, reason: 'dosya değil' }
    size = st.size
  } catch {
    return { ok: false, reason: 'bulunamadı' }
  }
  if (size < 12 || size > MAX_BYTES) return { ok: false, reason: `boyut uygun değil (${size} bayt)` }
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

function send(path: string, size: number, rangeHeader: string | undefined, method: string, res: ServerResponse) {
  res.setHeader('Content-Type', 'video/mp4')
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

export function heroVideoAsset(source = process.env.VAKIFNAME_HERO_VIDEO ?? DEFAULT_HERO_VIDEO): Plugin {
  let base = '/'
  return {
    name: 'vakifname-hero-video',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      const route = `${base.replace(/\/$/, '')}/${HERO_VIDEO_FILE}`
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (path !== route || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        const check = inspectHeroVideo(source)
        if (!check.ok) {
          server.config.logger.warn(`Giriş videosu sunulamadı (${check.reason}): ${source}`, { timestamp: true })
          res.statusCode = 404
          res.end()
          return
        }
        send(source, check.size, req.headers.range, req.method, res)
      })
    },
    generateBundle() {
      if (process.env.VITE_HERO_VIDEO_URL) return
      const check = inspectHeroVideo(source)
      if (!check.ok) {
        this.warn(`Giriş videosu derlemeye eklenmedi (${check.reason}): ${source}. Sayfa temsilî çizimle açılır.`)
        return
      }
      this.emitFile({ type: 'asset', fileName: HERO_VIDEO_FILE, source: readFileSync(source) })
    },
  }
}
