/**
 * Uygulamanın iki deneyimi:
 * - `katalog` (varsayılan ve üretimde tek mod): genel platform (yeni VAKIFNAME arayüzü).
 * - `envanter`: dahili, erişim kontrollü inceleme ekranı; yalnızca geliştirme sunucusunda.
 *
 * Üretim derlemesinde `import.meta.env.DEV` sabit `false` olur: envanter pakete girmez, `?mod=envanter` yok sayılır.
 * Asıl erişim kontrolü dahili sunucudadır; bu bayrak yalnızca arayüzü gizler.
 */
export type AppMode = 'katalog' | 'envanter'

export const MODE_PARAM = 'mod'
export const INVENTORY_AVAILABLE = import.meta.env.DEV

export function readMode(): AppMode {
  const requested = new URLSearchParams(window.location.search).get(MODE_PARAM)
  return requested === 'envanter' && INVENTORY_AVAILABLE ? 'envanter' : 'katalog'
}
