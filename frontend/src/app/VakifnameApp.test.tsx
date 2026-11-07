import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { progressOf, stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { resetAuthForTests } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

const PASSWORD = 'dogru-parola-1'
type User = { user_id: string; email: string; display_name: null; provider: 'password' | 'google' }

/** `/auth/*` uçlarını taklit eden küçük sahte sunucu; yapılan istekleri `calls` içinde tutar. */
function fakeAuthServer(initial: User | null = null) {
  let user: User | null = initial
  const accounts = new Map<string, User>()
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
  const body = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : {})
  const log = (path: string, init?: RequestInit) => calls.push({ path, method: init?.method ?? 'GET', body: body(init) })
  // R6.3: oyuncu profili. Bu sahte sunucuda kayıtla yeni açılan hesabın karakteri yoktur (ilk oyun); diğer hesaplar
  // karakterini daha önce seçmiştir.
  const chars = new Map<string, string | null>()
  const characterOf = (id: string) => (chars.has(id) ? chars.get(id)! : 'gezgin')
  const fetchMock = stubFetch({
    '/auth/me': (init?: RequestInit) => {
      log('/auth/me', init)
      if (init?.method === 'DELETE') {
        if (!user) return { status: 401, body: { detail: 'Oturum açık değil.' } }
        accounts.delete(user.email)
        user = null
        return { status: 204, body: null }
      }
      return user ? { body: user } : { status: 401, body: { detail: 'Oturum açık değil.' } }
    },
    '/auth/register': (init?: RequestInit) => {
      log('/auth/register', init)
      const b = body(init)
      if (accounts.has(b.email)) return { status: 409, body: { detail: 'Bu e-posta adresiyle kayıtlı bir hesap zaten var.' } }
      user = { user_id: `u-${accounts.size + 1}`, email: b.email, display_name: null, provider: 'password' }
      accounts.set(b.email, user)
      chars.set(user.user_id, null)
      return { status: 201, body: user }
    },
    '/auth/login': (init?: RequestInit) => {
      log('/auth/login', init)
      const b = body(init)
      const found = accounts.get(b.email)
      if (!found || b.password !== PASSWORD) return { status: 401, body: { detail: 'E-posta veya parola hatalı.' } }
      user = found
      return { body: user }
    },
    '/auth/logout': (init?: RequestInit) => {
      log('/auth/logout', init)
      user = null
      return { status: 204, body: null }
    },
    '/player/profile': (init?: RequestInit) => {
      log('/player/profile', init)
      if (!user) return { status: 401, body: { detail: 'Oyunu oynamak ve ilerlemeni görmek için giriş yapmalısın.' } }
      const id = characterOf(user.user_id)
      return { body: { character: id ? { id, chosen_at: '2026-11-01T10:00:00+00:00' } : null, progress: progressOf(0) } }
    },
    '/player/character': (init?: RequestInit) => {
      log('/player/character', init)
      if (!user) return { status: 401, body: { detail: 'Oyunu oynamak ve ilerlemeni görmek için giriş yapmalısın.' } }
      const id = String(body(init).character_id)
      if (!['gezgin', 'nakkas', 'katip'].includes(id)) return { status: 422, body: { detail: 'Geçersiz karakter.' } }
      chars.set(user.user_id, id)
      return { body: { character: { id, chosen_at: '2026-11-06T10:00:00+00:00' }, progress: progressOf(0) } }
    },
  })
  return { fetchMock, calls, accounts, signIn: (u: User) => ((user = u), accounts.set(u.email, u)) }
}

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

const AUTH_HEADING = { name: 'Maceraya katıl' }
const CITY_HEADING = { name: 'Nereyi keşfetmek istersin?' }
const LANDING_HEADING = { level: 1, name: 'Geçmişi Keşfet, Mirası Yaşat.' }

