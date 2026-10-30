import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL, apiGet, apiPost, apiUpload } from '../api/client'
import { getLang, t as tr } from './i18n'
import { getVisitorId } from '../visitor'
import type { AuthState } from './session'

export { getMonument, getMonuments, mediaUrl } from '../catalog/catalogClient'
export type { MonumentDetail, MonumentSummary, MonumentFact, MonumentImage } from '../catalog/types'

/** İlerleme kimliği: hesap varsa hesap kimliği (çerezle korunur), yoksa bu tarayıcının misafir kimliği. */
export function progressId(auth: AuthState): string {
  return auth.status === 'user' ? auth.user.user_id : getVisitorId()
}

const WITH_COOKIE = { credentials: 'include' as const }

// --- Rota (GET /route): sözleşme backend/app/route_routes.py ile aynıdır ---------------------------------------------
export type StopState = 'unlocked' | 'locked'
export interface RouteStop {
  monument_id: string
  name: string
  type: string
  latitude: number
  longitude: number
  state: StopState
  distance_m: number
  order: number
}
export interface CompletedStop {
  monument_id: string
  name: string
  earned_at: string
  /** Ziyaret mührü de varsa mühür altındır. */
  visit: boolean
}
export interface RouteResult {
  city: string
  total: number
  completed_count: number
  start: { source: 'user' | 'last_completed' | 'city_center'; latitude: number; longitude: number }
  next: string | null
  stops: RouteStop[]
  completed: CompletedStop[]
}

const isRoute = (v: unknown): v is RouteResult =>
  !!v && typeof v === 'object' && Array.isArray((v as RouteResult).stops) && Array.isArray((v as RouteResult).completed)

export async function getRoute(
  city: string,
  userId: string,
  pos?: { latitude: number; longitude: number } | null,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const q = new URLSearchParams({ city, user_id: userId })
  if (pos) {
    q.set('lat', pos.latitude.toFixed(6))
    q.set('lng', pos.longitude.toFixed(6))
  }
  const body = await apiGet(`/route?${q}`, signal, WITH_COOKIE)
  if (!isRoute(body)) throw new Error(tr('Rota yanıtı beklenen biçimde değil.'))
  return body
}

/** Eser kimliği → kilit/tamamlanma durumu (rota yüklenemezse boş). */
export type MonumentStatus = 'completed' | 'gold' | StopState
export function statusMap(route: RouteResult | null): Record<string, MonumentStatus> {
  const out: Record<string, MonumentStatus> = {}
  if (!route) return out
  for (const s of route.stops) out[s.monument_id] = s.state
  for (const c of route.completed) out[c.monument_id] = c.visit ? 'gold' : 'completed'
  return out
}

