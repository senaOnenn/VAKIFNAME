import { API_BASE_URL } from '../api/client'

/** Adres → sayılan sayfa türü ve (varsa) eser kimliği. Listede olmayan sayfalar sayılmaz (ör. /gizlilik). */
export function pageOf(pathname: string): { page: string; monument_id?: string } | null {
  if (pathname === '/') return { page: 'acilis' }
  const simple: Record<string, string> = { '/giris': 'giris', '/sehir': 'sehir', '/eserler': 'eserler', '/pasaport': 'pasaport', '/hesap': 'hesap' }
  if (simple[pathname]) return { page: simple[pathname] }
  if (pathname.startsWith('/rota/')) return { page: 'rota' }
  const m = /^\/eser\/([A-Z]{3}-\d{4})(\/rozet)?$/.exec(pathname)
  if (m) return { page: m[2] ? 'rozet' : 'eser', monument_id: m[1] }
  return null
}

/** Tarayıcıda "izleme" kapalıysa (Do Not Track / Global Privacy Control) hiçbir şey gönderilmez. */
function optedOut(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean }
  return n.doNotTrack === '1' || n.globalPrivacyControl === true
}

// Aynı sayfanın kısa sürede tekrar sayılmaması (React StrictMode geliştirmede etkileri iki kez çalıştırır).
let last = { path: '', at: 0 }
const REPEAT_MS = 1500

/** Anonim sayfa sayımı (çerez yok; bkz. backend/app/stats.py). Hata olursa sessizce yok sayılır. */
export function trackPage(pathname: string, now = Date.now()): void {
  const hit = pageOf(pathname)
  if (!hit || optedOut() || typeof fetch !== 'function') return
  if (last.path === pathname && now - last.at < REPEAT_MS) return
  last = { path: pathname, at: now }
  try {
    void fetch(`${API_BASE_URL}/stats/hit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hit),
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    /* yoksay */
  }
}
