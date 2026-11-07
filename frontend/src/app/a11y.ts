import { useSyncExternalStore } from 'react'

/**
 * Erişilebilirlik ayarları (7 Kasım, şartname 5.1.4): yazı boyutu, yüksek kontrast, hareketi azaltma ve sorularda süre
 * sınırını kaldırma (WCAG 2.2.1 "süre ayarlanabilir"). Tarayıcıda saklanır (kişisel veri değildir, sunucuya gitmez);
 * sayfa açılırken `<html>` üzerine uygulanır: `data-vk-text`, `vk-hc` ve `vk-calm` sınıfları (bkz. design/a11y.css).
 */
export type TextSize = 'normal' | 'large' | 'xlarge'
export interface A11yPrefs {
  text: TextSize
  contrast: boolean
  calm: boolean
  untimed: boolean
}

export const A11Y_KEY = 'vakifname.a11y'
export const DEFAULT_PREFS: A11yPrefs = { text: 'normal', contrast: false, calm: false, untimed: false }

function read(): A11yPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(A11Y_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS
    return {
      text: raw.text === 'large' || raw.text === 'xlarge' ? raw.text : 'normal',
      contrast: raw.contrast === true,
      calm: raw.calm === true,
      untimed: raw.untimed === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

let current: A11yPrefs = typeof window === 'undefined' ? DEFAULT_PREFS : read()
const listeners = new Set<() => void>()

function apply(p: A11yPrefs) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (p.text === 'normal') delete root.dataset.vkText
  else root.dataset.vkText = p.text
  root.classList.toggle('vk-hc', p.contrast)
  root.classList.toggle('vk-calm', p.calm)
}
apply(current)

export function setA11y(patch: Partial<A11yPrefs>) {
  current = { ...current, ...patch }
  try {
    window.localStorage.setItem(A11Y_KEY, JSON.stringify(current))
  } catch {
    /* gizli sekme vb.: ayar yalnızca bu oturumda geçerli */
  }
  apply(current)
  listeners.forEach((l) => l())
}

export function getA11y(): A11yPrefs {
  return current
}

export function useA11y(): A11yPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => DEFAULT_PREFS,
  )
}

/** İşletim sisteminin "hareketi azalt" tercihi ya da sitedeki ayar. */
export function reducedMotion(): boolean {
  return current.calm || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Yalnızca testler: ayarları varsayılana döndürür. */
export function resetA11yForTests() {
  current = read()
  apply(current)
  listeners.forEach((l) => l())
}
