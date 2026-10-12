import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLACES, stubFetch } from '../test/fixtures'
import { ApiError, getPlace, getPlaces } from './client'

afterEach(() => {
  vi.useRealTimers()
})

describe('API istemcisi', () => {
  it('eser ID’sini URL’de kodlar', async () => {
    const fetchMock = stubFetch({ '/places/a%2Fb%20c': { body: PLACES[0] } })
    await getPlace('a/b c')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/places\/a%2Fb%20c$/)
  })

  it('404 yanıtını durum koduyla birlikte ApiError olarak döndürür', async () => {
    stubFetch({ '/places/yok': { status: 404, body: { detail: "'yok' ID'li eser bulunamadı." } } })
    await expect(getPlace('yok')).rejects.toMatchObject({ kind: 'http', status: 404, message: "'yok' ID'li eser bulunamadı." })
  })

  it('FastAPI doğrulama hata listesini okunabilir mesaja çevirir', async () => {
    stubFetch({ '/places': { status: 422, body: { detail: [{ msg: 'Birinci' }, { msg: 'İkinci' }] } } })
    await expect(getPlaces()).rejects.toMatchObject({ kind: 'http', status: 422, message: 'Birinci; İkinci' })
  })

  it('JSON olmayan hata gövdesinde genel mesaj kullanır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })))
    await expect(getPlaces()).rejects.toMatchObject({ kind: 'http', status: 502, message: 'Sunucu bir hata döndürdü (HTTP 502).' })
  })

  it('ağ hatasını "network" türünde bildirir', async () => {
    stubFetch({ '/places': new TypeError('Failed to fetch') })
    await expect(getPlaces()).rejects.toMatchObject({ kind: 'network' })
  })

  it('eksik alanlı eser verisini reddeder', async () => {
    const { name: _omitted, ...withoutName } = PLACES[0]
    stubFetch({ '/places': { body: [withoutName] } })
    await expect(getPlaces()).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('yanıt gelmezse zaman aşımı hatası verir', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
      ),
    )
    const result = getPlaces().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    const error = await result
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'timeout' })
  })

  it('çağıran iptal ederse ApiError üretmez', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
      ),
    )
    const controller = new AbortController()
    const result = getPlaces(controller.signal).catch((e: unknown) => e)
    controller.abort()
    expect(await result).not.toBeInstanceOf(ApiError)
  })

  it('önceden iptal edilmiş sinyalle istek iptal edilmiş olarak başlar', async () => {
    const fetchMock = stubFetch({ '/places': { body: [] } })
    const controller = new AbortController()
    controller.abort()
    await getPlaces(controller.signal).catch(() => {})
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal!.aborted).toBe(true)
  })
})
