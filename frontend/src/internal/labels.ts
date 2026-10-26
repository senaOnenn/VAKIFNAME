/** Dahili durum kodlarının Türkçe etiketleri. Bilinmeyen kod olduğu gibi gösterilir; hiçbir durum gizlenmez. */
const LABELS: Record<string, string> = {
  // Editör / yayın / lisans
  pending: 'Editör incelemesi bekliyor',
  approved: 'Onaylı',
  blocked: 'Yayına kapalı',
  published: 'Yayında',
  not_checked: 'Lisans incelenmedi',
  // Konum
  missing: 'Koordinat yok',
  unverified: 'Koordinat doğrulanmadı',
  verified: 'Doğrulanmış konum',
  // Kaynak sayfa denetimi (fiziksel PDF sayfası)
  quote_found_on_page: 'Alıntı sayfada bulundu',
  quote_found_on_adjacent_page: 'Alıntı komşu sayfada',
  quote_not_found: 'Alıntı bulunamadı',
  no_direct_quote: 'Doğrudan alıntı yok',
  source_missing: 'Kaynak PDF yok',
  not_audited: 'Denetlenmedi',
}

const BLOCKERS: Record<string, string> = {
  editor_review_pending: 'Editör onayı',
  publication_blocked: 'Yayın onayı',
  license_review_pending: 'Lisans incelemesi',
  location_missing: 'Doğrulanmış koordinat',
  location_unverified: 'Koordinat doğrulaması',
  facts_not_approved: 'Olgu onayları',
  source_audit_incomplete: 'Kaynak sayfa denetimi',
  open_editorial_issues: 'Açık editoryal sorunlar',
}

export const statusLabel = (code: string) => LABELS[code] ?? code
export const blockerLabel = (code: string) => BLOCKERS[code] ?? code
