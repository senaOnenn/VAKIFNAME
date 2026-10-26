/**
 * Genel gerçek eser kataloğu (`GET /monuments`, backend/app/public_catalog.py). Yalnızca yayın onaylı kayıtlar gelir.
 * Konumu doğrulanmamış veya haritada gösterilmesi onaylanmamış eserde `location` `null`'dır.
 */
export interface MonumentLocation {
  latitude: number
  longitude: number
  accuracy_m: number
}

export interface MonumentCover {
  file: string
  attribution: string | null
  license: string
  title: string | null
  source_url: string | null
}

export interface MonumentSummary {
  monument_id: string
  name: string
  alternative_names?: string[]
  type: string
  city: string
  district: string
  address: string
  location: MonumentLocation | null
  checkin_available: boolean
  fact_count: number
  game_fact_count: number
  quest_count?: number
  image_count: number
  cover?: MonumentCover | null
  lead?: string | null
  illustration: 'representative_drawing'
}

export interface MonumentCatalog {
  published_count: number
  data_version: string | null
  generated_at: string | null
  monuments: MonumentSummary[]
}

export interface MonumentFact {
  fact_id: string
  title: string
  text: string
  category: string
  certainty: string
  source: { title: string; pdf_physical_page: number; page_kind: 'physical' }
  game_use: boolean
  basis?: 'licensed_source' | 'independent_corroboration'
  sources?: { title: string; publisher: string; url: string }[]
  has_quest?: boolean
}

export interface MonumentImage {
  image_id: string
  file: string
  rights_holder: string
  license: string
  attribution: string | null
  game_use: boolean
  card_file?: string | null
  title?: string | null
  license_url?: string | null
  source_url?: string | null
  width?: number | null
  height?: number | null
  /** Kaynak adı ("Wikimedia Commons", "Vakıf Katılım — Bursa Vakıf Eserleri Envanteri"); eski kayıtlarda yok. */
  source_label?: string | null
}

/** Proje arşivindeki fotoğraf: `archive_folder` arşivdeki sınıflandırmadır, doğrulanmış eser kimliği değildir. */
export interface ArchiveImage {
  image_id: string
  file: string
  card_file?: string | null
  width: number
  height: number
  archive_folder: string
  identity: 'celiski_yok' | 'belgelenmis_celiski'
  /** Kimlik çelişkisi açıklaması (çelişkili fotoğrafta her zaman var). */
  identity_note?: string | null
}

/** Eser sayfasındaki ek arşiv koleksiyonu; lisans ve hak sahibi bilgisi taşımaz. */
export interface ArchiveCollection {
  collection_id: string
  source_label: string
  note: string
  images: ArchiveImage[]
}

/** Keşif sorusu; doğru cevap istemciye gönderilmez. */
export interface Quest {
  quest_id: string
  fact_title: string
  question: string
  choices: string[]
}

export interface QuestProgress {
  total: number
  solved: number
  solved_ids: string[]
}

export interface Seal {
  user_id: string
  monument_id: string
  kind: 'knowledge' | 'visit'
  monument_name: string
  earned_at: string
}

export interface AnswerResult {
  correct: boolean
  already_solved: boolean
  explanation: string | null
  fact: { title: string; text: string } | null
  progress: QuestProgress
  knowledge_seal: (Seal & { new: boolean }) | null
}

export interface SealBook {
  user_id: string
  knowledge_seals: Seal[]
  visit_seals: Seal[]
  monuments: { monument_id: string; name: string; quests: number; solved: number; checkin_available: boolean }[]
}

export interface MonumentDetail {
  monument_id: string
  name: string
  alternative_names: string[]
  type: string
  city: string
  district: string
  address: string
  facts: MonumentFact[]
  images: MonumentImage[]
  /** Proje arşivi koleksiyonu (yoksa `null`; eski API yanıtlarında alan yok). */
  archive_collection?: ArchiveCollection | null
  location: (MonumentLocation & { represents: string }) | null
  checkin_available: boolean
  checkin: { radius_m: number; point_kind: string; access_hours_note: string; safety_note: string } | null
  site_notice: string | null
  quests?: Quest[]
  illustration: 'representative_drawing'
}

/** Esere Sor: cevabın dayandığı yayımlanmış olgu (metin katalogdakiyle aynıdır). */
export interface AskFact {
  fact_id: string
  monument_id: string
  monument_name: string
  title: string
  text: string
  category: string
  certainty: string
  certainty_label: string
  sources: { title: string; publisher: string; url: string }[]
  publication_decision_id: string
}

/** Eserin onaylı kimlik kaydından adres cevabı. */
export interface AskIdentity {
  kind: 'identity'
  monument_id: string
  monument_name: string
  title: string
  text: string
  certainty_label: string
  sources: []
  catalog_decision_id: string
  map: { latitude: number; longitude: number } | null
}

