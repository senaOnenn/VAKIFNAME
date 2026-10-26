/**
 * Uygulamanın üç deneyimi:
 * - `katalog` (varsayılan ve üretimde tek mod): genel platform. Yalnızca yayın onaylı gerçek eserler (`GET /monuments`).
 * - `demo`: Demo Keşif Oyunu. Kurgusal test mekânları; yalnızca geliştirme sunucusunda ve otomatik testlerde.
 * - `envanter`: Gerçek Bursa Envanteri. Dahili, erişim kontrollü inceleme ekranı; yalnızca geliştirme sunucusunda.
 *
 * Üretim derlemesinde `import.meta.env.DEV` sabit `false` olur: demo ve envanter pakete girmez, `?mod=demo` ve
 * `?mod=envanter` yok sayılır. Asıl erişim kontrolü dahili sunucudadır; bu bayrak yalnızca arayüzü gizler.
 */
export type AppMode = 'katalog' | 'demo' | 'envanter'

export const MODE_PARAM = 'mod'
export const INVENTORY_AVAILABLE = import.meta.env.DEV
export const DEMO_AVAILABLE = import.meta.env.DEV

export function readMode(): AppMode {
  const requested = new URLSearchParams(window.location.search).get(MODE_PARAM)
  if (requested === 'envanter' && INVENTORY_AVAILABLE) return 'envanter'
  if (requested === 'demo' && DEMO_AVAILABLE) return 'demo'
  return 'katalog'
}
