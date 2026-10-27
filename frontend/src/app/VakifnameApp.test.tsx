import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
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
  })
  return { fetchMock, calls, accounts, signIn: (u: User) => ((user = u), accounts.set(u.email, u)) }
}

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

const AUTH_HEADING = { name: 'Maceraya katıl' }
const CITY_HEADING = { name: 'Nereyi keşfetmek istersin?' }

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
  it('VAKIFNAME yazısını gösterir ve süre dolunca giriş sayfasına geçer', async () => {
    fakeAuthServer()
    vi.useFakeTimers()
    open('/')
    expect(screen.getByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(5300)
    })
    expect(screen.getByRole('heading', AUTH_HEADING)).toBeInTheDocument()
    expect(window.sessionStorage.getItem(INTRO_SEEN_KEY)).toBe('1')
  })

  it('"Geç" düğmesi açılışı atlar', async () => {
    fakeAuthServer()
    open('/')
    await userEvent.click(screen.getByRole('button', { name: 'Geç' }))
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
  })

  it('oturumu olan kullanıcı açılışı görmeden şehir seçimine geçer', async () => {
    fakeAuthServer({ user_id: 'u-9', email: 'ali@example.com', display_name: null, provider: 'password' })
    window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    open('/')
    expect(await screen.findByRole('heading', CITY_HEADING)).toBeInTheDocument()
    expect(screen.getByText('ali@example.com')).toBeInTheDocument()
  })
})

describe('giriş / kayıt (sunucu)', () => {
  beforeEach(() => window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'))

  it('üye olmadan keşfet misafir olarak şehir seçimine götürür; yenilemede misafir kalır', async () => {
    fakeAuthServer()
    const { unmount } = open('/giris')
    await userEvent.click(await screen.findByRole('button', { name: 'Üye olmadan keşfet' }))
    expect(screen.getByRole('heading', CITY_HEADING)).toBeInTheDocument()
    expect(screen.getByText('Misafir')).toBeInTheDocument()
    unmount()
    resetAuthForTests()
    window.localStorage.setItem('vakifname.guest', '1')
    open('/sehir')
    expect(await screen.findByRole('heading', CITY_HEADING)).toBeInTheDocument()
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
    expect(await screen.findByRole('heading', CITY_HEADING)).toBeInTheDocument()
    expect(screen.getByText('ayse@example.com')).toBeInTheDocument()
    const reg = calls.find((c) => c.path === '/auth/register')!
    expect(reg.body).toEqual({ email: 'ayse@example.com', password: PASSWORD, visitor_id: 'ziyaretci-0b8f2c1e-1a2b-4c3d-8e9f-0123456789ab' })
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
    await screen.findByRole('heading', CITY_HEADING)
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
    expect(await screen.findByText('Sunucuya ulaşılamadı.')).toBeInTheDocument()
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

  it('üst ve alt menüde aynı dört bölüm vardır; sayfa değişir', async () => {
    fakeAuthServer()
    open('/giris')
    await userEvent.click(await screen.findByRole('button', { name: 'Üye olmadan keşfet' }))
    for (const name of ['Ana menü', 'Alt menü']) {
      const nav = screen.getByRole('navigation', { name })
      expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/sehir', '/eserler', '/pasaport', '/hesap'])
    }
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Alt menü' })).getByRole('link', { name: /Pasaport/ }))
    expect(window.location.pathname).toBe('/pasaport')
    expect(within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', { name: 'Pasaport' })).toHaveAttribute('aria-current', 'page')
  })

  it('oturum yoksa kabuk sayfaları girişe yönlendirir', async () => {
    fakeAuthServer()
    open('/pasaport')
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
  })

  it('Bursa açık, diğer şehirler "yakında" ve tıklanamaz', async () => {
    fakeAuthServer()
    open('/giris')
    await userEvent.click(await screen.findByRole('button', { name: 'Üye olmadan keşfet' }))
    const cards = screen.getByRole('list', { name: 'Şehirler' })
    expect(within(cards).getByRole('link', { name: /Bursa/ })).toHaveAttribute('href', '/rota/bursa')
    expect(cards.querySelectorAll('a')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Bursa: Pilot şehir · 10 eser' })).toHaveAttribute('href', '/rota/bursa')
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
    expect(await screen.findByText(/Misafir olarak keşfediyorsun/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Hesap aç veya giriş yap' }))
    expect(await screen.findByRole('heading', AUTH_HEADING)).toBeInTheDocument()
  })
})
