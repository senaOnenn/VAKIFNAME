import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE, stubFetch, type Routes } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { resetAuthForTests } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

const TOKEN = 'Kurgusal_belirtec-' + 'x'.repeat(30)
const PASSWORD = 'yeni-parola-12'
type User = { user_id: string; email: string; display_name: null; provider: 'password' | 'google'; email_verified: boolean }
const USER: User = { user_id: 'u-1', email: 'ayse@example.com', display_name: null, provider: 'password', email_verified: false }

type Call = { path: string; method: string; body: Record<string, unknown> }

/** `/auth/*` için küçük sahte sunucu; istekleri `calls` içinde tutar. `extra` yolları ezer. */
function server(initial: User | null, extra: Routes = {}) {
  let user = initial
  const calls: Call[] = []
  const log = (path: string, init?: RequestInit) =>
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {} })
  stubFetch({
    // R6.3: parolasını yenileyen hesap kâşifini daha önce seçmiştir (oyun ekranı doğrudan açılır).
    '/player/profile': PROFILE,
    '/auth/me': (init?: RequestInit) => {
      log('/auth/me', init)
      return user ? { body: user } : { status: 401, body: { detail: 'Oturum açık değil.' } }
    },
    '/auth/register': (init?: RequestInit) => {
      log('/auth/register', init)
      user = { ...USER, email: JSON.parse(String(init?.body)).email }
      return { status: 201, body: user }
    },
    '/auth/verify-email': (init?: RequestInit) => {
      log('/auth/verify-email', init)
      if (user) user = { ...user, email_verified: true }
      return { body: { email: 'ayse@example.com', email_verified: true } }
    },
    '/auth/verify-email/resend': (init?: RequestInit) => {
      log('/auth/verify-email/resend', init)
      return { status: 204, body: null }
    },
    '/auth/password-reset/request': (init?: RequestInit) => {
      log('/auth/password-reset/request', init)
      return { status: 204, body: null }
    },
    '/auth/password-reset/confirm': (init?: RequestInit) => {
      log('/auth/password-reset/confirm', init)
      user = { ...USER, email_verified: true }
      return { body: user }
    },
    ...Object.fromEntries(
      Object.entries(extra).map(([path, route]) => [
        path,
        (init?: RequestInit) => {
          log(path, init)
          return typeof route === 'function' ? route(init) : route
        },
      ]),
    ),
  })
  return calls
}

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('e-posta doğrulama bağlantısı', () => {
  it('belirteci parçadan okur, adresten hemen siler, bir kez gönderir ve sonucu gösterir', async () => {
    const calls = server(null)
    open(`/dogrula#t=${TOKEN}`)
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain(TOKEN)
    expect(await screen.findByRole('heading', { name: 'E-postan doğrulandı' })).toBeInTheDocument()
    const posts = calls.filter((c) => c.path === '/auth/verify-email')
    expect(posts).toEqual([{ path: '/auth/verify-email', method: 'POST', body: { token: TOKEN } }])
    expect(screen.getByRole('link', { name: 'Giriş yap' })).toHaveAttribute('href', '/giris')
  })

  it('geçersiz bağlantıda sunucunun mesajını gösterir', async () => {
    server(null, { '/auth/verify-email': { status: 400, body: { detail: 'Bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Yeni bir bağlantı isteyin.' } } })
    open(`/dogrula#t=${TOKEN}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('süresi dolmuş')
    expect(screen.getByRole('link', { name: 'Giriş sayfasına dön' })).toBeInTheDocument()
  })

  it('belirteç yoksa sunucuya gitmez', async () => {
    const calls = server(null)
    open('/dogrula')
    expect(await screen.findByRole('alert')).toHaveTextContent('Bağlantı eksik ya da bozuk')
    expect(calls.some((c) => c.path === '/auth/verify-email')).toBe(false)
  })

  it('kayıttan sonra şehir ekranında "bağlantı gönderildi" bildirimi çıkar; kapatılabilir', async () => {
    server(null)
    open('/giris')
    await userEvent.click(await screen.findByRole('tab', { name: 'Kayıt ol' }))
    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    expect(await screen.findByText(/Doğrulama bağlantısını ayse@example\.com adresine gönderdik/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Bildirimi kapat' }))
    expect(screen.queryByText(/Doğrulama bağlantısını/)).not.toBeInTheDocument()
  })

  it('hesap ekranı durumu gösterir ve bağlantıyı yeniden gönderir', async () => {
    const calls = server(USER)
    open('/hesap')
    expect(await screen.findByText('Doğrulanmadı')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Bağlantıyı yeniden gönder' }))
    expect(await screen.findByText('Doğrulama bağlantısını ayse@example.com gönderdik.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/verify-email/resend' && c.method === 'POST')).toBe(true)
  })

  it('yeniden gönderim sınırına takılınca sunucunun mesajını gösterir', async () => {
    server(USER, { '/auth/verify-email/resend': { status: 429, body: { detail: 'Bağlantı kısa süre önce gönderildi; lütfen biraz sonra tekrar deneyin.' } } })
    open('/hesap')
    await userEvent.click(await screen.findByRole('button', { name: 'Bağlantıyı yeniden gönder' }))
    expect(await screen.findByText(/kısa süre önce gönderildi/)).toBeInTheDocument()
  })

  it('doğrulanmış hesapta hatırlatma ve yeniden gönderim yok', async () => {
    server({ ...USER, email_verified: true })
    open('/hesap')
    expect(await screen.findByText('Doğrulandı')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bağlantıyı yeniden gönder' })).not.toBeInTheDocument()
    expect(screen.queryByText(/henüz doğrulanmadı/)).not.toBeInTheDocument()
  })
})

describe('parola yenileme', () => {
  it('giriş ekranındaki "Şifremi unuttum" bağlantısı istek formuna götürür; cevap hesabın varlığını belli etmez', async () => {
    const calls = server(null)
    open('/giris')
    await userEvent.click(await screen.findByRole('link', { name: 'Şifremi unuttum' }))
    expect(screen.getByRole('heading', { name: 'Parolanı yenile' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('E-posta'), 'yanlis')
    await userEvent.click(screen.getByRole('button', { name: 'Bağlantı gönder' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Geçerli bir e-posta adresi yaz.')
    expect(calls.some((c) => c.path === '/auth/password-reset/request')).toBe(false)
    await userEvent.clear(screen.getByLabelText('E-posta'))
    await userEvent.type(screen.getByLabelText('E-posta'), ' kimse@example.com ')
    await userEvent.click(screen.getByRole('button', { name: 'Bağlantı gönder' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Bu adresle kayıtlı bir hesap varsa')
    expect(calls.find((c) => c.path === '/auth/password-reset/request')!.body).toEqual({ email: 'kimse@example.com', lang: 'tr' }) // R6.17: e-posta arayüz dilinde gider
  })

  it('yeni parolayı belirteçle gönderir, oturum açar ve şehir seçimine götürür', async () => {
    const calls = server(null)
    open(`/sifre-yenile#t=${TOKEN}`)
    expect(window.location.hash).toBe('')
    await userEvent.type(await screen.findByLabelText('Yeni parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Yeni parola (tekrar)'), 'baska-parola-1')
    await userEvent.click(screen.getByRole('button', { name: 'Parolayı kaydet' }))
    expect(screen.getByText('Parolalar aynı değil.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/auth/password-reset/confirm')).toBe(false)
    await userEvent.clear(screen.getByLabelText('Yeni parola (tekrar)'))
    await userEvent.type(screen.getByLabelText('Yeni parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Parolayı kaydet' }))
    expect(await screen.findByRole('heading', { name: 'Nereyi keşfetmek istersin?' })).toBeInTheDocument()
    const confirm = calls.find((c) => c.path === '/auth/password-reset/confirm')!.body
    // Misafir ilerlemesi de hesaba taşınsın diye misafir kimliği (varsa) eklenir.
    expect(confirm).toMatchObject({ token: TOKEN, password: PASSWORD })
    expect(Object.keys(confirm).sort()).toEqual(expect.arrayContaining(['password', 'token']))
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage)).not.toContain(TOKEN)
  })

  it('süresi dolmuş bağlantıda mesaj ve yeni bağlantı isteme yolu gösterir', async () => {
    server(null, { '/auth/password-reset/confirm': { status: 400, body: { detail: 'Bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Yeni bir bağlantı isteyin.' } } })
    open(`/sifre-yenile#t=${TOKEN}`)
    await userEvent.type(await screen.findByLabelText('Yeni parola'), PASSWORD)
    await userEvent.type(screen.getByLabelText('Yeni parola (tekrar)'), PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Parolayı kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('süresi dolmuş')
    expect(screen.getByRole('link', { name: 'Yeni bağlantı iste' })).toHaveAttribute('href', '/sifre-sifirla')
  })

  it('belirteçsiz yenileme sayfası yeni bağlantı istemeye yönlendirir', async () => {
    server(null)
    open('/sifre-yenile')
    expect(await screen.findByRole('alert')).toHaveTextContent('Bağlantı eksik ya da bozuk')
    expect(screen.queryByLabelText('Yeni parola')).not.toBeInTheDocument()
  })
})
