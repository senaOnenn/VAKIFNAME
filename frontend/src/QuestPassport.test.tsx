import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { API_BASE_URL } from './api/client'
import type { CheckInResponse, Place, Stamp } from './api/types'
import type { PlaceMapProps } from './components/PlaceMap'
import { DEMO_USER_STORAGE_KEY, getDemoUserId } from './demoUser'
import { PLACES, passportBody, passportPath, placeRoutes, stampFor, stubFetch, type Routes } from './test/fixtures'

// Harita bu dosyada test edilmez; App.test.tsx'teki gibi hafif bir yer tutucu kullanılır.
vi.mock('./components/PlaceMap', () => ({
  default: ({ places, onSelect }: PlaceMapProps) => (
    <ul aria-label="Harita işaretleyicileri">
      {places.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onSelect(p.id)}>
            İşaretleyici: {p.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}))

const [A, B] = PLACES
const checkInPath = (place: Place) => `/quests/${place.id}/check-in`

function response(place: Place, status: CheckInResponse['status'], stamp: Stamp | null): CheckInResponse {
  return {
    success: status !== 'out_of_range',
    status,
    message: 'backend mesajı',
    place_id: place.id,
    distance_m: status === 'out_of_range' ? 1234.5 : 0,
    allowed_radius_m: place.check_in_radius_m,
    stamp,
  }
}

/**
 * Backend'in check-in/pasaport davranışını taklit eden kontrollü sahte sunucu (backend/app/services.py ile aynı kurallar):
 * yarıçap içindeyse ilk denemede `completed`, sonrakilerde aynı mühürle `already_completed`; dışındaysa `out_of_range`.
 * `restart()` bellek içi ilerlemeyi siler.
 */
function fakeBackend(places: Place[] = PLACES) {
  const stamps = new Map<string, Stamp>()
  const requests: { path: string; body: Record<string, unknown> }[] = []
  const routes: Routes = {
    ...placeRoutes(places),
    [passportPath()]: () => ({ body: passportBody([...stamps.values()]) }),
  }
  const checkIn = (place: Place, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    requests.push({ path: checkInPath(place), body })
    if (body.latitude !== place.latitude || body.longitude !== place.longitude) {
      return { body: response(place, 'out_of_range', null) }
    }
    const existing = stamps.get(place.id)
    if (existing) return { body: response(place, 'already_completed', existing) }
    const stamp = stampFor(place)
    stamps.set(place.id, stamp)
    return { body: response(place, 'completed', stamp) }
  }
  for (const place of places) routes[checkInPath(place)] = (init) => checkIn(place, init)
  return { routes, requests, checkIn, restart: () => stamps.clear() }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const questSection = () => screen.getByRole('region', { name: 'Görevler' })
const questList = () => within(questSection()).getByRole('list', { name: 'Görev listesi' })
const questCard = (name: string) => within(questList()).getByRole('heading', { name }).closest('li')!
const panel = () => screen.getByRole('complementary', { name: 'Aktif görev' })
const passportSection = () => screen.getByRole('region', { name: 'Dijital Miras Pasaportu' })
const questAnnouncer = () => document.getElementById('quest-status')!
const demoButton = () => within(panel()).getByRole('button', { name: /Demo konumuyla görevi dene|Kontrol ediliyor/ })

async function renderApp(routes: Routes) {
  const fetchMock = stubFetch(routes)
  render(<App />)
  await screen.findByRole('list', { name: 'Görev listesi' })
  // Pasaport yüklenince görev durumları "Tekrar kontrol ediliyor" durumundan çıkar.
  await within(passportSection()).findByText('Toplam mühür')
  return fetchMock
}

async function startQuest(place: Place) {
  await userEvent.click(within(questList()).getByRole('button', { name: `Göreve başla: ${place.name}` }))
}

function totalStamps() {
  return within(passportSection()).getByText('Toplam mühür').nextElementSibling!.textContent
}

describe('görevler ekranı', () => {
  it('Görevler bölümü backend’den gelen her eseri bir görev kartı olarak gösterir', async () => {
    await renderApp(fakeBackend().routes)
    const items = within(questList()).getAllByRole('listitem')
    expect(items).toHaveLength(PLACES.length)
    for (const place of PLACES) {
      const card = questCard(place.name)
      expect(card).toHaveTextContent(place.city)
      expect(card).toHaveTextContent(place.description)
      expect(card).toHaveTextContent('Görev durumu: Henüz tamamlanmadı')
      expect(within(card).getByRole('button', { name: `Göreve başla: ${place.name}` })).toBeInTheDocument()
    }
  })

  it('eser listesi yüklenemezse görev uydurmaz ve ikinci bir alarm vermez', async () => {
    stubFetch({ '/places': new TypeError('Failed to fetch') })
    render(<App />)
    await screen.findAllByText(/Sunucuya ulaşılamadı/)
    expect(within(questSection()).getByText(/görevler şu anda gösterilemiyor/)).toBeInTheDocument()
    expect(within(questSection()).queryByRole('list')).not.toBeInTheDocument()
    expect(within(questSection()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('“Göreve başla” doğru eseri aktif görev yapar, odağı panele taşır ve GPS izni istemez', async () => {
    const getCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition, watchPosition: vi.fn() } })
    await renderApp(fakeBackend().routes)

    expect(within(panel()).getByText(/“Göreve başla”ya bas/)).toBeInTheDocument()
    await startQuest(B)

    expect(within(panel()).getByRole('heading', { name: B.name })).toBeInTheDocument()
    expect(panel()).toHaveFocus()
    // Aç/kapa düğmesi değil: açık görev `aria-current` ile belirtilir.
    expect(within(questList()).getByRole('button', { name: `Göreve başla: ${B.name}` })).toHaveAttribute('aria-current', 'true')
    expect(within(questList()).getByRole('button', { name: `Göreve başla: ${A.name}` })).not.toHaveAttribute('aria-current')
    expect(within(questList()).getByRole('button', { name: `Göreve başla: ${B.name}` })).not.toHaveAttribute('aria-pressed')
    expect(within(panel()).getByRole('note')).toHaveTextContent(
      /Demo check-in\..*Tarayıcı konumun istenmez.*\(0\.01000, 0\.01000\).*gerçek bir ziyaretin kanıtı değildir/,
    )
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('demo check-in, seçili eserin backend koordinatlarıyla gerçek API istemcisi üzerinden POST gönderir', async () => {
    const backend = fakeBackend()
    const fetchMock = await renderApp(backend.routes)
    await startQuest(B)
    await userEvent.click(demoButton())

    await within(panel()).findByText('Görev tamamlandı!')
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(checkInPath(B)))!
    expect(call[0]).toBe(`${API_BASE_URL}${checkInPath(B)}`)
    expect(call[1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'Content-Type': 'application/json' }) })
    expect(backend.requests).toEqual([
      { path: checkInPath(B), body: { user_id: getDemoUserId(), latitude: B.latitude, longitude: B.longitude } },
    ])
  })
})

describe('check-in sonuçları', () => {
  it('completed: başarı ve mühür gösterilir, pasaport backend’den yeniden okunur', async () => {
    const fetchMock = await renderApp(fakeBackend().routes)
    const passportCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(passportPath())).length
    const before = passportCalls()

    await startQuest(A)
    await userEvent.click(demoButton())

    const success = await within(panel()).findByText('Görev tamamlandı!')
    expect(success.closest('.notice')).toHaveTextContent(`pasaportuna ${A.name} mührü eklendi`)
    expect(within(panel()).getByRole('link', { name: 'Pasaportu gör' })).toHaveAttribute('href', '#pasaport')
    await waitFor(() => expect(totalStamps()).toBe('1'))
    expect(passportCalls()).toBe(before + 1)
    const stamps = within(passportSection()).getByRole('list', { name: 'Kazanılan mühürler' })
    expect(within(stamps).getByRole('heading', { name: A.name })).toBeInTheDocument()
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Tamamlandı')
    expect(questCard(B.name)).toHaveTextContent('Görev durumu: Henüz tamamlanmadı')
    // Son durum, check-in sonrası yeniden okunan pasaportla birlikte duyurulur.
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent(`${A.name} görevi tamamlandı. Pasaportuna mühür eklendi.`))
  })

  it('already_completed: aynı görev tekrarlanınca ikinci mühür gösterilmez', async () => {
    await renderApp(fakeBackend().routes)
    await startQuest(A)
    await userEvent.click(demoButton())
    await within(panel()).findByText('Görev tamamlandı!')
    await waitFor(() => expect(totalStamps()).toBe('1'))

    await userEvent.click(demoButton())
    expect(await within(panel()).findByText('Bu görev daha önce tamamlanmıştı.')).toBeInTheDocument()
    expect(within(panel()).queryByText('Görev tamamlandı!')).not.toBeInTheDocument()
    expect(panel().querySelector('.quest-success')).toBeNull()
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent('daha önce tamamlanmıştı. Yeni mühür eklenmedi.'))
    await waitFor(() => expect(totalStamps()).toBe('1'))
    expect(within(within(passportSection()).getByRole('list', { name: 'Kazanılan mühürler' })).getAllByRole('listitem')).toHaveLength(1)
  })

  it('out_of_range: başarısızlık olarak gösterilir, mühür ve kutlama yoktur', async () => {
    const backend = fakeBackend()
    await renderApp({ ...backend.routes, [checkInPath(A)]: { body: response(A, 'out_of_range', null) } })
    await startQuest(A)
    await userEvent.click(demoButton())

    const notice = await within(panel()).findByText('Konum görev alanı dışında')
    expect(notice.closest('.notice')).toHaveTextContent(/1\.234,5 m uzakta.*yarıçap 100 m.*mühür kazanılmadı/)
    expect(within(panel()).queryByText('Görev tamamlandı!')).not.toBeInTheDocument()
    expect(panel().querySelector('.quest-success')).toBeNull()
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent('konum görev alanı dışında'))
    await waitFor(() => expect(questCard(A.name)).toHaveTextContent('Görev durumu: Henüz tamamlanmadı'))
    expect(totalStamps()).toBe('0')
  })

  it('API hatası sahte başarı üretmez; “Tekrar dene” ile yeniden denenebilir', async () => {
    const backend = fakeBackend()
    let down = true
    await renderApp({
      ...backend.routes,
      [checkInPath(A)]: (init) => (down ? { status: 500, body: { detail: 'İç sunucu hatası' } } : backend.checkIn(A, init)),
    })
    await startQuest(A)
    await userEvent.click(demoButton())

    const title = await within(panel()).findByText('Check-in tamamlanamadı')
    // "Mühür yok" ancak check-in sonrası yeniden okunan pasaportla doğrulandıktan sonra söylenir.
    expect(title.closest('.notice')).toHaveTextContent(/İç sunucu hatası.*Pasaport kontrol edildi: bu eser için mühür yok/)
    expect(within(panel()).queryByText('Görev tamamlandı!')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(questAnnouncer()).toHaveTextContent('check-in tamamlanamadı. Pasaport kontrol edildi, bu eser için mühür yok'),
    )
    await waitFor(() => expect(questCard(A.name)).toHaveTextContent('Görev durumu: Hata'))
    expect(totalStamps()).toBe('0')

    down = false
    await userEvent.click(within(panel()).getByRole('button', { name: 'Tekrar dene' }))
    expect(demoButton()).toHaveFocus()
    expect(await within(panel()).findByText('Görev tamamlandı!')).toBeInTheDocument()
    await waitFor(() => expect(totalStamps()).toBe('1'))
  })

  it('ağ hatası ve beklenmeyen JSON yanıtı başarı olarak gösterilmez', async () => {
    const backend = fakeBackend()
    let broken: 'network' | 'json' = 'network'
    await renderApp({
      ...backend.routes,
      [checkInPath(A)]: () => (broken === 'network' ? new TypeError('Failed to fetch') : { body: { status: 'completed' } }),
    })
    await startQuest(A)
    await userEvent.click(demoButton())
    expect((await within(panel()).findByText('Check-in tamamlanamadı')).closest('.notice')).toHaveTextContent('Sunucuya ulaşılamadı')

    broken = 'json'
    await userEvent.click(demoButton())
    await within(panel()).findByText('Sunucudan beklenmeyen bir yanıt geldi.')
    expect(within(panel()).queryByText('Görev tamamlandı!')).not.toBeInTheDocument()
    await waitFor(() => expect(totalStamps()).toBe('0'))
  })

  it('art arda tıklama tek istek gönderir; istek sürerken buton meşgul görünür', async () => {
    const backend = fakeBackend()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fetchMock = await renderApp({
      ...backend.routes,
      [checkInPath(A)]: async (init) => {
        await gate
        return backend.checkIn(A, init)
      },
    })
    await startQuest(A)
    const button = demoButton()
    await userEvent.click(button)
    await userEvent.click(button)
    await userEvent.dblClick(button)

    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveTextContent('Kontrol ediliyor…')
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Tekrar kontrol ediliyor')
    release()
    await within(panel()).findByText('Görev tamamlandı!')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(checkInPath(A)))).toHaveLength(1)
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('uygulama kaldırılırsa süren check-in isteği iptal edilir', async () => {
    const backend = fakeBackend()
    let signal: AbortSignal | undefined
    const { unmount } = await (async () => {
      stubFetch({
        ...backend.routes,
        [checkInPath(A)]: (init) => {
          signal = init?.signal ?? undefined
          return new Promise(() => {})
        },
      })
      const result = render(<App />)
      await screen.findByRole('list', { name: 'Görev listesi' })
      return result
    })()
    await startQuest(A)
    await userEvent.click(demoButton())
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})

describe('dijital pasaport', () => {
  it('başlıkları, toplam mühür sayısını ve her mührün eser adı ile tarihini backend verisinden gösterir', async () => {
    const stamps = [stampFor(A, '2026-10-01T09:00:00Z'), stampFor(B, '2026-10-02T15:45:00Z')]
    await renderApp({ ...placeRoutes(), [passportPath()]: { body: passportBody(stamps) } })

    expect(within(passportSection()).getByText('VAKIFNAME')).toBeInTheDocument()
    expect(within(passportSection()).getByRole('heading', { level: 2, name: 'Dijital Miras Pasaportu' })).toBeInTheDocument()
    expect(totalStamps()).toBe('2')
    const items = within(within(passportSection()).getByRole('list', { name: 'Kazanılan mühürler' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByRole('heading', { name: A.name })).toBeInTheDocument()
    expect(items[0].querySelector('time')).toHaveAttribute('dateTime', '2026-10-01T09:00:00Z')
    expect(items[0]).toHaveTextContent(/Kazanıldı: .*2026/)
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Tamamlandı')
    expect(questCard(B.name)).toHaveTextContent('Görev durumu: Tamamlandı')
  })

  it('boş pasaport durumunu gösterir', async () => {
    await renderApp(fakeBackend().routes)
    expect(totalStamps()).toBe('0')
    expect(within(passportSection()).getByText('Pasaportun henüz boş.')).toBeInTheDocument()
    expect(within(passportSection()).queryByRole('list', { name: 'Kazanılan mühürler' })).not.toBeInTheDocument()
    expect(within(passportSection()).getByRole('link', { name: 'Görevler' })).toHaveAttribute('href', '#gorevler')
    // Boş mühür, bileşene verilen sınıfa ek olarak "kazanılmamış" stilini de taşır.
    const emptySeal = passportSection().querySelector('.passport__empty-seal')
    expect(emptySeal).toHaveClass('seal', 'seal--empty', 'passport__empty-seal')
  })

  it('backend yeniden başlayıp ilerlemeyi kaybederse mühür korunmuş gibi gösterilmez', async () => {
    const backend = fakeBackend()
    await renderApp(backend.routes)
    await startQuest(A)
    await userEvent.click(demoButton())
    await within(panel()).findByText('Görev tamamlandı!')
    await waitFor(() => expect(totalStamps()).toBe('1'))

    backend.restart()
    await userEvent.click(within(passportSection()).getByRole('button', { name: 'Pasaportu yenile' }))

    await waitFor(() => expect(totalStamps()).toBe('0'))
    expect(within(passportSection()).getByText('Pasaportun henüz boş.')).toBeInTheDocument()
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Henüz tamamlanmadı')
    expect(within(panel()).queryByText('Görev tamamlandı!')).not.toBeInTheDocument()
    // Duyuru, yeni veri işlendikten sonraki effect'te yazılır.
    await waitFor(() =>
      expect(within(passportSection()).getByRole('status')).toHaveTextContent('Pasaport yenilendi. Toplam 0 mühür.'),
    )
    expect(window.sessionStorage.getItem('vakifname.stamps')).toBeNull()
  })

  it('pasaport yüklenemezse mühür göstermez, görevleri “Hata” olarak işaretler ve yeniden denemeye izin verir', async () => {
    let up = false
    stubFetch({
      ...placeRoutes(),
      [passportPath()]: () => (up ? { body: passportBody([stampFor(A)]) } : { status: 503, body: { detail: 'Bakımda' } }),
    })
    render(<App />)
    const error = await within(passportSection()).findByText('Pasaport yüklenemedi')
    // Arka planda yüklenen bölüm sayfa açılışında alarm vermez.
    expect(error.closest('.notice')).not.toHaveAttribute('role')
    expect(within(passportSection()).queryByText('Toplam mühür')).not.toBeInTheDocument()
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Hata')

    up = true
    await userEvent.click(within(passportSection()).getByRole('button', { name: 'Tekrar dene' }))
    expect(within(passportSection()).getByRole('button', { name: 'Pasaportu yenile' })).toHaveFocus()
    await waitFor(() => expect(totalStamps()).toBe('1'))
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Tamamlandı')
  })
})

describe('check-in yanıtı kaybolursa sonuç pasaportla uzlaştırılır', () => {
  /** Sunucu isteği işler (gerekirse mühür ekler) ama yanıt istemciye ulaşmaz. */
  const lostResponse =
    (backend: ReturnType<typeof fakeBackend>, place: Place, processed = () => true) =>
    (init?: RequestInit) => {
      if (processed()) backend.checkIn(place, init)
      return new TypeError('Failed to fetch')
    }
  const passportRoute = (backend: ReturnType<typeof fakeBackend>) => backend.routes[passportPath()] as () => { body: unknown }
  const noContradiction = () => {
    expect(within(panel()).queryByText(/Mühür eklenmedi/)).not.toBeInTheDocument()
    expect(within(panel()).queryByText(/mühür yok/)).not.toBeInTheDocument()
  }

  it('sunucu işledi, yanıt kayboldu, pasaportta mühür var → önce doğrulanıyor, sonra tamamlandı; çelişkili hata yok', async () => {
    const backend = fakeBackend()
    const original = passportRoute(backend)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    await renderApp({
      ...backend.routes,
      [checkInPath(A)]: lostResponse(backend, A),
      [passportPath()]: async () => {
        if (++calls === 2) await gate
        return original()
      },
    })
    await startQuest(A)
    await userEvent.click(demoButton())

    // Pasaport yanıtı gelene kadar sonuç belirsizdir; kazanıldığı da kazanılmadığı da söylenmez.
    expect(await within(panel()).findByText('İşlem sonucu doğrulanamadı.')).toBeInTheDocument()
    expect(within(panel()).getByText(/pasaport kontrol ediliyor/)).toBeInTheDocument()
    noContradiction()
    expect(within(panel()).queryByText('Görev tamamlandı!')).not.toBeInTheDocument()
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Tekrar kontrol ediliyor')
    expect(questAnnouncer()).toHaveTextContent('check-in yanıtı alınamadı. İşlem sonucu doğrulanamadı, pasaport kontrol ediliyor.')

    release()
    expect(await within(panel()).findByText('Görev tamamlanmış')).toBeInTheDocument()
    expect(within(panel()).queryByText('Check-in tamamlanamadı')).not.toBeInTheDocument()
    noContradiction()
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Tamamlandı')
    expect(totalStamps()).toBe('1')
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent('pasaport görevin tamamlandığını doğruladı'))
  })

  it('yanıt kayboldu ve pasaport da yüklenemedi → sonuç belirsiz kalır; tekrar deneme ikinci mühür oluşturmaz', async () => {
    const backend = fakeBackend()
    const original = passportRoute(backend)
    let passportDown = false
    await renderApp({
      ...backend.routes,
      [checkInPath(A)]: (init) => {
        // İlk deneme: sunucu mührü ekler ama yanıt kaybolur ve pasaport servisi de geçici olarak yanıt vermez.
        if (!passportDown && backend.requests.length === 0) {
          passportDown = true
          return lostResponse(backend, A)(init)
        }
        passportDown = false
        return backend.checkIn(A, init)
      },
      [passportPath()]: () => (passportDown ? { status: 503, body: { detail: 'Geçici hata' } } : original()),
    })
    await startQuest(A)
    await userEvent.click(demoButton())

    const title = await within(panel()).findByText('İşlem sonucu doğrulanamadı')
    expect(title.closest('.notice')).toHaveTextContent(/Mührün eklenip eklenmediği şu anda bilinmiyor/)
    expect(title.closest('.notice')).toHaveTextContent(/ikinci mühür oluşturulmaz/)
    noContradiction()
    expect(within(panel()).queryByText(/Görev tamamlan/)).not.toBeInTheDocument()
    expect(within(passportSection()).queryByText('Toplam mühür')).not.toBeInTheDocument()
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent('mührün eklenip eklenmediği bilinmiyor'))

    // Tekrar deneme güvenlidir: backend aynı görev için var olan mührü döndürür.
    await userEvent.click(within(panel()).getByRole('button', { name: 'Tekrar dene' }))
    expect(await within(panel()).findByText('Bu görev daha önce tamamlanmıştı.')).toBeInTheDocument()
    await waitFor(() => expect(totalStamps()).toBe('1'))
    expect(within(within(passportSection()).getByRole('list', { name: 'Kazanılan mühürler' })).getAllByRole('listitem')).toHaveLength(1)
    expect(backend.requests).toHaveLength(2)
  })

  it('yanıt kayboldu ve pasaportta mühür yok → hata ve güvenli tekrar deneme; ardından gerçek başarı', async () => {
    const backend = fakeBackend()
    let lost = true
    await renderApp({
      ...backend.routes,
      [checkInPath(A)]: (init) => (lost ? lostResponse(backend, A, () => false)(init) : backend.checkIn(A, init)),
    })
    await startQuest(A)
    await userEvent.click(demoButton())

    const title = await within(panel()).findByText('Check-in tamamlanamadı')
    expect(title.closest('.notice')).toHaveTextContent(/Sunucuya ulaşılamadı.*Pasaport kontrol edildi: bu eser için mühür yok/)
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Hata')
    expect(totalStamps()).toBe('0')
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent('check-in tamamlanamadı. Pasaport kontrol edildi, bu eser için mühür yok'))

    lost = false
    await userEvent.click(within(panel()).getByRole('button', { name: 'Tekrar dene' }))
    expect(await within(panel()).findByText('Görev tamamlandı!')).toBeInTheDocument()
    await waitFor(() => expect(totalStamps()).toBe('1'))
  })

  it('check-in sürerken başlayan eski pasaport yanıtı “mühür yok” kanıtı sayılmaz', async () => {
    const backend = fakeBackend()
    const original = passportRoute(backend)
    let releaseCheckIn!: () => void
    const checkInGate = new Promise<void>((resolve) => (releaseCheckIn = resolve))
    let releaseOld!: () => void
    const oldGate = new Promise<void>((resolve) => (releaseOld = resolve))
    let calls = 0
    await renderApp({
      ...backend.routes,
      [checkInPath(A)]: async (init) => {
        await checkInGate
        return lostResponse(backend, A)(init)
      },
      [passportPath()]: async () => {
        // 2. istek check-in sürerken başlar ve mühür eklenmeden önceki durumu döndürür.
        if (++calls === 2) {
          const before = original()
          await oldGate
          return before
        }
        return original()
      },
    })
    await startQuest(A)
    await userEvent.click(demoButton())
    await userEvent.click(within(passportSection()).getByRole('button', { name: 'Pasaportu yenile' }))
    await waitFor(() => expect(calls).toBe(2))

    releaseCheckIn()
    expect(await within(panel()).findByText('Görev tamamlanmış')).toBeInTheDocument()
    releaseOld()
    await oldGate
    await new Promise((r) => setTimeout(r, 0))
    expect(within(panel()).getByText('Görev tamamlanmış')).toBeInTheDocument()
    noContradiction()
    expect(totalStamps()).toBe('1')
  })

  it('D1: check-in onaylandı ama pasaport yenilenemedi → anlaşılır uyarı ve pasaportu yeniden yükleme', async () => {
    const backend = fakeBackend()
    const original = passportRoute(backend)
    let calls = 0
    await renderApp({
      ...backend.routes,
      [passportPath()]: () => (++calls === 2 ? { status: 500, body: { detail: 'boom' } } : original()),
    })
    await startQuest(A)
    await userEvent.click(demoButton())

    const title = await within(panel()).findByText('Check-in onaylandı, pasaport yenilenemedi')
    expect(title.closest('.notice')).toHaveTextContent(/mühür pasaportunda henüz gösterilemiyor/)
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Hata')
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent('check-in onaylandı, ancak pasaport yenilenemedi'))

    await userEvent.click(within(panel()).getByRole('button', { name: 'Pasaportu yeniden yükle' }))
    expect(await within(panel()).findByText('Görev tamamlandı!')).toBeInTheDocument()
    await waitFor(() => expect(totalStamps()).toBe('1'))
    expect(questCard(A.name)).toHaveTextContent('Görev durumu: Tamamlandı')
  })
})

