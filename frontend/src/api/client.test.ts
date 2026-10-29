import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { ApiError, apiGet, isPassport } from './client'

afterEach(() => {
  vi.useRealTimers()
})

describe('API istemcisi', () => {
  it('yanıt gövdesini döndürür ve isteği API adresine gönderir', async () => {
    const fetchMock = stubFetch({ '/monuments': { body: { ok: true } } })
    await expect(apiGet('/monuments')).resolves.toEqual({ ok: true })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/monuments$/)
  })

  it('404 yanıtını durum koduyla birlikte ApiError olarak döndürür', async () => {
    stubFetch({ '/monuments/yok': { status: 404, body: { detail: "'yok' ID'li eser bulunamadı." } } })
    await expect(apiGet('/monuments/yok')).rejects.toMatchObject({ kind: 'http', status: 404, message: "'yok' ID'li eser bulunamadı." })
  })

  it('FastAPI doğrulama hata listesini okunabilir mesaja çevirir', async () => {
    stubFetch({ '/monuments': { status: 422, body: { detail: [{ msg: 'Birinci' }, { msg: 'İkinci' }] } } })
    await expect(apiGet('/monuments')).rejects.toMatchObject({ kind: 'http', status: 422, message: 'Birinci; İkinci' })
  })

  it('JSON olmayan hata gövdesinde genel mesaj kullanır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })))
    await expect(apiGet('/monuments')).rejects.toMatchObject({ kind: 'http', status: 502, message: 'Sunucu bir hata döndürdü (HTTP 502).' })
  })

  it('ağ hatasını "network" türünde bildirir', async () => {
    stubFetch({ '/monuments': new TypeError('Failed to fetch') })
    await expect(apiGet('/monuments')).rejects.toMatchObject({ kind: 'network' })
  })

  it('pasaport yalnızca istenen kullanıcıya aitse ve toplam listeyle tutarlıysa geçerlidir', () => {
    const stamp = { place_id: 'a', place_name: 'A', earned_at: '2026-10-12T10:30:00Z' }
    expect(isPassport({ user_id: 'u1', total_stamps: 1, stamps: [stamp] }, 'u1')).toBe(true)
    expect(isPassport({ user_id: 'u2', total_stamps: 1, stamps: [stamp] }, 'u1')).toBe(false)
    expect(isPassport({ user_id: 'u1', total_stamps: 2, stamps: [stamp] }, 'u1')).toBe(false)
    expect(isPassport({ user_id: 'u1', total_stamps: 1, stamps: [{ ...stamp, earned_at: 'dün' }] }, 'u1')).toBe(false)
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
    const result = apiGet('/monuments').catch((e: unknown) => e)
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
    const result = apiGet('/monuments', controller.signal).catch((e: unknown) => e)
    controller.abort()
    expect(await result).not.toBeInstanceOf(ApiError)
  })

  it('önceden iptal edilmiş sinyalle istek iptal edilmiş olarak başlar', async () => {
    const fetchMock = stubFetch({ '/monuments': { body: [] } })
    const controller = new AbortController()
    controller.abort()
    await apiGet('/monuments', controller.signal).catch(() => {})
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal!.aborted).toBe(true)
  })
})
