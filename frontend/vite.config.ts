/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { DEFAULT_NARRATOR_VIDEO, NARRATOR_VIDEO_FILE, heroVideoAsset } from './heroVideo.ts'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Dahili inceleme sunucusu (backend/app/internal/server.py) yalnızca loopback üzerinde dinler. Yalıtılmış tarayıcı
 * testleri ayrı bir portu `VAKIFNAME_REVIEW_API_TARGET` ile seçer; hedef loopback dışında olamaz.
 */
function reviewApiTarget(): string {
  const value = process.env.VAKIFNAME_REVIEW_API_TARGET ?? 'http://127.0.0.1:8765'
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('VAKIFNAME_REVIEW_API_TARGET yalnızca http://127.0.0.1:<port> olabilir.')
  }
  return url.origin
}

/**
 * `/internal` isteklerini yalnızca bu makinedeki tarayıcılardan kabul eder. Geliştirme sunucusu `--host` ile ağa
 * açılsa bile proxy başka cihazlardan gelen istekleri dahili sunucuya iletmez. Eklentinin ara katmanı Vite'ın
 * kendi proxy'sinden önce çalışır.
 */
function internalLoopbackOnly(): Plugin {
  return {
    name: 'vakifname-internal-loopback-only',
    configureServer(server) {
      server.middlewares.use('/internal', (req, res, next) => {
        if (LOOPBACK.has(req.socket.remoteAddress ?? '')) return next()
        res.statusCode = 403
        res.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    internalLoopbackOnly(),
    heroVideoAsset(),
    heroVideoAsset(process.env.VAKIFNAME_NARRATOR_VIDEO ?? DEFAULT_NARRATOR_VIDEO, NARRATOR_VIDEO_FILE, 'Rehber videosu'),
  ],
  // Backend'in varsayılan CORS listesindeki port; preview de aynı portu kullanır.
  // `/internal` proxy'si yalnızca geliştirme sunucusunda vardır; `preview` ve üretim derlemesi dahili API'ye erişmez.
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/internal': { target: reviewApiTarget(), changeOrigin: false, xfwd: false } },
  },
  preview: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    // Testler yerel `.env`'den bağımsız: geliştiricinin Google istemci kimliği testlerin beklediği "kapalı" durumu bozmasın.
    env: { VITE_GOOGLE_CLIENT_ID: '' },
  },
})
