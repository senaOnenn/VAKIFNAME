import { vi } from 'vitest'
type Route = { status?: number; body: unknown } | Error
/** Fonksiyon olan yollar istek ayrıntılarını (yöntem, gövde) alır ve yanıtı geciktirmek için Promise döndürebilir. */
export type Routes = Record<string, Route | ((init?: RequestInit) => Route | Promise<Route>)>

/** `fetch` yerine geçer; URL yoluna göre yanıt döndürür. Tanımsız yol için 404. */
export function stubFetch(routes: Routes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const entry = routes[path]
    const route = typeof entry === 'function' ? await entry(init) : entry
    if (route instanceof Error) throw route
    const { status = 200, body } = route ?? { status: 404, body: { detail: 'Not Found' } }
    // 204/205/304 yanıtları gövde taşıyamaz (Response kurucusu reddeder).
    if (status === 204 || status === 205 || status === 304) return new Response(null, { status })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
