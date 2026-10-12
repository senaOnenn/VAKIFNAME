import type { Place } from './types'

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000'
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

async function request(path: string, signal?: AbortSignal): Promise<unknown> {
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
      response = await fetch(`${API_BASE_URL}${path}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (timedOut) throw new ApiError('timeout', 'Sunucu zamanında yanıt vermedi.')
      throw new ApiError('network', 'Sunucuya ulaşılamadı.')
    }

    const body: unknown = await response.json().catch(() => undefined)
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

function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.city === 'string' &&
    typeof p.description === 'string' &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
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
