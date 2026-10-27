import { useSyncExternalStore } from 'react'

/**
 * Geçici (yalnızca bu tarayıcıda) oturum. Hesap sistemi ve Google doğrulaması sunucu tarafında Faz 2'de gelir;
 * o zamana kadar `provisional` oturum kullanıcıya açıkça "geçici" olarak gösterilir. Parola hiçbir yere kaydedilmez.
 */
export type SessionKind = 'guest' | 'provisional'
export interface Session {
  kind: SessionKind
  email?: string
  createdAt: string
}

const KEY = 'vakifname.session'
const listeners = new Set<() => void>()

function parse(raw: string | null | undefined): Session | null {
  try {
    const p = raw ? JSON.parse(raw) : null
    return p && (p.kind === 'guest' || p.kind === 'provisional') ? p : null
  } catch {
    return null
  }
}

function load(): Session | null {
  try {
    return parse(window.localStorage.getItem(KEY))
  } catch {
    return null
  }
}

// Bellek tek doğruluk kaynağıdır; localStorage yalnızca sekmeler/yenilemeler arası kalıcılık içindir ve kapalı olabilir.
let current: Session | null = typeof window === 'undefined' ? null : load()

function persist(value: Session | null): void {
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value))
    else window.localStorage.removeItem(KEY)
  } catch {
    /* depolama kapalı: oturum bu sayfa yaşadığı sürece bellekte kalır */
  }
}

function set(value: Session | null): void {
  current = value
  persist(value)
  listeners.forEach((l) => l())
}

export function startSession(kind: SessionKind, email?: string): void {
  set({ kind, createdAt: new Date().toISOString(), ...(email ? { email } : {}) })
}

export function endSession(): void {
  set(null)
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
    () => null,
  )
}