export type AskStatus =
  | 'answered'
  | 'clarification_required'
  | 'not_found'
  | 'monument_not_identified'
  | 'monument_not_in_catalog'
  | 'current_info_unavailable'
  | 'unavailable'

export interface AskResult {
  question: string
  status: AskStatus
  message: string
  monument: { monument_id: string; name: string } | null
  answer: AskFact | AskIdentity | null
  related: AskFact[]
  options: { monument_id: string; name: string }[]
  answer_method: 'approved_text_retrieval'
  retrieval: 'hybrid' | 'lexical'
  notice: string
  site_notice?: string
  /** Yanıt uygunluğu denetleyicisinin kararı: olgu soruyu doğrudan yanıtlıyor mu? */
  verification?: AskVerification
  /** Yazım düzeltmesiyle anlaşılan soru (okunur biçim); düzeltme yoksa yok. */
  interpreted_question?: string | null
  /** Düzeltme zayıfken "bunu mu demek istediniz?" önerisi: olgu cevap olarak gösterilmez, yalnızca adıyla anılır. */
  suggestions?: AskSuggestion[]
}

export interface AskSuggestion {
  question: string
  fact_id: string
  title: string
  monument_id: string
  monument_name: string
}

export interface AskVerification {
  answerable: boolean
  selected_fact_id: string | null
  confidence: number
  reason: string
  method: string
}

/** Yapay zekâ rehberi (`POST /guide/ask`): cümle başına onaylı kayıt kimliği taşıyan, backend'de denetlenmiş cevap. */
export type GuideStatus =
  | 'answered'
  | 'insufficient_evidence'
  | 'clarification_required'
  | 'monument_not_identified'
  | 'photo_not_matched'
  | 'photo_analysis_failed'
  | 'monument_not_in_catalog'
  | 'not_found'
  | 'current_info_unavailable'
  | 'unavailable'

export interface GuideSentence {
  text: string
  /** Onaylı kayıt kimlikleri; `FOTOGRAF` yalnızca fotoğrafta görülen özelliği anlatan cümlelerde. */
  sources: string[]
}

export interface GuidePhoto {
  is_architecture: boolean
  /** Katalogdan bağımsız gözlem: görülen yapı türü (cami, han, türbe…, "belirsiz"). */
  building_type?: string
  description: string
  features: string[]
  /** Görünen mimari öğelerin genel açıklaması (tarih, ad, malzeme yok); "Görseldeki mimariyi açıkla" ile gösterilir. */
  architecture_explanation?: string
  /** Malzemeye dair çekinceli görsel izlenim; tarihî kaynak bilgisi değildir. */
  material_guess?: string
  visible_text: string
  identity?: { identifiable: 'yes' | 'no' | 'uncertain'; reason: string }
  /** Olası yapay üretim/kurgu işaretleri; kesin yargı değildir. */
  synthetic_signs?: string[]
  /** Yalnızca güvenilir (yüksek) katalog eşleşmeleri. */
  candidates: { monument_id: string; name: string; likelihood: 'high' | 'medium' | 'low' }[]
  metadata_removed: string[]
}

export type GuideAction =
  | 'explain_architecture'
  | 'upload_another'
  | 'choose_manually'
  | 'retry_photo'
  | 'ask_without_photo'

export interface GuideResult {
  question: string
  mode: 'generative' | 'fallback_search'
  status: GuideStatus
  message: string
  sentences: GuideSentence[]
  facts: AskFact[]
  identities: { id: string; monument_id: string; name: string }[]
  missing: string
  removed_claims: number
  monument: { monument_id: string; name: string } | null
  monuments: { monument_id: string; name: string }[]
  options: { monument_id: string; name: string }[]
  /** Ziyaretçinin kendi seçimi için bütün eserler (tarafsız katalog sırası; öneri değildir). */
  manual_options?: { monument_id: string; name: string }[]
  actions?: GuideAction[]
  photo: GuidePhoto | null
  /** Yapay zekâ çalışmadığında mevcut kaynaklı aramanın cevabı. */
  search: AskResult | null
  fallback_reason: string | null
  notice: string
  usage: { calls: number; prompt_tokens: number; completion_tokens: number; total_ms: number }
}

export interface GuideAvailability {
  enabled: boolean
  /** Rehber yalnızca test kullanıcılarına açık: arayüz test anahtarı formunu gösterebilir. */
  tester_login?: boolean
  configured?: boolean
  photo?: boolean
  max_image_mb?: number
  /** Bugün kalan yapay zekâ çağrısı (fotoğraflı soru 2 çağrı harcar). */
  remaining_today?: number
  circuit_open?: boolean
  /** Sunucunun bir soru için en uzun bekleme süresi; dolunca kaynaklı arama cevabı döner. */
  deadline_s?: number
  /** Ziyaretçi test oturumuyla giriş yapmış. */
  tester?: boolean
}
