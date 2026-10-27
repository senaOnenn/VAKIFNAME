import type { CheckInResponse, CheckInStatus, Passport, Place, Stamp } from './types'

// localhost (127.0.0.1 değil): oturum çerezi SameSite=Lax; arayüz localhost:5173'teyken aynı site sayılır.
const DEFAULT_API_BASE_URL = 'http://localhost:8000'
const REQUEST_TIMEOUT_MS = 10_000

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '')

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'invalid-response'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

/** FastAPI hata gövdesinden (`{"detail": "..."}` veya doğrulama hata listesi) okunabilir bir mesaj çıkarır. */
function detailMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('detail' in body)) return undefined
  const { detail } = body as { detail: unknown }
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : '')).filter(Boolean)
    return messages.length ? messages.join('; ') : undefined
  }
  return undefined
}

export interface RequestOptions {
  /** Varsayılan 10 sn; yapay zekâ rehberi gibi yavaş uçlar için uzatılır. */
  timeoutMs?: number
  headers?: Record<string, string>
  /** Yalnızca rehber test oturumu çerezi için `include`; diğer uçlar çerez göndermez. */
  credentials?: RequestCredentials
  method?: 'DELETE'
}

async function request(path: string, signal?: AbortSignal, json?: unknown, options: RequestOptions = {}): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', forwardAbort)

  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...(json === undefined
          ? { method: options.method ?? 'GET', headers: { Accept: 'application/json', ...options.headers } }
          : {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
              body: JSON.stringify(json),
            }),
        signal: controller.signal,
        ...(options.credentials ? { credentials: options.credentials } : {}),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (timedOut) throw new ApiError('timeout', 'Sunucu zamanında yanıt vermedi.')
      throw new ApiError('network', 'Sunucuya ulaşılamadı.')
    }

    const body: unknown = response.status === 204 ? null : await response.json().catch(() => undefined)
    if (!response.ok) {
      const message = detailMessage(body) ?? `Sunucu bir hata döndürdü (HTTP ${response.status}).`
      throw new ApiError('http', message, response.status)
    }
    if (body === undefined) throw new ApiError('invalid-response', 'Sunucudan beklenmeyen bir yanıt geldi.')
    return body
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Genel API'ye GET isteği; hata türleri `ApiError` ile aynıdır. Gerçek eser kataloğu istemcisi bunu kullanır. */
export function apiGet(path: string, signal?: AbortSignal, options?: RequestOptions): Promise<unknown> {
  return request(path, signal, undefined, options)
}

/** Genel API'ye JSON gövdeli POST isteği (keşif sorusu cevabı gibi). */
export function apiPost(path: string, json: unknown, signal?: AbortSignal, options?: RequestOptions): Promise<unknown> {
  return request(path, signal, json, options)
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isOptionalString = (v: unknown) => v === null || v === undefined || typeof v === 'string'

/** Backend `Place` sözleşmesi: koordinatlar WGS84 aralığında, görev yarıçapı pozitif ve sonlu olmalı. */
function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.city === 'string' &&
    typeof p.description === 'string' &&
    isFiniteNumber(p.latitude) &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    isFiniteNumber(p.longitude) &&
    p.longitude >= -180 &&
    p.longitude <= 180 &&
    isFiniteNumber(p.check_in_radius_m) &&
    p.check_in_radius_m > 0 &&
    isOptionalString(p.source_title) &&
    isOptionalString(p.source_url) &&
    typeof p.is_demo === 'boolean'
  )
}

function invalid(): ApiError {
  return new ApiError('invalid-response', 'Sunucudan beklenmeyen bir yanıt geldi.')
}

export async function getPlaces(signal?: AbortSignal): Promise<Place[]> {
  const body = await request('/places', signal)
  if (!Array.isArray(body) || !body.every(isPlace)) throw invalid()
  return body
}

export async function getPlace(placeId: string, signal?: AbortSignal): Promise<Place> {
  const body = await request(`/places/${encodeURIComponent(placeId)}`, signal)
  if (!isPlace(body)) throw invalid()
  return body
}

function isStamp(value: unknown): value is Stamp {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return (
    typeof s.place_id === 'string' &&
    typeof s.place_name === 'string' &&
    typeof s.earned_at === 'string' &&
    !Number.isNaN(Date.parse(s.earned_at))
  )
}

const CHECK_IN_STATUSES: readonly CheckInStatus[] = ['completed', 'already_completed', 'out_of_range']

/** Yanıtın biçimini ve kendi içindeki tutarlılığını doğrular: mühür yalnızca başarılı durumlarda ve aynı esere ait olmalı. */
function isCheckInResponse(value: unknown, placeId: string): value is CheckInResponse {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  if (
    typeof r.success !== 'boolean' ||
    !CHECK_IN_STATUSES.includes(r.status as CheckInStatus) ||
    typeof r.message !== 'string' ||
    r.place_id !== placeId ||
    typeof r.distance_m !== 'number' ||
    typeof r.allowed_radius_m !== 'number'
  ) {
    return false
  }
  const stamp = r.stamp ?? null
  if (r.status === 'out_of_range') return r.success === false && stamp === null
  return r.success === true && isStamp(stamp) && stamp.place_id === placeId
}

export function isPassport(value: unknown, userId: string): value is Passport {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    p.user_id === userId &&
    Array.isArray(p.stamps) &&
    p.stamps.every(isStamp) &&
    typeof p.total_stamps === 'number' &&
    p.total_stamps === p.stamps.length
  )
}

/**
 * `POST /quests/{place_id}/check-in`. Koordinatlar istemcinin bildirdiği değerlerdir; backend bunları doğrulamaz.
 * `out_of_range` hata değil, normal bir yanıttır.
 */
export async function checkIn(
  placeId: string,
  userId: string,
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<CheckInResponse> {
  const body = await request(`/quests/${encodeURIComponent(placeId)}/check-in`, signal, {
    user_id: userId,
    latitude,
    longitude,
  })
  if (!isCheckInResponse(body, placeId)) throw invalid()
  return { ...body, stamp: body.stamp ?? null }
}

export async function getPassport(userId: string, signal?: AbortSignal): Promise<Passport> {
  const body = await request(`/users/${encodeURIComponent(userId)}/passport`, signal)
  if (!isPassport(body, userId)) throw invalid()
  return body
}
