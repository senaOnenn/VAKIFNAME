import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet } from '../api/client'
import { getVisitorId } from '../visitor'
import type { AuthState } from './session'

export { getMonument, getMonuments, mediaUrl } from '../catalog/catalogClient'
export type { MonumentDetail, MonumentSummary, MonumentFact, MonumentImage } from '../catalog/types'

/** İlerleme kimliği: hesap varsa hesap kimliği (çerezle korunur), yoksa bu tarayıcının misafir kimliği. */
export function progressId(auth: AuthState): string {
  return auth.status === 'user' ? auth.user.user_id : getVisitorId()
}

const WITH_COOKIE = { credentials: 'include' as const }

// --- Rota (GET /route): sözleşme backend/app/route_routes.py ile aynıdır ---------------------------------------------
export type StopState = 'unlocked' | 'locked'
export interface RouteStop {
  monument_id: string
  name: string
  type: string
  latitude: number
  longitude: number
  state: StopState
  distance_m: number
  order: number
}
export interface CompletedStop {
  monument_id: string
  name: string
  earned_at: string
  /** Ziyaret mührü de varsa mühür altındır. */
  visit: boolean
}
export interface RouteResult {
  city: string
  total: number
  completed_count: number
  start: { source: 'user' | 'last_completed' | 'city_center'; latitude: number; longitude: number }
  next: string | null
  stops: RouteStop[]
  completed: CompletedStop[]
}

const isRoute = (v: unknown): v is RouteResult =>
  !!v && typeof v === 'object' && Array.isArray((v as RouteResult).stops) && Array.isArray((v as RouteResult).completed)

export async function getRoute(
  city: string,
  userId: string,
  pos?: { latitude: number; longitude: number } | null,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const q = new URLSearchParams({ city, user_id: userId })
  if (pos) {
    q.set('lat', pos.latitude.toFixed(6))
    q.set('lng', pos.longitude.toFixed(6))
  }
  const body = await apiGet(`/route?${q}`, signal, WITH_COOKIE)
  if (!isRoute(body)) throw new Error('Rota yanıtı beklenen biçimde değil.')
  return body
}

/** Eser kimliği → kilit/tamamlanma durumu (rota yüklenemezse boş). */
export type MonumentStatus = 'completed' | 'gold' | StopState
export function statusMap(route: RouteResult | null): Record<string, MonumentStatus> {
  const out: Record<string, MonumentStatus> = {}
  if (!route) return out
  for (const s of route.stops) out[s.monument_id] = s.state
  for (const c of route.completed) out[c.monument_id] = c.visit ? 'gold' : 'completed'
  return out
}

// --- Küçük veri yükleme kancası ------------------------------------------------------------------------------------
export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** `load` her `deps` değişiminde çağrılır; önceki istek iptal edilir. */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  const fn = useRef(load)
  fn.current = load
  useEffect(() => {
    const ctl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    fn.current(ctl.signal).then(
      (data) => !ctl.signal.aborted && setState({ data, error: null, loading: false }),
      (e: unknown) => !ctl.signal.aborted && setState({ data: null, error: e instanceof Error ? e.message : 'Yüklenemedi.', loading: false }),
    )
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

// --- Etiketler -----------------------------------------------------------------------------------------------------
export const TYPE_LABEL: Record<string, string> = {
  cami: 'Cami',
  medrese: 'Medrese',
  türbe: 'Türbe',
  han: 'Han',
  bedesten: 'Bedesten',
  hamam: 'Hamam',
  çeşme: 'Çeşme',
}
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toLocaleUpperCase('tr') + t.slice(1)

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km`
}

/** Şehir adını adres çubuğundaki biçime çevirir (İzmir → izmir). */
export function citySlug(name: string): string {
  return name
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
}