describe('geçersiz eser verisi', () => {
  it('görev yarıçapı geçersizse uygulama çökmez; anlaşılır hata gösterilir ve görev uydurulmaz', async () => {
    const broken = PLACES.map((p, i) => (i === 0 ? { ...p, check_in_radius_m: 0 } : p))
    stubFetch({ ...placeRoutes(), '/places': { body: broken } })
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Eserler yüklenemedi')
    expect(alert).toHaveTextContent('beklenmeyen bir yanıt')
    expect(await within(questSection()).findByText(/görevler şu anda gösterilemiyor/)).toBeInTheDocument()
    expect(within(questSection()).queryByRole('list', { name: 'Görev listesi' })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Ana menü' })).toBeInTheDocument()
  })
})

describe('pasaport yarış durumları', () => {
  it('gecikmiş eski pasaport yanıtı, sonradan gelen yeni veriyi ezmez', async () => {
    const backend = fakeBackend()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    backend.routes[passportPath()] = async () => {
      calls += 1
      // 2. istek (check-in sonrası yenileme) gecikir ve mühürsüz, eski bir yanıt döndürür.
      if (calls === 2) {
        await gate
        return { body: passportBody() }
      }
      return { body: passportBody(calls === 1 ? [] : [stampFor(A)]) }
    }
    await renderApp(backend.routes)

    await startQuest(A)
    await userEvent.click(demoButton())
    await waitFor(() => expect(calls).toBe(2))
    await userEvent.click(within(passportSection()).getByRole('button', { name: 'Pasaportu yenile' }))
    await waitFor(() => expect(totalStamps()).toBe('1'))

    release()
    await gate
    await new Promise((r) => setTimeout(r, 0))
    expect(totalStamps()).toBe('1')
    expect(within(passportSection()).getAllByRole('heading', { name: A.name })).toHaveLength(1)
  })
})

describe('demo oyuncu kimliği', () => {
  it('aynı oturumdaki check-in ve pasaport istekleri aynı kimliği kullanır; kimliğin hesap olmadığı belirtilir', async () => {
    const backend = fakeBackend()
    const fetchMock = await renderApp(backend.routes)
    const userId = window.sessionStorage.getItem(DEMO_USER_STORAGE_KEY)
    expect(userId).toMatch(/^demo-/)

    await startQuest(A)
    await userEvent.click(demoButton())
    await within(panel()).findByText('Görev tamamlandı!')
    await startQuest(B)
    await userEvent.click(demoButton())
    await within(panel()).findByText('Görev tamamlandı!')

    expect(backend.requests.map((r) => r.body.user_id)).toEqual([userId, userId])
    const passportUrls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/passport'))
    expect(new Set(passportUrls)).toEqual(new Set([`${API_BASE_URL}/users/${userId}/passport`]))
    expect(within(passportSection()).getByText(userId!)).toBeInTheDocument()
    expect(passportSection()).toHaveTextContent(/bir kullanıcı hesabı değildir ve güvenli kimlik doğrulama sağlamaz/)
  })
})

describe('navigasyon ve erişilebilirlik', () => {
  it('eser ayrıntısından ilgili göreve geçilir', async () => {
    await renderApp(fakeBackend().routes)
    await userEvent.click(screen.getByRole('button', { name: `Detayları gör: ${B.name}` }))
    const detail = screen.getByRole('complementary', { name: 'Eser ayrıntıları' })
    await userEvent.click(await within(detail).findByRole('button', { name: 'Bu eserin görevine git' }))

    expect(within(panel()).getByRole('heading', { name: B.name })).toBeInTheDocument()
    expect(panel()).toHaveFocus()
    // Mevcut eser seçimi ve ayrıntı paneli bozulmaz.
    expect(within(detail).getByRole('heading', { name: B.name })).toBeInTheDocument()
  })

  it('görev akışı yalnızca klavyeyle tamamlanır ve sonuç ekran okuyucuya duyurulur', async () => {
    await renderApp(fakeBackend().routes)
    expect(questAnnouncer()).toHaveAttribute('role', 'status')
    expect(questAnnouncer()).toBeEmptyDOMElement()

    within(questList()).getByRole('button', { name: `Göreve başla: ${A.name}` }).focus()
    await userEvent.keyboard('{Enter}')
    expect(panel()).toHaveFocus()

    await userEvent.tab()
    expect(demoButton()).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent(`${A.name} görevi tamamlandı.`))
    expect(demoButton()).toHaveFocus()

    // Aynı metin tekrar gelse bile yeni düğümle yazılır, böylece yeniden duyurulur.
    const first = questAnnouncer().firstElementChild
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(questAnnouncer()).toHaveTextContent('daha önce tamamlanmıştı'))
    expect(questAnnouncer().firstElementChild).not.toBe(first)
  })

  it('durumlar yalnızca renkle değil, simge ve metinle belirtilir', async () => {
    await renderApp({ ...placeRoutes(), [passportPath()]: { body: passportBody([stampFor(A)]) } })
    for (const [place, label] of [
      [A, 'Tamamlandı'],
      [B, 'Henüz tamamlanmadı'],
    ] as const) {
      const badge = questCard(place.name).querySelector('.quest-status')!
      expect(badge).toHaveTextContent(label)
      expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