beforeEach(() => {
  resetAuthForTests()
  window.sessionStorage.clear()
  window.localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('açılış', () => {
  it('VAKIFNAME yazısını gösterir ve süre dolunca tanıtım sayfasına geçer', async () => {
    fakeAuthServer()
    vi.useFakeTimers()
    open('/')
    expect(screen.getByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(5300)
    })
    expect(screen.getByRole('heading', LANDING_HEADING)).toBeInTheDocument()
    expect(window.sessionStorage.getItem(INTRO_SEEN_KEY)).toBe('1')
  })

  it('"Geç" düğmesi açılışı atlar', async () => {
    fakeAuthServer()
    open('/')
    await userEvent.click(screen.getByRole('button', { name: 'Geç' }))
    expect(await screen.findByRole('heading', LANDING_HEADING)).toBeInTheDocument()
    expect(window.sessionStorage.getItem(INTRO_SEEN_KEY)).toBe('1')
  })

  it('tanıtım oyunun mühürlerini anlatır; final ekranı yok, aydınlatma metni bağlantısı korunur (R6.2)', async () => {
    fakeAuthServer()
    window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    open('/')
    expect(await screen.findByRole('heading', LANDING_HEADING)).toBeInTheDocument()
    // R6.1: mühürler "Oyun Nasıl Oynanır?" penceresinde anlatılır (adım adım, gerçek mühür türleriyle).
    await userEvent.click(screen.getByRole('button', { name: 'Oyun Nasıl Oynanır?' }))
    const how = await screen.findByRole('dialog', { name: 'Oyun nasıl oynanır?' })
    expect(within(how).getByRole('img', { name: 'Bilgi mührü' })).toBeInTheDocument()
    expect(within(how).getByRole('img', { name: 'Altın mühür' })).toBeInTheDocument()
    await userEvent.click(within(how).getByRole('button', { name: 'Kapat' }))
    // R6.2: hikâye oyun tanıtımıyla biter; final ekranı (slogan tekrarı, "Uygulamaya geç", "Giriş yap veya hesap aç") yok.
    expect(screen.getAllByText('Geçmişi Keşfet, Mirası Yaşat.')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Uygulamaya geç' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Giriş yap veya hesap aç' })).not.toBeInTheDocument()
    expect(document.querySelector('.vk-final')).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Aydınlatma metni' }))
    expect(await screen.findByRole('heading', { name: 'Aydınlatma metni' })).toBeInTheDocument()
  })

  it('tanıtımdan üye olmadan halka açık bölümlere geçilebilir (misafir)', async () => {
    fakeAuthServer()
    window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    open('/')
    await screen.findByRole('heading', LANDING_HEADING)
    await userEvent.click(within(screen.getAllByRole('navigation', { name: 'Ana menü' })[0]).getByRole('link', { name: 'Harita' }))
    expect(window.location.pathname).toBe('/harita')
    expect(await screen.findByText('Misafir')).toBeInTheDocument()
  })

  it('oturumu olan kullanıcı da ana sayfayı görür; menüden oyuna geçer', async () => {
    fakeAuthServer({ user_id: 'u-9', email: 'ali@example.com', display_name: null, provider: 'password' })
    window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    open('/')
    expect(await screen.findByRole('heading', LANDING_HEADING)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Hesap: ali@example.com' })).toHaveAttribute('href', '/hesap')
    await userEvent.click(within(screen.getAllByRole('navigation', { name: 'Ana menü' })[0]).getByRole('link', { name: 'Oyun' }))
    expect(window.location.pathname).toBe('/oyun')
  })
})

