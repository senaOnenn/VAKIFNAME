import { ApiError } from '../api/client'
import type {
  AuditResponse,
  BatchListing,
  BatchResult,
  BatchSubmitItem,
  BatchTicket,
  GalleryPreview,
  ImageRecord,
  InternalStatus,
  LocationCandidatesResponse,
  MonumentDetail,
  MonumentSummary,
  QuarantinedDraft,
  ResearchResponse,
  ReviewOverview,
  ReviewSubject,
  ReviewTicket,
  SessionInfo,
  SubjectKind,
} from './types'

/**
 * Dahili inceleme sunucusu istemcisi. İstekler aynı origin'deki `/internal` yoluna gider; Vite geliştirme sunucusu
 * bunu yalnızca loopback istemciler için 127.0.0.1:8765'e iletir (vite.config.ts).
 *
 * Erişim anahtarı kodda, ortam değişkeninde veya tarayıcı deposunda tutulmaz. Kullanıcı anahtarı bir kez girer;
 * sunucu HttpOnly oturum çerezi verir ve sonraki istekler yalnızca bu çerezle yetkilendirilir. `X-Vakifname-Review`
 * başlığı gizli değildir; çerezin başka bir siteden gönderilen isteklerde kullanılmasını engeller.
 */
const REVIEW_HEADERS = { Accept: 'application/json', 'X-Vakifname-Review': '1' }
const REQUEST_TIMEOUT_MS = 15_000

function detailMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('detail' in body)) return undefined
  const { detail } = body as { detail: unknown }
  if (typeof detail === 'string') return detail
  // Karar kuralı ihlalleri `{code, message}` olarak döner.
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
    return detail.message
  }
  if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : '')).join('; ')
  return undefined
}

