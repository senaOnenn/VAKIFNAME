import type { Lang } from './i18n'

/**
 * İçeriğin dili (Faz 11): İngilizce seçiliyken onaylı İngilizce alan varsa o kullanılır; yoksa Türkçe metin kalır ve
 * arayüz bunu "Türkçe" diye etiketler. Tarihî içerikte makine çevirisi yoktur (CLAUDE.md §2.12).
 */
export const nameOf = (m: { name: string; name_en?: string | null }, lang: Lang) =>
  lang === 'en' && m.name_en ? m.name_en : m.name

export interface Localized {
  title: string
  text: string
  page: number
  /** İngilizce seçili ama bu içeriğin onaylı İngilizcesi yok: Türkçe gösteriliyor. */
  turkishOnly: boolean
}

export function factIn(
  f: { title: string; text: string; title_en?: string | null; text_en?: string | null; en_page?: number | null; source: { pdf_physical_page: number } },
  lang: Lang,
): Localized {
  if (lang === 'en' && f.text_en && f.title_en) {
    return { title: f.title_en, text: f.text_en, page: f.en_page ?? f.source.pdf_physical_page, turkishOnly: false }
  }
  return { title: f.title, text: f.text, page: f.source.pdf_physical_page, turkishOnly: lang === 'en' }
}

export const textIn = (tr: string | null | undefined, en: string | null | undefined, lang: Lang) =>
  lang === 'en' && en ? { text: en, turkishOnly: false } : { text: tr ?? '', turkishOnly: lang === 'en' && !!tr }

/**
 * Görsel atfı ve kaynak satırındaki Türkçe etiketler ("Fotoğraf:", "Görsel:", "s.") İngilizcede çevrilir; ad, eser,
 * lisans ve kitap adı olduğu gibi kalır.
 */
export function creditIn(text: string, lang: Lang): string {
  if (lang !== 'en') return text
  return text
    .replace(/^Fotoğraf: /, 'Photo: ')
    .replace(/^Görsel: /, 'Image: ')
    .replace(/, s\. (\d+)$/, ', p. $1')
}