// --- Küçük veri yükleme kancası ------------------------------------------------------------------------------------
export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** `load` her `deps` değişiminde çağrılır; önceki istek iptal edilir. */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  const fn = useRef(load)
  fn.current = load
  useEffect(() => {
    const ctl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    fn.current(ctl.signal).then(
      (data) => !ctl.signal.aborted && setState({ data, error: null, loading: false }),
      (e: unknown) => !ctl.signal.aborted && setState({ data: null, error: e instanceof Error ? e.message : tr('Yüklenemedi.'), loading: false }),
    )
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

// --- Etiketler -----------------------------------------------------------------------------------------------------
export const TYPE_LABEL: Record<string, string> = {
  cami: 'Cami',
  medrese: 'Medrese',
  türbe: 'Türbe',
  han: 'Han',
  bedesten: 'Bedesten',
  hamam: 'Hamam',
  çeşme: 'Çeşme',
}
/** Tür etiketi arayüz dilinde (bileşen `useLang` ile yeniden çizildiği için o anki dil kullanılır). */
export const typeLabel = (type: string) => tr(TYPE_LABEL[type] ?? type.charAt(0).toLocaleUpperCase('tr') + type.slice(1))

export function formatDistance(m: number): string {
  const locale = getLang() === 'en' ? 'en-GB' : 'tr-TR'
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km`
}

/** Şehir adını adres çubuğundaki biçime çevirir (İzmir → izmir). */
export function citySlug(name: string): string {
  return name
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

// --- Oyun (Faz 5): sözleşme backend/app/game_routes.py ile aynıdır --------------------------------------------------
export interface GameState {
  monument_id: string
  locked: boolean
  listened: boolean
  asked: boolean
  /** Rehber kapalıysa soru sormak şart değildir. */
  guide_required: boolean
  ready_for_quiz: boolean
  quiz_size: number
  pass_mark: number
  knowledge: { earned_at: string } | null
  visit: { earned_at: string; simulated: boolean } | null
  visit_radius_m: number
  /** Jüri sunumu için açıkça etiketli ziyaret simülasyonu açık mı (`VAKIFNAME_VISIT_SIMULATION`). */
  simulated_visit_allowed: boolean
  site_notice: string | null
}
export type QuizQuestion =
  | { qid: string; kind: 'choice'; prompt: string; choices: string[] }
  | { qid: string; kind: 'image_pick'; prompt: string; images: { file: string; attribution: string | null }[] }
  | { qid: string; kind: 'true_false'; prompt: string; statement: string }
export interface Quiz {
  quiz_id: string
  expires_at: string
  questions: QuizQuestion[]
}
export interface QuizResult {
  score: number
  total: number
  passed: boolean
  results: {
    qid: string
    correct: boolean
    correct_choice: number
    explanation: string
    fact: { title: string; text: string; source: string; certainty?: string } | null
  }[]
  knowledge_seal: { earned_at: string; new: boolean } | null
}
export type VisitStatus = 'gold' | 'already' | 'out_of_range' | 'needs_knowledge' | 'simulation_disabled'
export interface VisitResult {
  status: VisitStatus
  distance_m: number | null
  radius_m: number
  visit_seal: { earned_at: string } | null
}

const enc = encodeURIComponent
export const getGame = (id: string, userId: string, signal?: AbortSignal) =>
  apiGet(`/monuments/${enc(id)}/game?user_id=${enc(userId)}`, signal, WITH_COOKIE) as Promise<GameState>
export const sendEngagement = (id: string, userId: string, event: 'listened' | 'asked') =>
  apiPost(`/monuments/${enc(id)}/engagement`, { user_id: userId, event }, undefined, WITH_COOKIE) as Promise<GameState>
export const startQuiz = (id: string, userId: string) =>
  apiPost(`/monuments/${enc(id)}/quiz`, { user_id: userId }, undefined, WITH_COOKIE) as Promise<Quiz>
export const submitQuiz = (quizId: string, userId: string, answers: { qid: string; choice: number }[]) =>
  apiPost(`/quiz/${enc(quizId)}/submit`, { user_id: userId, answers }, undefined, WITH_COOKIE) as Promise<QuizResult>
export const sendVisit = (id: string, userId: string, body: { latitude?: number; longitude?: number; simulate?: boolean }) =>
  apiPost(`/monuments/${enc(id)}/visit`, { user_id: userId, ...body }, undefined, WITH_COOKIE) as Promise<VisitResult>

export interface SealBookEntry {
  monument_id: string
  monument_name: string
  kind: 'knowledge' | 'visit'
  earned_at: string
  simulated?: boolean
}
export interface SealBook {
  user_id: string
  knowledge_seals: SealBookEntry[]
  visit_seals: SealBookEntry[]
  monuments: { monument_id: string; name: string; quests: number; solved: number; checkin_available: boolean }[]
}
export const getSealBook = (userId: string, signal?: AbortSignal) =>
  apiGet(`/users/${enc(userId)}/seals`, signal, WITH_COOKIE) as Promise<SealBook>

// --- Tarihî kişi kartları (K4): backend/app/people_routes.py --------------------------------------------------------
export interface PersonCard {
  name: string
  role: 'bani' | 'medfun' | 'yeniden_yaptiran'
  role_label: string
  fact_id: string
  text: string
  certainty: string
  source: string
}
export const getPeople = (id: string, signal?: AbortSignal) =>
  apiGet(`/monuments/${enc(id)}/people`, signal).then((b) => ((b as { people?: PersonCard[] }).people ?? []))

// --- Yönetim: istatistik (backend/app/stats_routes.py) -------------------------------------------------------------
export interface AdminStats {
  days: { day: string; visitors: number; pageviews: number }[]
  totals: { visitors: number; pageviews: number; monument_views: number }
  pages: { page: string; views: number }[]
  monuments: { monument_id: string; name: string; views: number }[]
  /** Tüm zamanlar; tarih aralığından bağımsız. Kişi bilgisi içermez. */
  game?: { players: number; listened: number; asked: number; knowledge: number; visit: number; visit_simulated: number }
}
export const getAdminStats = (days: number, signal?: AbortSignal) =>
  apiGet(`/admin/stats?days=${days}`, signal, WITH_COOKIE) as Promise<AdminStats>

// --- Yönetim: içerik (docs/ICERIK_YONETIMI.md; backend/app/content) ------------------------------------------------
export type ContentStatus = 'draft' | 'published' | 'rejected' | 'withdrawn'
export type Decision = { decision_id: string; by: string; at: string } | null
export interface ContentSource {
  source_id: string
  title: string
  page_count: number
  rights_confirmed: boolean
  uploaded_at: string
  uploaded_by: string
}
export interface Quest {
  question: string
  choices: string[]
  answer_index: number
  explanation: string
}
export interface ContentFact {
  fact_id: string
  monument_id: string
  title: string
  text: string
  category: string
  certainty: string
  source_id: string
  page: number
  quote: string
  game_use: boolean
  quest: Quest | null
  origin: 'pipeline' | 'manual'
  status: ContentStatus
  quote_check: 'found' | 'not_found' | 'no_quote'
  updated_at: string
  decision: Decision
}
export interface MonumentFields {
  name: string
  alternative_names: string[]
  type: string
  city: string
  district: string
  address: string
  latitude: number | null
  longitude: number | null
  site_notice: string | null
}
export interface ContentMonument extends MonumentFields {
  monument_id: string
  origin: 'catalog' | 'content'
  status: ContentStatus
  decision: Decision
}
export interface MonumentRow {
  monument_id: string
  name: string
  city: string
  type: string
  origin: 'catalog' | 'content'
  status: ContentStatus
  facts: { draft: number; published: number }
}
export interface ContentImage {
  image_id: string
  url: string
  rights_holder: string
  license: string
  attribution: string | null
  title: string | null
  source_url: string | null
  status: ContentStatus
  decision: Decision
}
export interface ExtractJob {
  job_id: string
  source_id: string
  monument_id: string
  page_from: number
  page_to: number
  status: 'queued' | 'running' | 'done' | 'failed'
  created_at: string
  finished_at: string | null
  candidates: number
  dropped: number
  error: string | null
}
export interface ContentOverview {
  enabled: boolean
  sources: ContentSource[]
  monuments: MonumentRow[]
  drafts: number
  vocab: { certainty: string[]; category: string[]; type: string[]; cities: { slug: string; name: string }[] }
}
export interface MonumentEdit {
  monument: ContentMonument
  facts: ContentFact[]
  images: ContentImage[]
}
export type FactInput = Pick<
  ContentFact,
  'title' | 'text' | 'category' | 'certainty' | 'source_id' | 'page' | 'quote' | 'game_use' | 'quest'
> & { publish: boolean }
export type ImageInput = {
  upload_id: string
  rights_holder: string
  license: string
  attribution: string | null
  title: string | null
  source_url: string | null
  publish: boolean
}
/** Pipeline'ın tek seferde okuyabileceği en fazla sayfa (sunucuyla aynı sınır). */
export const EXTRACT_MAX_PAGES = 6

const C = '/admin/content'
const UPLOAD_TIMEOUT_MS = 5 * 60_000
export const getContentOverview = (signal?: AbortSignal) => apiGet(`${C}/overview`, signal, WITH_COOKIE) as Promise<ContentOverview>
export const uploadContentFile = (file: File) =>
  apiUpload(`${C}/uploads`, file, file.type || 'application/octet-stream', { ...WITH_COOKIE, timeoutMs: UPLOAD_TIMEOUT_MS }) as Promise<{
    upload_id: string
    kind: 'pdf' | 'image'
    size: number
  }>
export const createSource = (body: { upload_id: string; title: string; rights_confirmed: boolean }) =>
  apiPost(`${C}/sources`, body, undefined, { ...WITH_COOKIE, timeoutMs: UPLOAD_TIMEOUT_MS }) as Promise<ContentSource>
export const getSourcePage = (sourceId: string, page: number, signal?: AbortSignal) =>
  apiGet(`${C}/sources/${enc(sourceId)}/pages/${page}`, signal, WITH_COOKIE) as Promise<{
    source_id: string
    page: number
    page_count: number
    text: string
  }>
export const searchSource = (sourceId: string, q: string, signal?: AbortSignal) =>
  apiGet(`${C}/sources/${enc(sourceId)}/search?q=${enc(q)}`, signal, WITH_COOKIE) as Promise<{ hits: { page: number; snippet: string }[] }>
export const createMonument = (body: MonumentFields & { publish: boolean }) =>
  apiPost(`${C}/monuments`, body, undefined, WITH_COOKIE) as Promise<ContentMonument>
export const getContentMonument = (id: string, signal?: AbortSignal) =>
  apiGet(`${C}/monuments/${enc(id)}`, signal, WITH_COOKIE) as Promise<MonumentEdit>
export const updateMonument = (id: string, body: MonumentFields & { publish: boolean }) =>
  apiPost(`${C}/monuments/${enc(id)}`, body, undefined, { ...WITH_COOKIE, method: 'PUT' }) as Promise<ContentMonument>
export const withdrawMonument = (id: string) =>
  apiPost(`${C}/monuments/${enc(id)}/withdraw`, {}, undefined, WITH_COOKIE) as Promise<ContentMonument>
export const listFacts = (filter: { status?: ContentStatus; monument_id?: string }, signal?: AbortSignal) => {
  const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => !!v) as [string, string][])
  return apiGet(`${C}/facts${q.toString() ? `?${q}` : ''}`, signal, WITH_COOKIE) as Promise<{ facts: ContentFact[] }>
}
export const createFact = (body: FactInput & { monument_id: string }) =>
  apiPost(`${C}/facts`, body, undefined, WITH_COOKIE) as Promise<ContentFact>
export const updateFact = (id: string, body: FactInput) =>
  apiPost(`${C}/facts/${enc(id)}`, body, undefined, { ...WITH_COOKIE, method: 'PUT' }) as Promise<ContentFact>
export const factAction = (id: string, action: 'publish' | 'reject' | 'withdraw') =>
  apiPost(`${C}/facts/${enc(id)}/${action}`, {}, undefined, WITH_COOKIE) as Promise<ContentFact>
export const startExtract = (body: { source_id: string; monument_id: string; page_from: number; page_to: number }) =>
  apiPost(`${C}/extract`, body, undefined, WITH_COOKIE) as Promise<ExtractJob>
export const getJob = (id: string, signal?: AbortSignal) => apiGet(`${C}/jobs/${enc(id)}`, signal, WITH_COOKIE) as Promise<ExtractJob>
export const addImage = (monumentId: string, body: ImageInput) =>
  apiPost(`${C}/monuments/${enc(monumentId)}/images`, body, undefined, WITH_COOKIE) as Promise<ContentImage>
/** Kitap sayfasındaki fotoğraf (karar 14 = A); `url` yönetici önizlemesidir. */
export interface BookImage {
  index: number
  width: number
  height: number
  url: string
}
export const getPageImages = (sourceId: string, page: number, signal?: AbortSignal) =>
  apiGet(`${C}/sources/${enc(sourceId)}/pages/${page}/images`, signal, WITH_COOKIE) as Promise<{ images: BookImage[] }>
export const addImageFromSource = (
  monumentId: string,
  body: { source_id: string; page: number; index: number; title: string | null; publish: boolean },
) => apiPost(`${C}/monuments/${enc(monumentId)}/images/from-source`, body, undefined, WITH_COOKIE) as Promise<ContentImage>
export const imageAction = (id: string, action: 'publish' | 'withdraw') =>
  apiPost(`${C}/images/${enc(id)}/${action}`, {}, undefined, WITH_COOKIE) as Promise<ContentImage>
/** Yönetici önizlemesi: sunucu göreli yol (`/admin/content/media/...`) verirse API adresine bağlanır. */
export const adminMediaUrl = (url: string) => (url.startsWith('/') ? `${API_BASE_URL}${url}` : url)
/** Kayıt kimliğinden eser kimliği: `BUR-5001-F001` → `BUR-5001`. */
export const monumentOfFact = (factId: string) => factId.replace(/-F\d+$/, '')