describe('giriş / kayıt (sunucu)', () => {
  beforeEach(() => window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'))

  it('üye olmadan keşfet halka açık eserlere götürür; misafir yenilemede misafir kalır ama oyuna giremez (R6.2)', async () => {
    fakeAuthServer()
    const { unmount } = open('/giris')
    await userEvent.click(await screen.findByRole('button', { name: 'Üye olmadan keşfet' }))
    expect(window.location.pathname).toBe('/eserler')
    expect(await screen.findByText('Misafir')).toBeInTheDocument()
    unmount()
    resetAuthForTests()
    window.localStorage.setItem('vakifname.guest', '1')
    open('/sehir')
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
    expect(window.location.pathname).toBe('/giris')
    expect(new URLSearchParams(window.location.search).get('sonra')).toBe('/oyun/sehir')
  })

  it('istemci doğrulaması hatalı girdide sunucuya gitmez', async () => {
    const { calls } = fakeAuthServer()
    open('/giris')
    await userEvent.type(await screen.findByLabelText('E-posta'), 'yanlis')
    await userEvent.type(screen.getByLabelText('Parola'), 'kisa')
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    expect(screen.getByText('Geçerli bir e-posta adresi yaz.')).toBeInTheDocument()
    expect(screen.getByText('Parola en az 8 karakter olmalı.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false)
  })

  it('kayıt sunucuda hesap açar, misafir kimliğini gönderir ve şehir seçimine götürür', async () => {
    const { calls } = fakeAuthServer()
    window.localStorage.setItem('vakifname.visitorId', 'ziyaretci-0b8f2c1e-1a2b-4c3d-8e9f-0123456789ab')
    open('/giris')
    await userEvent.click(await screen.findByRole('tab', { name: 'Kayıt ol' }))
    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), 'baska-parola-1')
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    expect(screen.getByText('Parolalar aynı değil.')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Parola (tekrar)'))
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    // R6.3: yeni hesap önce kâşifini seçer (varsayılan yok), sonra şehir seçimine geçer.
    expect(await screen.findByRole('heading', { name: 'Kâşifini seç', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Seç ve maceraya başla' })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Gezgin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Seç ve maceraya başla' }))
    expect(await screen.findByRole('heading', CITY_HEADING)).toBeInTheDocument()
    expect(screen.getByText('ayse@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Kâşifin: Gezgin. Kâşifini değiştir' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/player/character')!.body).toEqual({ character_id: 'gezgin' })
    const reg = calls.find((c) => c.path === '/auth/register')!
    expect(reg.body).toEqual({ email: 'ayse@example.com', password: PASSWORD, visitor_id: 'ziyaretci-0b8f2c1e-1a2b-4c3d-8e9f-0123456789ab', lang: 'tr' })
    // Parola tarayıcıda saklanmaz.
    expect(JSON.stringify(window.localStorage)).not.toContain(PASSWORD)
  })

  it('UUID biçiminde olmayan misafir kimliği gönderilmez', async () => {
    const { calls } = fakeAuthServer()
    window.localStorage.setItem('vakifname.visitorId', 'ziyaretci-lq9x2-abc')
    open('/giris')
    await userEvent.click(await screen.findByRole('tab', { name: 'Kayıt ol' }))
    await userEvent.type(screen.getByLabelText('E-posta'), 'b@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    await screen.findByRole('heading', { name: 'Kâşifini seç', level: 1 })
    expect(calls.find((c) => c.path === '/auth/register')!.body).not.toHaveProperty('visitor_id')
  })

  it('yanlış parolada sunucunun genel mesajını gösterir', async () => {
    const { signIn } = fakeAuthServer()
    signIn({ user_id: 'u-1', email: 'ayse@example.com', display_name: null, provider: 'password' })
    await act(async () => {
      await fetch('http://localhost:8000/auth/logout', { method: 'POST' })
    })
    open('/giris')
    await userEvent.type(await screen.findByLabelText('E-posta'), 'ayse@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), 'yanlis-parola-9')
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    expect(await screen.findByText('E-posta veya parola hatalı.')).toBeInTheDocument()
  })

  it('sunucuya ulaşılamazsa anlaşılır bir hata verir', async () => {
    stubFetch({ '/auth/me': { status: 401, body: {} }, '/auth/login': new TypeError('ağ yok') as unknown as Error })
    open('/giris')
    await userEvent.type(await screen.findByLabelText('E-posta'), 'ayse@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    expect(await screen.findByText('Sunucuya bağlanılamıyor. Bağlantını kontrol edip yeniden dene.')).toBeInTheDocument()
  })

  it('R6.4.2: kayıtlı e-postayla kayıt anlaşılır mesaj verir (409); sunucu hatasında teknik ayrıntı gösterilmez (500)', async () => {
    const { accounts } = fakeAuthServer()
    accounts.set('var@example.com', { user_id: 'u-9', email: 'var@example.com', display_name: null, provider: 'password' })
    const { unmount } = open('/giris')
    await userEvent.click(await screen.findByRole('tab', { name: 'Kayıt ol' }))
    await userEvent.type(screen.getByLabelText('E-posta'), 'var@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    expect(await screen.findByText(/Bu e-posta adresiyle kayıtlı bir hesap var\. “Giriş yap” sekmesinden gir/)).toBeInTheDocument()
    unmount()

    resetAuthForTests()
    stubFetch({ '/auth/me': { status: 401, body: {} }, '/auth/register': { status: 500, body: { detail: 'Internal Server Error' } } })
    open('/giris')
    await userEvent.click(await screen.findByRole('tab', { name: 'Kayıt ol' }))
    await userEvent.type(screen.getByLabelText('E-posta'), 'yeni@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    expect(await screen.findByText('Kayıt şu anda tamamlanamıyor. Biraz sonra yeniden dene.')).toBeInTheDocument()
    expect(screen.queryByText(/Internal Server Error|HTTP 500/)).not.toBeInTheDocument()
  })

  it('R6.4.2: silinmiş/bilinmeyen hesapla girişte sunucunun güvenli mesajı gösterilir (401)', async () => {
    fakeAuthServer()
    open('/giris')
    await userEvent.type(await screen.findByLabelText('E-posta'), 'eski@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    expect(await screen.findByText('E-posta veya parola hatalı.')).toBeInTheDocument()
  })

  it('aydınlatma metnine bağlantı verir', async () => {
    fakeAuthServer()
    open('/giris')
    await userEvent.click(await screen.findByRole('link', { name: 'aydınlatma metnini' }))
    expect(screen.getByRole('heading', { name: 'Aydınlatma metni' })).toBeInTheDocument()
  })

  it('Google istemci kimliği yokken dürüst bir bilgi verir', async () => {
    fakeAuthServer()
    open('/giris')
    await userEvent.click(await screen.findByRole('button', { name: /Google ile devam et/ }))
    expect(screen.getByRole('status')).toHaveTextContent('henüz etkinleştirilmedi')
  })
})

describe('kabuk, hesap ve şehir seçimi', () => {
  beforeEach(() => window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'))

  it('üst ve alt menüde aynı beş bölüm vardır; sayfa değişir, alt sayfada bölüm etkin kalır', async () => {
    fakeAuthServer({ user_id: 'u-5', email: 'ece@example.com', display_name: null, provider: 'password' })
    open('/giris')
    await screen.findByRole('heading', CITY_HEADING)
    for (const name of ['Ana menü', 'Alt menü']) {
      const nav = screen.getByRole('navigation', { name })
      expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/eserler', '/harita', '/oyun', '/pasaport'])
    }
    // Girişten sonra şehir seçimi oyun panelindedir: "Oyun" etkin.
    expect(window.location.pathname).toBe('/oyun/sehir')
    expect(within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', { name: 'Oyun' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Alt menü' })).getByRole('link', { name: /Rozetler/ }))
    expect(window.location.pathname).toBe('/pasaport')
    // R6.12: ekran parçası yüklenirken önceki sayfa ekranda kalır (geçiş); yüklenince bölüm etkin olur.
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', { name: 'Rozetler' })).toHaveAttribute('aria-current', 'page'))
    expect(screen.getByRole('link', { name: 'Hesap: ece@example.com' })).toHaveAttribute('href', '/hesap')
  })

  it('oturum yoksa kabuk sayfaları girişe yönlendirir', async () => {
    fakeAuthServer()
    open('/pasaport')
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
  })

  it('Bursa açık, diğer şehirler "yakında" ve tıklanamaz', async () => {
    fakeAuthServer({ user_id: 'u-6', email: 'efe@example.com', display_name: null, provider: 'password' })
    open('/oyun/sehir')
    await screen.findByRole('heading', CITY_HEADING)
    const cards = screen.getByRole('list', { name: 'Şehirler' })
    expect(within(cards).getByRole('link', { name: /Bursa/ })).toHaveAttribute('href', '/oyun/rota/bursa')
    expect(cards.querySelectorAll('a')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Bursa: Pilot şehir' })).toHaveAttribute('href', '/oyun/rota/bursa')
    expect(screen.getAllByText('Yakında').length).toBeGreaterThanOrEqual(5)
  })

  it('hesap sayfası: çıkış sunucu oturumunu kapatır', async () => {
    const { calls } = fakeAuthServer({ user_id: 'u-7', email: 'can@example.com', display_name: null, provider: 'google' })
    open('/hesap')
    expect(await screen.findByText('Google')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Çıkış' }))
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/logout' && c.method === 'POST')).toBe(true)
  })

  it('R6.5: hesap sayfasında oyuncu profili: kâşifin portresi, adı, seviyesi ve değiştirme bağlantısı', async () => {
    fakeAuthServer({ user_id: 'u-7', email: 'can@example.com', display_name: null, provider: 'password' })
    open('/hesap')
    const section = await screen.findByRole('region', { name: 'Oyuncu profili' })
    const crest = await within(section).findByRole('region', { name: 'Kâşifin' })
    expect(within(crest).getByRole('heading', { name: 'Gezgin' })).toBeInTheDocument()
    expect(within(crest).getByText('Seviye 1')).toBeInTheDocument()
    expect(crest.querySelector('svg[data-character="gezgin"]')).not.toBeNull()
    expect(within(section).getByRole('link', { name: 'Kâşifini değiştir' })).toHaveAttribute('href', '/oyun/karakter?sonra=%2Foyun')
  })

  it('hesap silme onay ister, sonra hesabı siler ve girişe döner', async () => {
    const { calls } = fakeAuthServer({ user_id: 'u-8', email: 'zeynep@example.com', display_name: null, provider: 'password' })
    open('/hesap')
    await userEvent.click(await screen.findByRole('button', { name: 'Hesabımı silmek istiyorum' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Evet, kalıcı olarak sil' }))
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/me' && c.method === 'DELETE')).toBe(true)
  })

  it('misafir hesap sayfasında hesap açmaya yönlendirilir', async () => {
    fakeAuthServer()
    window.localStorage.setItem('vakifname.guest', '1')
    open('/hesap')
    expect(await screen.findByText(/Misafir olarak eserleri, haritayı ve rehberi kullanabilirsin/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Hesap aç veya giriş yap' }))
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
  })
})

describe('R6.2: oyun yalnızca hesapla', () => {
  beforeEach(() => window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'))
  const progressCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
    fetchMock.mock.calls.map((c) => new URL(String(c[0]))).filter((u) =>
      u.pathname === '/route' || u.pathname.endsWith('/game') || u.pathname.startsWith('/users/') || u.pathname.endsWith('/engagement'))

  it('misafir /oyun adresine giderse girişe yönlenir; ilerleme isteği gönderilmez; kayıttan sonra /oyun adresine döner', async () => {
    const { fetchMock } = fakeAuthServer()
    window.localStorage.setItem('vakifname.guest', '1')
    open('/oyun')
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
    expect(screen.getByText(/Oyunu oynamak ve ilerlemeni hesabına kaydetmek için/)).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('sonra')).toBe('/oyun')
    expect(progressCalls(fetchMock)).toEqual([])
    await userEvent.click(screen.getByRole('tab', { name: 'Kayıt ol' }))
    await userEvent.type(screen.getByLabelText('E-posta'), 'yeni@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    // R6.3: ilk oyunda önce karakter seçilir; sonra istenen oyun adresine gidilir.
    expect(await screen.findByRole('heading', { name: 'Kâşifini seç', level: 1 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/oyun/karakter')
    await userEvent.click(await screen.findByRole('radio', { name: 'Kâtip Çırağı' }))
    await userEvent.click(screen.getByRole('button', { name: 'Seç ve maceraya başla' }))
    await vi.waitFor(() => expect(window.location.pathname).toBe('/oyun'))
    expect(await screen.findByRole('heading', { name: 'Vakfiye Odası', level: 1 })).toBeInTheDocument()
  })

  it('misafir korumalı alt adrese (rota, soru, pasaport, eski adres) giderse girişe yönlenir; girişten sonra aynı adrese döner', async () => {
    for (const path of ['/oyun/rota/bursa', '/oyun/eser/BUR-9001/rozet', '/pasaport', '/rota/bursa']) {
      resetAuthForTests()
      const { fetchMock, accounts } = fakeAuthServer()
      const { unmount } = open(path)
      expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
      expect(progressCalls(fetchMock)).toEqual([])
      if (path === '/oyun/rota/bursa') {
        accounts.set('ali@example.com', { user_id: 'u-1', email: 'ali@example.com', display_name: null, provider: 'password' })
        await userEvent.type(screen.getByLabelText('E-posta'), 'ali@example.com')
        await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
        await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
        await vi.waitFor(() => expect(window.location.pathname).toBe('/oyun/rota/bursa'))
      }
      unmount()
    }
  })

  it('girişten sonraki adres yalnızca site içi bir yol olabilir (açık yönlendirme yok)', async () => {
    for (const bad of ['//kotu.example', 'https://kotu.example/oyun', '/\\kotu.example']) {
      resetAuthForTests()
      fakeAuthServer({ user_id: 'u-2', email: 'b@example.com', display_name: null, provider: 'password' })
      const { unmount } = open(`/giris?sonra=${encodeURIComponent(bad)}`)
      await vi.waitFor(() => expect(window.location.pathname).toBe('/oyun/sehir'))
      unmount()
    }
  })

  it('A çıkış yapınca ilerlemesi ekrandan gider; B girişte yalnızca kendi ilerlemesini ister', async () => {
    const A = { user_id: 'u-a', email: 'a@example.com', display_name: null, provider: 'password' as const }
    const B = { user_id: 'u-b', email: 'b@example.com', display_name: null, provider: 'password' as const }
    const { fetchMock, accounts } = fakeAuthServer(A)
    accounts.set(A.email, A)
    accounts.set(B.email, B)
    open('/pasaport')
    await vi.waitFor(() => expect(progressCalls(fetchMock).some((u) => u.pathname === '/users/u-a/seals')).toBe(true))
    await userEvent.click(screen.getByRole('link', { name: 'Hesap: a@example.com' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Çıkış' }))
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
    const before = fetchMock.mock.calls.length
    await userEvent.type(screen.getByLabelText('E-posta'), B.email)
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    await screen.findByRole('heading', CITY_HEADING)
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Alt menü' })).getByRole('link', { name: /Rozetler/ }))
    await vi.waitFor(() => expect(progressCalls(fetchMock).some((u) => u.pathname === '/users/u-b/seals')).toBe(true))
    const after = fetchMock.mock.calls.slice(before).map((c) => String(c[0]))
    expect(after.some((u) => u.includes('u-a'))).toBe(false)
  })
})
