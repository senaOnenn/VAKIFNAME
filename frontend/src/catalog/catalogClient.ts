import { API_BASE_URL, ApiError, apiGet, apiPost, isPassport } from '../api/client'
import type { Passport } from '../api/types'
import type {
  AnswerResult, AskFact, AskIdentity, AskResult, AskSuggestion, MonumentCatalog, MonumentDetail, MonumentLocation, MonumentSummary, Quest,
  QuestProgress, SealBook,
} from './types'

const invalid = () => new ApiError('invalid-response', 'Sunucudan beklenmeyen bir yanıt geldi.')
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isString = (v: unknown): v is string => typeof v === 'string'

/**
 * Konum ya `null` ya da geçerli WGS84 koordinatıdır. Yarım koordinat veya 0,0 haritada yanlış nokta üreteceği için
 * yanıt bütünüyle reddedilir; eksik konum tahminle doldurulmaz.
 */
function isLocation(v: unknown): v is MonumentLocation | null {
  if (v === null) return true
  if (!isObject(v)) return false
  const { latitude: lat, longitude: lon, accuracy_m: acc } = v
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(lat === 0 && lon === 0) &&
    isFiniteNumber(acc) &&
    acc > 0
  )
}

function isSummary(v: unknown): v is MonumentSummary {
  return (
    isObject(v) &&
    isString(v.monument_id) &&
    /^[A-Z]{3}-\d{4}$/.test(v.monument_id) &&
    isString(v.name) &&
    isString(v.type) &&
    isString(v.city) &&
    isString(v.district) &&
    isString(v.address) &&
    'location' in v &&
    isLocation(v.location) &&
    typeof v.checkin_available === 'boolean' &&
    // Doğrulanmış harita konumu olmadan check-in açık görünemez.
    !(v.checkin_available && v.location === null) &&
    isFiniteNumber(v.fact_count) &&
    isFiniteNumber(v.game_fact_count) &&
    isFiniteNumber(v.image_count)
  )
}

export async function getMonuments(signal?: AbortSignal): Promise<MonumentCatalog> {
  const body = await apiGet('/monuments', signal)
  if (!isObject(body) || !Array.isArray(body.monuments) || !body.monuments.every(isSummary)) throw invalid()
  if (body.published_count !== body.monuments.length) throw invalid()
  return body as unknown as MonumentCatalog
}

export async function getMonument(monumentId: string, signal?: AbortSignal): Promise<MonumentDetail> {
  const body = await apiGet(`/monuments/${encodeURIComponent(monumentId)}`, signal)
  if (
    !isObject(body) ||
    body.monument_id !== monumentId ||
    !isString(body.name) ||
    !Array.isArray(body.facts) ||
    !Array.isArray(body.images) ||
    !('location' in body) ||
    !isLocation(body.location) ||
    (body.checkin_available === true && body.location === null)
  ) {
    throw invalid()
  }
  return body as unknown as MonumentDetail
}

/** Gerçek eser pasaportu (`/users/{id}/monument-passport`). Demo pasaportundan ayrı bir depodur. */
export async function getMonumentPassport(visitorId: string, signal?: AbortSignal): Promise<Passport> {
  const body = await apiGet(`/users/${encodeURIComponent(visitorId)}/monument-passport`, signal)
  if (!isPassport(body, visitorId)) throw invalid()
  return body
}

/** Yayınlanmış görsel dosyasının adresi (`/monuments/media/{sha256}.jpeg`). */
export const mediaUrl = (file: string) => `${API_BASE_URL}/monuments/media/${encodeURIComponent(file)}`

function isProgress(v: unknown): v is QuestProgress {
  return isObject(v) && isFiniteNumber(v.total) && isFiniteNumber(v.solved) && Array.isArray(v.solved_ids)
}

export async function getQuests(
  monumentId: string,
  visitorId: string,
  signal?: AbortSignal,
): Promise<{ quests: Quest[]; progress: QuestProgress }> {
  const body = await apiGet(
    `/monuments/${encodeURIComponent(monumentId)}/quests?user_id=${encodeURIComponent(visitorId)}`,
    signal,
  )
  if (!isObject(body) || !Array.isArray(body.quests) || !isProgress(body.progress)) throw invalid()
  const quests = body.quests as Quest[]
  if (!quests.every((q) => isString(q.quest_id) && isString(q.question) && Array.isArray(q.choices))) throw invalid()
  return { quests, progress: body.progress }
}

