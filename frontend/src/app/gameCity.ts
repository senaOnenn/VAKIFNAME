import { useSyncExternalStore } from 'react'

/** Oyun panelinin hatırladığı son şehir rotası (yalnızca gezinme kolaylığı; ilerleme sunucudadır). */
const KEY = 'vakifname.gameCity'
const listeners = new Set<() => void>()

export function rememberGameCity(slug: string) {
  if (lastGameCity() === slug) return
  try {
    window.localStorage.setItem(KEY, slug)
  } catch {
    /* yoksay */
  }
  listeners.forEach((l) => l())
}

/** Son şehir değişince (rota veya eserin mühür yolu açılınca) oyun menüsü yeniden çizilir. */
export function useLastGameCity(): string | null {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), lastGameCity)
}

export function lastGameCity(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Oyun adresleri tek yerden üretilir (rota, eserin mühür yolu, Rozeti Al soruları). */
export const gamePath = {
  home: '/oyun',
  cities: '/oyun/sehir',
  route: (city: string) => `/oyun/rota/${city}`,
  monument: (id: string) => `/oyun/eser/${encodeURIComponent(id)}`,
  quiz: (id: string) => `/oyun/eser/${encodeURIComponent(id)}/rozet`,
}
