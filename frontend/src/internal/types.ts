/** Dahili inceleme sunucusu (backend/app/internal/server.py) yanıtları. Genel API'de karşılıkları yoktur. */

export type LocationStatus = 'missing' | 'unverified' | 'verified'

/** backend `LocationRecord`: koordinat ve kaynağı. Yalnızca `verified` konum haritada kullanılabilir. */
export interface LocationRecord {
  status: LocationStatus
  latitude: number | null
  longitude: number | null
  source: string | null
  source_reference: string | null
  accuracy_m: number | null
  verified_by: string | null
  verified_at: string | null
  note: string | null
}

/** backend `ReviewStatus`. */
export interface ReviewStatus {
  editor_review: string
  publication_status: string
  license_review: string
  location_status: LocationStatus
  facts_total: number
  facts_publicly_usable: number
  facts_awaiting_editor: number
  facts_license_unchecked: number
  source_audit: Record<string, number>
  drafts_quarantined: number
  images_total: number
  images_publishable: number
  images_license_pending: number
  images_link_unverified: number
  open_issues: number
  public_release_blockers: string[]
  gates?: PublicationGates | null
}

export interface PublicationGates {
  catalog_identity: boolean
  facts_total: number
  facts_editor_approved: number
  facts_published: string[]
  facts_game_use: string[]
  images_total: number
  images_rights_recorded: number
  images_published: string[]
  images_game_use: string[]
  location_status: LocationStatus
  map_display: boolean
  gps_checkin: boolean
  public: boolean
}

export interface MonumentSummary {
  monument_id: string
  name: string
  city: string
  district: string
  type: string
  review_status: string
  publication_status: string
  license_review_status: string
  location: LocationRecord
  checkin_eligible: boolean
  map_eligible: boolean
  fact_count: number
  quarantined_draft_count: number
  image_count: number
  open_issue_ids: string[]
  source_files?: string[]
  review: ReviewStatus
}

export interface SourceReference {
  source_file: string
  pdf_physical_page: number
  pdf_physical_page_count: number
  pdf_page_kind: 'physical'
  evidence_quote: string
  evidence_status: string
  source_page_id: string
  page_audit: string
}

export interface FactAccess {
  publication_status: string
  editor_approval_required: boolean
  license_review_status: string
  public_answer_eligible: boolean
  game_eligible: boolean
}

export interface HistoricalFact {
  fact_id: string
  monument_id: string
  title: string
  text: string
  category: string
  certainty: string
  review_status: string
  open_issue_ids: string[]
  publicly_usable: boolean
  source: SourceReference
  access: FactAccess
}

export interface EditorialIssue {
  issue_id: string
  topic: string
  status: string
  related_fact_ids: string[]
  competing_years: number[]
  chosen_value: string | null
}

export interface MonumentDetail extends MonumentSummary {
  facts: HistoricalFact[]
  open_issues: EditorialIssue[]
}

export interface QuarantinedDraft {
  draft_id: string
  monument_id: string
  category: string
  statement: string
  source_file: string
  pdf_physical_page: number
  historical_verification: string
  page_audit: string
}

export interface InternalStatus {
  counts: { monuments: number; existing_historical_facts: number; unapproved_drafts: number; open_editorial_issues: number }
  images: number
  locations: Record<LocationStatus, number>
  publicly_usable_facts: number
  publishable_images: number
  public_access: boolean
}

// --- Editör inceleme iş akışı (/internal/review/...) ---------------------------------

export type SubjectKind = 'monument' | 'fact' | 'draft' | 'issue' | 'source' | 'image' | 'location'
export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'needs_revision'

export interface ReviewerInfo {
  reviewer_id: string
  display_name: string
  roles: string[]
}

export interface SessionInfo {
  authenticated: boolean
  session_ttl_s: number
  reviewer: ReviewerInfo | null
}

export interface DecisionRecord {
  decision_id: string
  decision_type: string
  decision: Exclude<DecisionStatus, 'pending'>
  source_check: string
  rationale: string
  payload: Record<string, unknown>
  reviewer_id: string
  reviewer_name: string
  reviewer_role: string
  reviewed_at: string
  data_version: string
  supersedes: string | null
  open_issue_ids: string[]
}

export interface DecisionState {
  status: DecisionStatus
  stale: boolean
  decision: DecisionRecord | null
  label: string
  role: string
  unmet_prerequisites: string[]
}

export interface ReviewSubject {
  subject_kind: SubjectKind
  subject_id: string
  content: Record<string, unknown>
  subject_sha256: string
  decisions: Record<string, DecisionState>
  history: DecisionRecord[]
}

export interface ReviewTicket {
  ticket_id: string
  decision_type: string
  subject_sha256: string
  supersedes: string | null
  min_review_seconds: number
  unmet_prerequisites: string[]
}

export interface ReviewOverview {
  data_version: string
  decision_types: Record<string, { label: string; role: string; subject_kind: SubjectKind }>
  counts: Record<string, Record<DecisionStatus | 'stale', number>>
  subjects: Record<string, number>
  issues: (EditorialIssue & { resolution: { status: DecisionStatus; stale: boolean } })[]
  reviewers: number
  identity_policy: string
  rag_public_release: { status: string; reasons: string[] }
}

export interface ResearchSource {
  source_id: string
  kind: string
  publisher: string
  title: string
  url: string | null
  pdf_file: string | null
  pdf_physical_page: number | null
  supports: string[]
  summary: string
}

export interface CoordinateCandidate {
  candidate_id: string
  latitude: number
  longitude: number
  crs: string
  source_id: string
  source_object: string
  represents: string
  estimated_accuracy_m: number
  collection_method: string
  collected_by: string
  collected_at: string
  status: string
  notes: string | null
}

