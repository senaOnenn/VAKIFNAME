import { ApiError, apiGet, apiPost } from '../api/client'
import type { AskFact, GuideAvailability, GuideResult } from './types'

/**
 * Sunucu bir soruyu en geç `deadline_s` (varsayılan 50 sn) içinde cevaplar; süre dolarsa kendisi kaynaklı arama cevabı
 * döner. Arayüz bundan biraz daha uzun bekler; bu süre de dolarsa istek yeniden gönderilmez (kota harcanmaz).
 */
export const GUIDE_TIMEOUT_MS = 70_000
export const PHOTO_SOURCE = 'FOTOGRAF'

const invalid = () => new ApiError('invalid-response', 'Sunucudan beklenmeyen bir yanıt geldi.')
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Rehber uçları test oturumu çerezini (`HttpOnly`, JavaScript okuyamaz) taşır. `X-Vakifname-Guide` başlığı CSRF
 * korumasıdır: sunucu çerezli isteği bu başlık olmadan kabul etmez. Test anahtarı yalnızca giriş formunda bir kez
 * gönderilir; URL'de, tarayıcı deposunda veya başlıkta tutulmaz.
 */
const GUIDE_OPTIONS = { credentials: 'include' as const, headers: { 'X-Vakifname-Guide': '1' } }

export async function openTesterSession(key: string, signal?: AbortSignal): Promise<void> {
  await apiPost('/guide/session', { key }, signal, GUIDE_OPTIONS)
}

export async function closeTesterSession(signal?: AbortSignal): Promise<void> {
  await apiGet('/guide/session', signal, { ...GUIDE_OPTIONS, method: 'DELETE' })
}

export async function getGuideAvailability(signal?: AbortSignal): Promise<GuideAvailability> {
  const body = await apiGet('/guide/status', signal, GUIDE_OPTIONS)
  if (!isObject(body) || typeof body.enabled !== 'boolean') throw invalid()
  return body as unknown as GuideAvailability
}

export interface GuideTurn {
  question: string
  answer: string
}

export interface GuideImage {
  data: string
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
}

/** Gönderilen fotoğraf: ziyaretçi yüz, kişisel bilgi veya gizli belge olmadığını onaylamıştır (sunucu onaysız reddeder). */
export type ConsentedImage = GuideImage & { consent: true }

const hasSources = (f: unknown): f is AskFact =>
  isObject(f) && typeof f.fact_id === 'string' && typeof f.text === 'string' && Array.isArray(f.sources) && f.sources.length > 0

/**
 * `POST /guide/ask`. Her cümlenin kaynağı yanıtta gösterilen onaylı kayıtlardan biri (veya fotoğraf) olmalıdır;
 * kaynağı bulunmayan cümle taşıyan yanıt bütünüyle reddedilir.
 */
export async function askGuide(
  question: string,
  monumentId: string | null,
  history: GuideTurn[],
  image: ConsentedImage | null,
  signal?: AbortSignal,
): Promise<GuideResult> {
  const payload: Record<string, unknown> = { question, history }
  if (monumentId) payload.monument_id = monumentId
  if (image) payload.image = image
  const body = await apiPost('/guide/ask', payload, signal, { ...GUIDE_OPTIONS, timeoutMs: GUIDE_TIMEOUT_MS })
  if (!isObject(body) || typeof body.status !== 'string' || typeof body.message !== 'string') throw invalid()
  if (body.mode !== 'generative' && body.mode !== 'fallback_search') throw invalid()
  const facts = Array.isArray(body.facts) ? body.facts : null
  const sentences = Array.isArray(body.sentences) ? body.sentences : null
  if (!facts || !sentences || !facts.every(hasSources)) throw invalid()
  const known = new Set<string>([
    PHOTO_SOURCE,
    ...facts.map((f) => f.fact_id),
    ...(Array.isArray(body.identities) ? body.identities.map((i) => (isObject(i) ? String(i.id) : '')) : []),
  ])
  const ok = sentences.every(
    (s) =>
      isObject(s) &&
      typeof s.text === 'string' &&
      Array.isArray(s.sources) &&
      s.sources.length > 0 &&
      s.sources.every((id) => typeof id === 'string' && known.has(id)),
  )
  if (!ok) throw invalid()
  return body as unknown as GuideResult
}

/** Fotoğrafı tarayıcıda küçültüp JPEG olarak yeniden kodlar (EXIF/GPS dahil üst veri bu sırada düşer). */
export async function preparePhoto(file: File, maxSide = 1600): Promise<{ image: GuideImage; previewUrl: string }> {
  const readRaw = () =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('read'))
      r.readAsDataURL(file)
    })
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const url = canvas.toDataURL('image/jpeg', 0.85)
    if (!url.startsWith('data:image/jpeg')) throw new Error('encode')
    return { image: { data: url.split(',', 2)[1], mime: 'image/jpeg' }, previewUrl: url }
  } catch {
    // Tarayıcı yeniden kodlayamıyorsa özgün dosya gönderilir; üst veri sunucuda ayrıca silinir.
    const url = await readRaw()
    const mime = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
    return { image: { data: url.split(',', 2)[1], mime }, previewUrl: url }
  }
}
