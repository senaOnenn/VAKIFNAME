import { useEffect, useSyncExternalStore } from 'react'
import { apiGet, apiPost, ApiError } from '../api/client'
import { getVisitorId } from '../visitor'

/**
 * Oturum durumu. Hesaplar sunucudadır (`/auth/*`, HttpOnly `vk_session` çerezi); tarayıcı yalnızca "misafir" tercihini
 * hatırlar. Parola ve belirteç hiçbir zaman tarayıcıda saklanmaz.
 */
export interface AuthUser {
  user_id: string
  email: string | null
  display_name: string | null
  provider: 'password' | 'google'
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
  if (!isUser(body)) throw new ApiError('invalid-response', 'Sunucudan beklenmeyen bir yanıt geldi.')
  guestFlag(false)
  set({ status: 'user', user: body })
  return body
}

/** Misafirken toplanan ilerleme girişte hesaba taşınsın diye gönderilir (yalnızca sunucunun kabul ettiği biçimde). */
function visitor(): { visitor_id?: string } {
  const id = getVisitorId()
  return VISITOR_ID.test(id) ? { visitor_id: id } : {}
}

export async function refreshAuth(): Promise<void> {
  try {
    const me = await apiGet('/auth/me', undefined, AUTH)
    if (isUser(me)) return set({ status: 'user', user: me })
  } catch {
    /* 401 (oturum yok) veya sunucuya ulaşılamadı: misafir tercihi varsa misafir olarak sürer */
  }
  set(guestFlag() ? { status: 'guest' } : { status: 'none' })
}

export const register = (email: string, password: string) =>
  apiPost('/auth/register', { email, password, ...visitor() }, undefined, AUTH).then(signedIn)

export const login = (email: string, password: string) =>
  apiPost('/auth/login', { email, password, ...visitor() }, undefined, AUTH).then(signedIn)

export const googleSignIn = (idToken: string) =>
  apiPost('/auth/google', { id_token: idToken, ...visitor() }, undefined, AUTH).then(signedIn)

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
  started = false
  guestFlag(false)
  state = { status: 'loading' }
}

/** Kısa görünen ad: ad, yoksa e-posta, misafirse "Misafir". */
export function displayName(s: AuthState): string {
  if (s.status === 'user') return s.user.display_name || s.user.email || 'Hesabım'
  return 'Misafir'
}
