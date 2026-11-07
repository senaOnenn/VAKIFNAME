import type { Lang } from './i18n'

/**
 * R3.4 Tarih Defteri: kaydın kaynak başlığını "Kaynak" ve "Yayın" satırlarına ayırır. Yalnızca katalogdaki alanlar
 * kullanılır; parça yoksa `null` döner (uydurulmaz, arayüz eksikliği açıkça yazar).
 *
 * Katalogdaki biçim: "Bursa Vakıf Eserleri / Foundation Buildings of Bursa, Cilt I (Nisan 2026)" + ayrı sayfa numarası.
 * - Ad: "Cilt" öncesi; iki dilli ad " / " ile ayrılmışsa Türkçede ilk, İngilizcede ikinci kısım.
 * - Cilt: "Cilt I"; baskı: parantez içi ("Nisan 2026").
 */
export interface SourceRef {
  name: string | null
  volume: string | null
  edition: string | null
  page: number | null
}

const VOLUME = /^(.*?),\s*Cilt\s+([IVXLCDM]+|\d+)\s*(?:\(([^)]*)\))?\s*$/i

export function sourceRef(title: string | null | undefined, page: number | null | undefined, lang: Lang): SourceRef {
  const raw = (title ?? '').trim()
  const m = raw.match(VOLUME)
  const full = (m ? m[1] : raw).trim()
  const [tr, en] = full.split(' / ').map((s) => s.trim())
  const name = (lang === 'en' && en ? en : tr) || null
  return {
    name,
    volume: m ? m[2].toUpperCase() : null,
    edition: m && m[3] ? m[3].trim() : null,
    page: typeof page === 'number' && page > 0 ? page : null,
  }
}
