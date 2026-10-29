import type { ContentStatus } from '../../api'

export const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: 'Taslak',
  published: 'Yayında',
  rejected: 'Reddedildi',
  withdrawn: 'Yayından çekildi',
}

export const CERTAINTY_LABEL: Record<string, string> = {
  documented: 'Belgelenmiş',
  reported: 'Rivayet',
  uncertain: 'Kesin değil',
}

export const CATEGORY_LABEL: Record<string, string> = {
  architecture: 'Mimari',
  restoration: 'Onarım',
  construction: 'Yapım',
  historical_event: 'Tarihî olay',
  historical_person: 'Tarihî kişi',
  function: 'İşlev',
  artistic_feature: 'Sanat özelliği',
  burial_practice: 'Defin',
  inscription: 'Kitabe',
  foundation_purpose: 'Vakıf amacı',
}

export const ORIGIN_LABEL = { pipeline: 'Hat (kitaptan aday)', manual: 'Elle' } as const
export const QUOTE_CHECK_LABEL = {
  found: 'Alıntı kaynak sayfada bulundu',
  not_found: 'Alıntı kaynak sayfada bulunamadı',
  no_quote: 'Alıntı yok',
} as const

export const label = (map: Record<string, string>, key: string) => map[key] ?? key

/** Taslağın ziyaretçiye görünmediğini her yerde aynı cümleyle söyler (CLAUDE.md §2.13). */
export const DRAFT_NOTE = 'Taslak: yönetici onaylayıp yayımlayana kadar ziyaretçilere görünmez.'

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
}