async function reviewRequest(
  path: string,
  { method = 'GET', json, signal }: { method?: string; json?: unknown; signal?: AbortSignal } = {},
): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', forwardAbort)

  try {
    let response: Response
    try {
      response = await fetch(new URL(path, window.location.href).href, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: json === undefined ? REVIEW_HEADERS : { ...REVIEW_HEADERS, 'Content-Type': 'application/json' },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: controller.signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (timedOut) throw new ApiError('timeout', 'Dahili inceleme sunucusu zamanında yanıt vermedi.')
      throw new ApiError('network', 'Dahili inceleme sunucusuna ulaşılamadı.')
    }
    if (response.status === 204) return undefined
    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      throw new ApiError('http', detailMessage(body) ?? `Sunucu bir hata döndürdü (HTTP ${response.status}).`, response.status)
    }
    if (body === undefined) throw new ApiError('invalid-response', 'Sunucudan beklenmeyen bir yanıt geldi.')
    return body
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

const invalid = () => new ApiError('invalid-response', 'Sunucudan beklenmeyen bir yanıt geldi.')
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

function isMonumentSummary(v: unknown): v is MonumentSummary {
  return (
    isObject(v) &&
    typeof v.monument_id === 'string' &&
    typeof v.name === 'string' &&
    isObject(v.location) &&
    typeof v.location.status === 'string' &&
    isObject(v.review) &&
    Array.isArray(v.review.public_release_blockers)
  )
}

export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401

/** Oturum geçerliyse `true`, değilse `false`. Ağ hatası fırlatılır. */
export async function hasSession(signal?: AbortSignal): Promise<boolean> {
  try {
    await reviewRequest('/internal/session', { signal })
    return true
  } catch (error) {
    if (isUnauthorized(error)) return false
    throw error
  }
}

export async function openSession(token: string): Promise<void> {
  await reviewRequest('/internal/session', { method: 'POST', json: { token } })
}

export async function closeSession(): Promise<void> {
  await reviewRequest('/internal/session', { method: 'DELETE' })
}

export async function getStatus(signal?: AbortSignal): Promise<InternalStatus> {
  const body = await reviewRequest('/internal/status', { signal })
  if (!isObject(body) || !isObject(body.counts)) throw invalid()
  return body as unknown as InternalStatus
}

export async function getMonuments(signal?: AbortSignal): Promise<MonumentSummary[]> {
  const body = await reviewRequest('/internal/catalog/monuments', { signal })
  if (!Array.isArray(body) || !body.every(isMonumentSummary)) throw invalid()
  return body
}

export async function getMonument(id: string, signal?: AbortSignal): Promise<MonumentDetail> {
  const body = await reviewRequest(`/internal/catalog/monuments/${encodeURIComponent(id)}`, { signal })
  if (!isMonumentSummary(body) || !Array.isArray((body as unknown as MonumentDetail).facts)) throw invalid()
  return body as MonumentDetail
}

export async function getDrafts(monumentId: string, signal?: AbortSignal): Promise<QuarantinedDraft[]> {
  const body = await reviewRequest(`/internal/catalog/drafts?monument_id=${encodeURIComponent(monumentId)}`, { signal })
  if (!isObject(body) || body.quarantined !== true || !Array.isArray(body.drafts)) throw invalid()
  return body.drafts as QuarantinedDraft[]
}

// --- Editör inceleme iş akışı ---------------------------------------------------------

export async function getSessionInfo(signal?: AbortSignal): Promise<SessionInfo> {
  const body = await reviewRequest('/internal/session', { signal })
  if (!isObject(body) || body.authenticated !== true) throw invalid()
  return body as unknown as SessionInfo
}

/** Kişisel incelemeci hesabını oturuma bağlar. Kimlik bilgisi durumda tutulmaz; yalnızca bu istekte gönderilir. */
export async function reviewerLogin(reviewerId: string, credential: string): Promise<void> {
  await reviewRequest('/internal/session/reviewer', { method: 'POST', json: { reviewer_id: reviewerId, credential } })
}

export async function reviewerLogout(): Promise<void> {
  await reviewRequest('/internal/session/reviewer', { method: 'DELETE' })
}

export async function getOverview(signal?: AbortSignal): Promise<ReviewOverview> {
  const body = await reviewRequest('/internal/review/overview', { signal })
  if (!isObject(body) || !isObject(body.counts) || !Array.isArray(body.issues)) throw invalid()
  return body as unknown as ReviewOverview
}

const subjectPath = (kind: SubjectKind, id: string) =>
  `/internal/review/subjects/${kind}/${id.split('/').map(encodeURIComponent).join('/')}`

export async function getSubject(kind: SubjectKind, id: string, signal?: AbortSignal): Promise<ReviewSubject> {
  const body = await reviewRequest(subjectPath(kind, id), { signal })
  if (!isObject(body) || body.subject_id !== id || !isObject(body.decisions)) throw invalid()
  return body as unknown as ReviewSubject
}

export async function openTicket(kind: SubjectKind, id: string, decisionType: string): Promise<ReviewTicket> {
  const body = await reviewRequest('/internal/review/tickets', {
    method: 'POST',
    json: { subject_kind: kind, subject_id: id, decision_type: decisionType },
  })
  if (!isObject(body) || typeof body.ticket_id !== 'string') throw invalid()
  return body as unknown as ReviewTicket
}

export interface DecisionInput {
  ticket_id: string
  decision: 'approved' | 'rejected' | 'needs_revision'
  source_check: string
  rationale: string
  payload: Record<string, unknown>
}

export async function submitDecision(input: DecisionInput): Promise<void> {
  await reviewRequest('/internal/review/decisions', { method: 'POST', json: input })
}

export async function getResearch(monumentId: string, signal?: AbortSignal): Promise<ResearchResponse> {
  const body = await reviewRequest(`/internal/catalog/research/${encodeURIComponent(monumentId)}`, { signal })
  if (!isObject(body) || body.monument_id !== monumentId) throw invalid()
  return body as unknown as ResearchResponse
}

export async function getImages(monumentId: string, signal?: AbortSignal): Promise<ImageRecord[]> {
  const body = await reviewRequest(`/internal/catalog/images?monument_id=${encodeURIComponent(monumentId)}`, { signal })
  if (!isObject(body) || body.files_served !== false || !Array.isArray(body.images)) throw invalid()
  return body.images as ImageRecord[]
}

export async function getAudit(signal?: AbortSignal): Promise<AuditResponse> {
  const body = await reviewRequest('/internal/review/audit?limit=50', { signal })
  if (!isObject(body) || !Array.isArray(body.entries)) throw invalid()
  return body as unknown as AuditResponse
}

export async function getLocationCandidates(signal?: AbortSignal): Promise<LocationCandidatesResponse> {
  const body = await reviewRequest('/internal/review/location-candidates', { signal })
  if (!isObject(body) || !Array.isArray(body.candidates) || !isObject(body.flag_labels)) throw invalid()
  return body as unknown as LocationCandidatesResponse
}

// --- Toplu inceleme ---------------------------------------------------------------

export async function getBatch(signal?: AbortSignal): Promise<BatchListing> {
  const body = await reviewRequest('/internal/review/batch', { signal })
  if (!isObject(body) || !Array.isArray(body.stages)) throw invalid()
  return body as unknown as BatchListing
}

export async function openBatchTicket(keys: string[]): Promise<BatchTicket> {
  const body = await reviewRequest('/internal/review/batch/tickets', { method: 'POST', json: { keys } })
  if (!isObject(body) || typeof body.ticket_id !== 'string') throw invalid()
  return body as unknown as BatchTicket
}

export async function submitBatch(request: {
  ticket_id: string
  rationale: string
  items: BatchSubmitItem[]
}): Promise<BatchResult> {
  const body = await reviewRequest('/internal/review/batch/decisions', { method: 'POST', json: request })
  if (!isObject(body) || !Array.isArray(body.results)) throw invalid()
  return body as unknown as BatchResult
}

/**
 * İnceleme önizlemesi: sunucunun SHA-256 ile doğruladığı saklanan dosya. `<img src>` özel başlık gönderemediği için
 * dosya oturum başlığıyla alınır ve yalnızca bu sekmede geçerli bir nesne adresine çevrilir. Yalnızca `/internal/review/media/`.
 */
export async function getReviewMedia(path: string, signal?: AbortSignal): Promise<Blob> {
  if (!path.startsWith('/internal/review/media/')) throw invalid()
  const response = await fetch(new URL(path, window.location.href).href, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Vakifname-Review': '1' },
    signal,
  })
  if (!response.ok) throw new ApiError('http', `Önizleme alınamadı (HTTP ${response.status}).`, response.status)
  const blob = await response.blob()
  if (blob.type !== 'image/jpeg') throw invalid()
  return blob
}

/** Dahili galeri önizlemesi (yayın değildir). */
export async function getGallery(monumentId: string, signal?: AbortSignal): Promise<GalleryPreview> {
  const body = await reviewRequest(`/internal/review/gallery/${encodeURIComponent(monumentId)}`, { signal })
  if (!isObject(body) || !isObject(body.sections)) throw invalid()
  return body as unknown as GalleryPreview
}