export async function answerQuest(monumentId: string, questId: string, visitorId: string, choiceIndex: number): Promise<AnswerResult> {
  const body = await apiPost(
    `/monuments/${encodeURIComponent(monumentId)}/quests/${encodeURIComponent(questId)}/answer`,
    { user_id: visitorId, choice_index: choiceIndex },
  )
  if (!isObject(body) || typeof body.correct !== 'boolean' || !isProgress(body.progress)) throw invalid()
  return body as unknown as AnswerResult
}

export async function getSeals(visitorId: string, signal?: AbortSignal): Promise<SealBook> {
  const body = await apiGet(`/users/${encodeURIComponent(visitorId)}/seals`, signal)
  if (!isObject(body) || !Array.isArray(body.knowledge_seals) || !Array.isArray(body.visit_seals) || !Array.isArray(body.monuments)) {
    throw invalid()
  }
  return body as unknown as SealBook
}

/** Pasaportu dinleyen bileşenlere ilerleme değişikliğini bildirir (yeni mühür, çözülen soru). */
export const PROGRESS_EVENT = 'vakifname:progress'
export const notifyProgress = () => window.dispatchEvent(new Event(PROGRESS_EVENT))

const ASK_STATUSES = new Set([
  'answered', 'clarification_required', 'not_found', 'monument_not_identified', 'monument_not_in_catalog',
  'current_info_unavailable', 'unavailable',
])

const isHttps = (v: unknown) => isString(v) && /^https:\/\//.test(v)

function isAskFact(v: unknown): v is AskFact {
  return (
    isObject(v) &&
    isString(v.fact_id) &&
    /^[A-Z]{3}-\d{4}-F\d{3}$/.test(v.fact_id) &&
    isString(v.text) &&
    isString(v.title) &&
    isString(v.monument_name) &&
    Array.isArray(v.sources) &&
    // Olgu cevabı en az bir bağımsız kaynak bağlantısı taşımalı; bağlantılar yalnızca https olabilir.
    v.sources.length > 0 &&
    v.sources.every((s) => isObject(s) && isHttps(s.url) && isString(s.title) && isString(s.publisher))
  )
}

export const isAskSuggestion = (v: unknown): v is AskSuggestion =>
  isObject(v) &&
  isString(v.question) &&
  isString(v.fact_id) &&
  /^[A-Z]{3}-\d{4}-F\d{3}$/.test(v.fact_id) &&
  isString(v.title) &&
  isString(v.monument_id) &&
  isString(v.monument_name)

const isAskIdentity = (v: unknown): v is AskIdentity =>
  isObject(v) && v.kind === 'identity' && isString(v.text) && isString(v.catalog_decision_id)

/** `POST /monuments/ask`: yalnızca yayın onaylı olgulardan cevap. Biçim veya kaynak eksikse yanıt reddedilir. */
export async function askMonument(question: string, monumentId: string | null, signal?: AbortSignal): Promise<AskResult> {
  const body = await apiPost('/monuments/ask', monumentId ? { question, monument_id: monumentId } : { question }, signal)
  if (
    !isObject(body) ||
    !isString(body.status) ||
    !ASK_STATUSES.has(body.status) ||
    !isString(body.message) ||
    body.answer_method !== 'approved_text_retrieval' ||
    !Array.isArray(body.options) ||
    !Array.isArray(body.related) ||
    !body.related.every(isAskFact) ||
    (body.suggestions !== undefined && !(Array.isArray(body.suggestions) && body.suggestions.every(isAskSuggestion)))
  ) {
    throw invalid()
  }
  if (body.status === 'answered' ? !(isAskFact(body.answer) || isAskIdentity(body.answer)) : body.answer !== null) throw invalid()
  return body as unknown as AskResult
}

export async function getAskSuggestions(monumentId: string, signal?: AbortSignal): Promise<string[]> {
  const body = await apiGet(`/monuments/${encodeURIComponent(monumentId)}/ask/suggestions`, signal)
  if (!isObject(body) || !Array.isArray(body.suggestions) || !body.suggestions.every(isString)) throw invalid()
  return body.suggestions
}
