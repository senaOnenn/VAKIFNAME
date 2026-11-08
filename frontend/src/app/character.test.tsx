import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE, progressOf, SIGNED_IN, stubFetch, type Routes } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { resetAuthForTests } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

/** R6.3 karakter seçimi: yalnızca hesapla; ilk oyunda seçilir, varsayılan atanmaz; sonraki girişlerde kayıtlı kâşifle devam. */
const NONE = { body: { character: null, progress: progressOf(0) } }
const CATALOG = { body: { published_count: 0, data_version: 't', generated_at: null, monuments: [] } }

function open(path: string, routes: Routes) {
  const fetchMock = stubFetch({ '/monuments': CATALOG, ...routes })
  window.history.replaceState(null, '', path)
  render(<VakifnameApp />)
  return fetchMock
}
const paths = (f: ReturnType<typeof stubFetch>) => f.mock.calls.map((c) => [new URL(String(c[0])).pathname, (c[1] as RequestInit | undefined)?.method ?? 'GET'])

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('karakter seçimi (R6.3)', () => {
  it('misafir karakter seçemez: seçim ekranı girişe yönlenir, profil istenmez', async () => {
    window.localStorage.setItem('vakifname.guest', '1')
    const f = open('/oyun/karakter', { '/auth/me': { status: 401, body: {} } })
    expect(await screen.findByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
    expect(paths(f).some(([p]) => p.startsWith('/player/'))).toBe(false)
  })

  it('ilk oyunda seçim ekranı açılır; seçilmeden ilerlenmez; klavyeyle seçilir ve istenen oyun adresine dönülür', async () => {
    let saved: unknown = null
    const f = open('/oyun/rota/bursa', {
      '/auth/me': SIGNED_IN,
      '/player/profile': () => (saved ? { body: saved } : NONE),
      '/player/character': (init?: RequestInit) => {
        const id = JSON.parse(String(init?.body)).character_id
        saved = { character: { id, chosen_at: '2026-11-06T10:00:00+00:00' }, progress: progressOf(0) }
        return { body: saved }
      },
      '/route': { status: 404, body: { detail: 'yok' } },
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Kâşifini seç' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/oyun/karakter')
    expect(new URLSearchParams(window.location.search).get('sonra')).toBe('/oyun/rota/bursa')
    // Varsayılan yok: hiçbir kâşif seçili değil, düğme kapalı, sunucuya yazılmadı.
    const go = await screen.findByRole('button', { name: 'Seç ve maceraya başla' })
    expect(go).toBeDisabled()
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true)
    expect(paths(f).some(([p, m]) => p === '/player/character' && m === 'PUT')).toBe(false)
    // R6.5: her nişte kâşifin portresi çizilidir (geçici amblem ya da boş alan yok); karakterler yalnızca görünüştür.
    expect(document.querySelectorAll('.vk-cs__arch img[data-character]')).toHaveLength(2)
    // 8 Kasım: seçim ekranında her zaman en üst seviye görseli (Başkâşif).
    expect([...document.querySelectorAll('.vk-cs__arch img')].map((i) => i.getAttribute('data-stage'))).toEqual(['muhafiz', 'muhafiz'])
    expect(screen.queryByText('Geçici görünüm')).not.toBeInTheDocument()
    expect(screen.getAllByText('Yolların ve eserlerin izinde')).toHaveLength(2)
    expect(screen.getByText(/yalnızca görünüştür; oyunda ikisi de aynı kurallarla ilerler/)).toBeInTheDocument()
    // Klavye: Tab ile gruba girilir, boşlukla seçilir, oklarla değişir.
    const radios = screen.getAllByRole('radio')
    radios[0].focus()
    await userEvent.keyboard(' ')
    expect(radios[0]).toBeChecked()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Erkek kâşif' })).toBeChecked()
    expect(go).toBeEnabled()
    await userEvent.click(go)
    await waitFor(() => expect(window.location.pathname).toBe('/oyun/rota/bursa'))
    const put = f.mock.calls.find((c) => new URL(String(c[0])).pathname === '/player/character')!
    expect((put[1] as RequestInit).method).toBe('PUT')
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ character_id: 'erkek' })
    expect(await screen.findByRole('link', { name: 'Kâşifin Erkek kâşif. Kâşifini değiştir' })).toBeInTheDocument()
  })

  it('karakterini seçmiş oyuncu seçim ekranını görmeden oyuna girer', async () => {
    open('/oyun/sehir', { '/auth/me': SIGNED_IN, '/player/profile': PROFILE })
    expect(await screen.findByRole('heading', { name: 'Nereyi keşfetmek istersin?' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/oyun/sehir')
    expect(screen.getByRole('link', { name: 'Kâşifin Erkek kâşif. Kâşifini değiştir' })).toBeInTheDocument()
  })

  it('kâşif sonradan değiştirilebilir: mevcut seçim işaretli gelir, kayıttan sonra aynı sayfaya dönülür', async () => {
    open('/oyun/sehir', {
      '/auth/me': SIGNED_IN,
      '/player/profile': PROFILE,
      '/player/character': { body: { character: { id: 'kadin', chosen_at: '2026-11-01T10:00:00+00:00' }, progress: progressOf(0) } },
    })
    await userEvent.click(await screen.findByRole('link', { name: 'Kâşifin Erkek kâşif. Kâşifini değiştir' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kâşifini değiştir' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Erkek kâşif' })).toBeChecked())
    await userEvent.click(screen.getByRole('radio', { name: 'Kadın kâşif' }))
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve devam et' }))
    await waitFor(() => expect(window.location.pathname).toBe('/oyun/sehir'))
  })

  it('profil yüklenemezse oyun açılmaz ve varsayılan karakter atanmaz; kayıt hatası açıkça söylenir', async () => {
    const f = open('/oyun', { '/auth/me': SIGNED_IN, '/player/profile': { status: 500, body: { detail: 'Sunucu hatası' } } })
    expect(await screen.findByText(/Oyuncu bilgileri alınamadı; yeniden dene/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Kayıp Vakfiye', level: 1 })).not.toBeInTheDocument()
    expect(paths(f).some(([p]) => p === '/route' || p === '/player/character')).toBe(false)
    vi.unstubAllGlobals()
  })

  it('kaydetme reddedilirse seçim ekranında kalınır ve neden gösterilir', async () => {
    open('/oyun/karakter', {
      '/auth/me': SIGNED_IN,
      '/player/profile': NONE,
      '/player/character': { status: 401, body: { detail: 'Oyunu oynamak ve ilerlemeni görmek için giriş yapmalısın.' } },
    })
    await userEvent.click(await screen.findByRole('radio', { name: 'Erkek kâşif' }))
    await userEvent.click(screen.getByRole('button', { name: 'Seç ve maceraya başla' }))
    expect(await screen.findByText('Oturumunun süresi doldu. Devam etmek için yeniden giriş yap.')).toHaveAttribute('role', 'alert')
    expect(window.location.pathname).toBe('/oyun/karakter')
  })
})