export interface MonumentResearch {
  monument_id: string
  full_name: string
  alternative_names: string[]
  address_claims: { value: string; source_id: string }[]
  sources: ResearchSource[]
  discrepancies: { discrepancy_id: string; topic: string; description: string; source_ids: string[] }[]
  location_candidates: CoordinateCandidate[]
  site_context: { active_place_of_worship: boolean | null; burial_site: boolean | null; access_notes: string }
  vgm_search: string
}

export interface ResearchResponse {
  monument_id: string
  research: MonumentResearch | null
  method: string
  attribution: string
}

export interface ImageRecord {
  image_id: string
  monument_id: string
  relative_path: string
  license_status: string
  publication_status: string
  monument_link_status: string
}

export interface AuditResponse {
  entries: { seq: number; at: string; actor: string; action: string; subject: string }[]
  verification: { valid: boolean; entries: number; decisions?: number }
}

export interface LocationCandidateRow {
  monument_id: string
  monument_name: string
  candidate_id: string
  latitude: number
  longitude: number
  represents: string
  estimated_accuracy_m: number
  source_id: string
  source_kind: string
  source_object: string
  status: string
  monument_location_status: LocationStatus
  notes: string | null
  other_candidates: { candidate_id: string; distance_m: number }[]
  nearest_other_monument: { monument_id: string; candidate_id: string; distance_m: number } | null
  competing_discrepancy_ids: string[]
  flags: string[]
  checkin_entry_point: null
}

export interface LocationCandidatesResponse {
  candidates: LocationCandidateRow[]
  flag_labels: Record<string, string>
  monuments_with_candidates: number
  verified: number
  entry_points_available: number
  attribution: string
}

// --- Toplu inceleme (GET /internal/review/batch) --------------------------------------

export interface BatchEvidence {
  label: string
  url: string | null
  text: string | null
}

export interface BatchBlocker {
  code: string
  text: string
  resolved_in_batch: boolean
}

export type BatchDecision = 'approved' | 'rejected' | 'needs_revision'

export interface BatchItem {
  key: string
  decision_type: string
  subject_id: string
  monument_id: string | null
  title: string
  label: string
  role: string
  status: 'pending' | 'approved' | 'rejected' | 'needs_revision'
  stale: boolean
  done: boolean
  allowed: boolean
  recommended: boolean
  default_decision?: BatchDecision | null
  verdict?: string
  payload: Record<string, unknown>
  source_check: string
  source_check_required: boolean
  evidence: BatchEvidence[]
  notes: string | null
  preview_url?: string | null
  /** Saklanan dosyanın dahili önizleme yolu (oturumla alınır). */
  media_url?: string | null
  image_facts?: ImageFacts | null
  revision?: BatchRevision | null
  unmet_prerequisites: string[]
  blockers: BatchBlocker[]
  depends_on: string[]
}

/** "Düzeltme gerekli" kararına verilen yanıt; `open` yanıtlanan karar hâlâ en son karar mı? */
export interface BatchRevision {
  addresses_decision_id: string
  revised_at: string
  changes: string[]
  removed_details: string[]
  pending_evidence: string[]
  open: boolean
}

export interface BatchStage {
  decision_type: string
  label: string
  role: string
  items: BatchItem[]
  counts: { total: number; done: number }
}

export interface BatchListing {
  stages: BatchStage[]
  reviewer_roles: string[]
  max_items: number
  seconds_per_item: number
  excluded: string[]
}

export interface BatchTicket {
  ticket_id: string
  keys: string[]
  min_review_seconds: number
  expires_in_s: number
}

export interface BatchSubmitItem {
  key: string
  decision: BatchDecision
  source_check?: string
  note?: string
  payload?: Record<string, unknown>
}

export interface BatchResult {
  results: { key: string; ok: boolean; decision_id?: string; decision?: string; code?: string; message?: string }[]
  recorded: number
  failed: number
  publication?: { published: boolean; monuments?: number; facts?: number; images?: number; reason?: string } | null
}

/** Fotoğraf künyesi: inceleme ekranında gösterilir; karar içeriği değildir. Masa başı alanlar onay sayılmaz. */
export interface ImageFacts {
  candidate_batch: string | null
  monument_name: string | null
  file_page_url: string | null
  artist: string | null
  credit: string | null
  license_short_name: string | null
  license_url: string | null
  license_obligations: string | null
  attribution: string | null
  stored_size: [number, number]
  original_size: [number | null, number | null]
  date: string | null
  angle_classes: string[]
  people: number | null
  sign_or_text: number | null
  confusion_risk: string | null
  doubts: string[]
  reviewed_by: string | null
}

/** Dahili galeri önizlemesindeki fotoğraf. Dosyalar yalnızca yetkili oturumla alınır. */
export interface GalleryPreviewItem {
  image_id: string
  folder_monument_id: string
  card_url: string
  detail_url: string
  width: number
  height: number
  caption: string | null
  source: string
  source_url: string | null
  quality: { short_side_px: number; resolution: 'dusuk' | 'orta' | 'iyi'; note?: string } | null
  rights: Record<'image_rights' | 'image_publication' | 'image_reference_index', string>
  publishable: boolean
}

export interface GalleryPreview {
  monument_id: string
  name: string
  public: false
  sections: Record<'published' | 'commons_candidates' | 'zip_gallery' | 'zip_review' | 'zip_proposed_here', GalleryPreviewItem[]>
  zip_rights: { license_status: string; allowed_now: string; finding: string; required_for_publication: string } | null
}
