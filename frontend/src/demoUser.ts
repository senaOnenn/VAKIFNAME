/**
 * Demo oyuncu kimliği.
 *
 * Bu bir kullanıcı hesabı veya kimlik doğrulama DEĞİLDİR: tarayıcı sekmesi oturumu boyunca `sessionStorage`'da
 * tutulan rastgele bir etikettir. Kişisel bilgi içermez, gizli değildir ve bilen herkes aynı pasaportu
 * okuyabilir. Sekme kapanınca kaybolur; backend ilerlemeyi bellekte tuttuğu için sunucu yeniden
 * başlatıldığında da mühürler silinir.
 */
export const DEMO_USER_STORAGE_KEY = 'vakifname.demoUserId'

// sessionStorage kullanılamazsa (gizli mod kısıtları vb.) kimlik yalnızca sayfa açık kaldıkça bellekte tutulur.
let memoryFallback: string | null = null

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function isValid(id: string | null): id is string {
  // Backend `user_id` için en fazla 64 karakter kabul eder.
  return !!id && /^demo-[A-Za-z0-9-]{1,59}$/.test(id)
}

export function getDemoUserId(): string {
  let stored: string | null = null
  try {
    stored = window.sessionStorage.getItem(DEMO_USER_STORAGE_KEY)
  } catch {
    stored = null
  }
  if (isValid(stored)) return stored
  if (isValid(memoryFallback)) return memoryFallback

  const id = `demo-${randomId()}`
  memoryFallback = id
  try {
    window.sessionStorage.setItem(DEMO_USER_STORAGE_KEY, id)
  } catch {
    // Yalnızca bellek içi yedek kullanılır.
  }
  return id
}

/** Yalnızca testler için: bellek içi yedeği sıfırlar. */
export function resetDemoUserIdForTests() {
  memoryFallback = null
}
