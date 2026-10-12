import { vi } from 'vitest'
import type { Place } from '../api/types'

// Yalnızca testler için kurgusal kayıtlar; gerçek eserleri temsil etmez.
export const PLACES: Place[] = [
  {
    id: 'test-a',
    name: 'Test Mekânı A',
    city: 'Test Şehri',
    description: 'Birinci kurgusal test kaydı.',
    latitude: 0,
    longitude: 0,
    check_in_radius_m: 100,
    source_title: null,
    source_url: null,
    is_demo: true,
  },
  {
    id: 'test-b',
    name: 'Test Mekânı B',
    city: 'Örnek Şehir',
    description: 'İkinci kurgusal test kaydı.',
    latitude: 0.01,
    longitude: 0.01,
    check_in_radius_m: 50,
    source_title: 'Örnek Kaynak',
    source_url: 'https://example.org/kaynak',
    is_demo: true,
  },
]

// `is_demo: false` taşıyan kurgusal test kaydı. Yalnızca "gerçek eser kaydı" gösterimini test etmek içindir;
// tarihî bakımdan doğrulanmış gerçek bir eser değildir ve kaynağı yoktur.
export const REAL_TYPE_PLACE: Place = {
  id: 'test-gercek-tipli',
  name: 'Test Mekânı G',
  city: 'Test Şehri',
  description: 'Gerçek-tipli kurgusal test kaydı.',
  latitude: 0.02,
  longitude: 0.02,
  check_in_radius_m: 75,
  source_title: null,
  source_url: null,
  is_demo: false,
}

type Route ={ status?: number; body: unknown } | Error
export type Routes = Record<string, Route | (() => Route)>

/** `fetch` yerine geçer; URL yoluna göre yanıt döndürür. Tanımsız yol için 404. */
export function stubFetch(routes: Routes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    const entry = routes[path]
    const route = typeof entry === 'function' ? entry() : entry
    if (route instanceof Error) throw route
    const { status = 200, body } = route ?? { status: 404, body: { detail: 'Not Found' } }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const placeRoutes = (places: Place[] = PLACES): Routes => ({
  '/places': { body: places },
  ...Object.fromEntries(places.map((p) => [`/places/${p.id}`, { body: p }])),
})
