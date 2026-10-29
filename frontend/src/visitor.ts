/**
 * Genel platformun ziyaretçi kimliği (gerçek eser pasaportu için).
 *
 * Hesap veya kimlik doğrulama DEĞİLDİR: bu tarayıcıya özel, rastgele ve kişisel bilgi içermeyen bir etikettir;
 * `localStorage`'da tutulur.
 */
export const VISITOR_STORAGE_KEY = 'vakifname.visitorId'

let memoryFallback: string | null = null

const isValid = (id: string | null): id is string => !!id && /^ziyaretci-[A-Za-z0-9-]{1,54}$/.test(id)

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getVisitorId(): string {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(VISITOR_STORAGE_KEY)
  } catch {
    stored = null
  }
  if (isValid(stored)) return stored
  if (isValid(memoryFallback)) return memoryFallback
  const id = `ziyaretci-${randomId()}`
  memoryFallback = id
  try {
    window.localStorage.setItem(VISITOR_STORAGE_KEY, id)
  } catch {
    // Yalnızca bellek içi yedek kullanılır.
  }
  return id
}
