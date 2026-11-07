import { useEffect, useSyncExternalStore } from 'react'
import { apiGet, apiPost, ApiError } from '../api/client'
import { getVisitorId } from '../visitor'
import { getLang, t } from './i18n'

/**
 * Oturum durumu. Hesaplar sunucudadır (`/auth/*`, HttpOnly `vk_session` çerezi); tarayıcı yalnızca "misafir" tercihini
 * hatırlar. Parola ve belirteç hiçbir zaman tarayıcıda saklanmaz.
 */
export interface AuthUser {
  user_id: string
  email: string | null
  display_name: string | null
  provider: 'password' | 'google'
  /** E-posta bağlantıyla (veya Google ile) doğrulandı mı. Yönetici yetkisi doğrulanmış e-posta ister. */
  email_verified?: boolean
  /** Yönetici paneli (`/yonetim`) için; sunucu `VAKIFNAME_ADMIN_EMAILS` listesine ve doğrulamaya göre belirler. */
  is_admin?: boolean
}
export type AuthState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'guest' }
  | { status: 'user'; user: AuthUser }

const GUEST_KEY = 'vakifname.guest'
const AUTH = { credentials: 'include' as const }
const VISITOR_ID = /^ziyaretci-[0-9a-f-]{36}$/

let state: AuthState = { status: 'loading' }
let started = false
const listeners = new Set<() => void>()

function set(next: AuthState) {
  state = next
  listeners.forEach((l) => l())
}

function guestFlag(value?: boolean): boolean {
  try {
    if (value === true) window.localStorage.setItem(GUEST_KEY, '1')
    if (value === false) window.localStorage.removeItem(GUEST_KEY)
    return window.localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return value === true
  }
}

function isUser(v: unknown): v is AuthUser {
  return !!v && typeof v === 'object' && typeof (v as AuthUser).user_id === 'string'
}

function signedIn(body: unknown): AuthUser {
  if (!isUser(body)) throw new ApiError('invalid-response', t('Sunucudan beklenmeyen bir yanıt geldi.'))
  guestFlag(false)
  set({ status: 'user', user: body })
  return body
}

/** Misafirken toplanan ilerleme girişte hesaba taşınsın diye gönderilir (yalnızca sunucunun kabul ettiği biçimde). */
function visitor(): { visitor_id?: string } {
  const id = getVisitorId()
  return VISITOR_ID.test(id) ? { visitor_id: id } : {}
}

let retryTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Oturumu sunucudan okur. Yalnızca sunucu "oturum yok" derse (401 ya da başka bir HTTP cevabı) çıkış durumuna geçilir.
 * R6.9: sunucuya ulaşılamıyorsa (ör. backend yeniden başlatılıyor) oturum düşürülmez: giriş yapmış kullanıcı öyle kalır,
 * açılıştaysa durum "yükleniyor" kalır ve artan aralıklarla (en çok 10 sn) yeniden denenir; sunucu dönünce aynı çerezle
 * kullanıcı geri gelir (oturum sunucuda kalıcıdır).
 */
export async function refreshAuth(attempt = 0): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  try {
    const me = await apiGet('/auth/me', undefined, AUTH)
    if (isUser(me)) return set({ status: 'user', user: me })
  } catch (e) {
    if (e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout')) {
      if (state.status === 'loading') {
        retryTimer = setTimeout(() => void refreshAuth(attempt + 1), Math.min(1000 * 2 ** attempt, 10_000))
      }
      return
    }
    /* 401 (oturum yok) ya da beklenmeyen cevap: misafir tercihi varsa misafir olarak sürer */
  }
  set(guestFlag() ? { status: 'guest' } : { status: 'none' })
}

export const register = (email: string, password: string) =>
  apiPost('/auth/register', { email, password, ...visitor(), lang: getLang() }, undefined, AUTH).then(signedIn)

export const login = (email: string, password: string) =>
  apiPost('/auth/login', { email, password, ...visitor() }, undefined, AUTH).then(signedIn)

export const googleSignIn = (idToken: string) =>
  apiPost('/auth/google', { id_token: idToken, ...visitor() }, undefined, AUTH).then(signedIn)

/** Doğrulama bağlantısını yeniden gönderir (oturum gerekir; aynı hesaba dakikada bir). */
export async function resendVerification(): Promise<void> {
  await apiPost('/auth/verify-email/resend', { lang: getLang() }, undefined, AUTH)
}

// Aynı bağlantı aynı sayfada iki kez gönderilmesin (StrictMode efektleri iki kez çalıştırır; belirteç tek kullanımlık).
const verifying = new Map<string, Promise<void>>()

/** E-postadaki doğrulama bağlantısının belirtecini sunucuya gönderir. Oturum açmaz; açıksa rozeti tazeler. */
export function verifyEmail(token: string): Promise<void> {
  let p = verifying.get(token)
  if (!p) {
    p = apiPost('/auth/verify-email', { token }, undefined, AUTH).then(() => refreshAuth())
    verifying.set(token, p)
  }
  return p
}

/** Parola yenileme bağlantısı ister. Sunucu hesap olsa da olmasa da aynı cevabı verir. */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiPost('/auth/password-reset/request', { email, lang: getLang() }, undefined, AUTH)
}

/** Bağlantıdaki belirteçle yeni parolayı kaydeder; sunucu eski oturumları kapatır ve bu cihazda oturum açar. */
export const resetPassword = (token: string, password: string) =>
  apiPost('/auth/password-reset/confirm', { token, password, ...visitor() }, undefined, AUTH).then(signedIn)

const LINK_TOKEN = /(?:^#|&)t=([A-Za-z0-9_-]{20,128})(?:&|$)/

/** E-posta bağlantısının belirteci adresin parçasındadır (`#t=…`): sunucuya ve `Referer`'a gitmez. Yalnızca okur. */
export function readLinkToken(): string | null {
  return LINK_TOKEN.exec(window.location.hash)?.[1] ?? null
}

/** Belirteci adres çubuğundan ve tarayıcı geçmişinden siler. */
export function clearLinkToken(): void {
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
}

export async function logout(): Promise<void> {
  try {
    await apiPost('/auth/logout', {}, undefined, AUTH)
  } finally {
    guestFlag(false)
    set({ status: 'none' })
  }
}

/** Hesabı ve ilerlemesini kalıcı olarak siler (KVKK). */
export async function deleteAccount(): Promise<void> {
  await apiGet('/auth/me', undefined, { ...AUTH, method: 'DELETE' })
  guestFlag(false)
  set({ status: 'none' })
}

export function startGuest(): void {
  guestFlag(true)
  set({ status: 'guest' })
}

export function endGuest(): void {
  guestFlag(false)
  set({ status: 'none' })
}

export function useAuth(): AuthState {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
  useEffect(() => {
    if (!started) {
      started = true
      void refreshAuth()
    }
  }, [])
  return s
}

/** Yalnızca testler: depoyu başlangıç durumuna döndürür. */
export function resetAuthForTests(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  started = false
  verifying.clear()
  guestFlag(false)
  state = { status: 'loading' }
}

/** Kısa görünen ad: ad, yoksa e-posta, misafirse "Misafir". */
export function displayName(s: AuthState): string {
  if (s.status === 'user') return s.user.display_name || s.user.email || t('Hesabım')
  return t('Misafir')
}
