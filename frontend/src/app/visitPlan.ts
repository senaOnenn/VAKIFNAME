import { useCallback, useEffect, useState } from 'react'

/**
 * R4 keşif rotası: ziyaretçinin haritadan seçtiği eserler, kendi belirlediği sırayla. Oyun rotasından (görev sırası,
 * kilitler, mühürler; sunucuda) tamamen bağımsızdır: sunucuya gitmez, oyun ilerlemesine yazılmaz. Yalnızca bu tarayıcıda
 * kolaylık olarak saklanır (depolama kapalıysa sayfa yine çalışır, plan oturum boyunca bellekte kalır).
 * Mesafe/süre hesaplanmaz: sistemde yürüyüş yolu verisi yok (yalnızca sıra).
 */
const KEY = 'vakifname.visitPlan.v1'
export const MAX_STOPS = 30

export function loadPlan(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_STOPS) : []
  } catch {
    return []
  }
}

export const addStop = (plan: string[], id: string) => (plan.includes(id) || plan.length >= MAX_STOPS ? plan : [...plan, id])
export const removeStop = (plan: string[], id: string) => plan.filter((x) => x !== id)
/** Durağı `delta` kadar kaydırır (-1 öne, +1 arkaya); sınırda değişmez. */
export function moveStop(plan: string[], id: string, delta: -1 | 1): string[] {
  const i = plan.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= plan.length) return plan
  const out = [...plan]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

export function useVisitPlan() {
  const [plan, setPlan] = useState<string[]>(loadPlan)
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(plan))
    } catch {
      /* depolama kapalı: plan yalnızca bu oturumda kalır */
    }
  }, [plan])
  return {
    plan,
    add: useCallback((id: string) => setPlan((p) => addStop(p, id)), []),
    remove: useCallback((id: string) => setPlan((p) => removeStop(p, id)), []),
    move: useCallback((id: string, delta: -1 | 1) => setPlan((p) => moveStop(p, id, delta)), []),
    reset: useCallback(() => setPlan([]), []),
  }
}
