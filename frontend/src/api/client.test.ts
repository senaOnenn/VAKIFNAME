import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLACES, passportBody, stampFor, stubFetch } from '../test/fixtures'
import { ApiError, checkIn, getPassport, getPlace, getPlaces } from './client'
import type { CheckInResponse } from './types'

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

describe('check-in ve pasaport istemcisi', () => {
  const [A, B] = PLACES
  const completed: CheckInResponse = {
    success: true,
    status: 'completed',
    message: 'Görev tamamlandı; pasaporta mühür eklendi.',
    place_id: A.id,
    distance_m: 0,
    allowed_radius_m: 100,
    stamp: stampFor(A),
  }

  it('checkIn, JSON gövdeli POST isteği gönderir ve yer ID’sini kodlar', async () => {
    const fetchMock = stubFetch({ '/quests/a%2Fb/check-in': { body: { ...completed, place_id: 'a/b', stamp: { ...stampFor(A), place_id: 'a/b' } } } })
    await checkIn('a/b', 'demo-1', 41.5, 29.25)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/quests\/a%2Fb\/check-in$/)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ user_id: 'demo-1', latitude: 41.5, longitude: 29.25 })
  })

  it('üç backend durumunu da kabul eder; out_of_range bir hata değildir', async () => {
    const outOfRange = { ...completed, success: false, status: 'out_of_range', stamp: null, distance_m: 900 }
    for (const body of [completed, { ...completed, status: 'already_completed' }, outOfRange]) {
      stubFetch({ [`/quests/${A.id}/check-in`]: { body } })
      await expect(checkIn(A.id, 'demo-1', 0, 0)).resolves.toMatchObject({ status: body.status })
    }
  })

  it.each([
    ['mührü olmayan completed', { ...completed, stamp: null }],
    ['başka esere ait mühür', { ...completed, stamp: stampFor(B) }],
    ['mühürlü out_of_range', { ...completed, success: false, status: 'out_of_range' }],
    ['başarılı görünen out_of_range', { ...completed, status: 'out_of_range', stamp: null }],
    ['bilinmeyen durum', { ...completed, status: 'done' }],
    ['başka eserin yanıtı', { ...completed, place_id: B.id, stamp: stampFor(B) }],
    ['geçersiz tarih', { ...completed, stamp: { ...stampFor(A), earned_at: 'dün' } }],
  ])('tutarsız check-in yanıtını reddeder: %s', async (_name, body) => {
    stubFetch({ [`/quests/${A.id}/check-in`]: { body } })
    await expect(checkIn(A.id, 'demo-1', 0, 0)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('check-in HTTP hatalarını backend mesajıyla bildirir (ör. 404, 422)', async () => {
    stubFetch({ '/quests/yok/check-in': { status: 404, body: { detail: "'yok' ID'li eser bulunamadı." } } })
    await expect(checkIn('yok', 'demo-1', 0, 0)).rejects.toMatchObject({ kind: 'http', status: 404 })
    stubFetch({ [`/quests/${A.id}/check-in`]: { status: 422, body: { detail: [{ msg: 'Input should be less than or equal to 90' }] } } })
    await expect(checkIn(A.id, 'demo-1', 91, 0)).rejects.toMatchObject({ kind: 'http', status: 422 })
  })

  it('check-in zaman aşımına uğrarsa "timeout" hatası verir', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
      ),
    )
    const result = checkIn(A.id, 'demo-1', 0, 0).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toMatchObject({ kind: 'timeout' })
  })

  it('getPassport kullanıcı ID’sini kodlar ve pasaportu döndürür', async () => {
    const fetchMock = stubFetch({ '/users/demo%20x/passport': { body: passportBody([stampFor(A)], 'demo x') } })
    await expect(getPassport('demo x')).resolves.toMatchObject({ total_stamps: 1 })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/users\/demo%20x\/passport$/)
  })

  it.each([
    ['toplam ile liste uyuşmuyor', { ...passportBody([stampFor(A)], 'demo-1'), total_stamps: 2 }],
    ['başka kullanıcının pasaportu', passportBody([], 'demo-2')],
    ['mühür listesi yok', { user_id: 'demo-1', total_stamps: 0 }],
  ])('tutarsız pasaport yanıtını reddeder: %s', async (_name, body) => {
    stubFetch({ '/users/demo-1/passport': { body } })
    await expect(getPassport('demo-1')).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})
