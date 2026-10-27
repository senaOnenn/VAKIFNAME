import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VakifnameApp from './VakifnameApp'
import { endSession } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

beforeEach(() => {
  endSession()
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('açılış', () => {
  it('VAKIFNAME yazısını gösterir ve süre dolunca giriş sayfasına geçer', async () => {
    vi.useFakeTimers()
    open('/')
    expect(screen.getByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(5300)
    })
    expect(screen.getByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/giris')
    expect(window.sessionStorage.getItem(INTRO_SEEN_KEY)).toBe('1')
  })

  it('"Geç" düğmesi açılışı atlar', async () => {
    open('/')
    await userEvent.click(screen.getByRole('button', { name: 'Geç' }))
    expect(screen.getByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
  })

  it('aynı oturumda açılış ikinci kez gösterilmez', () => {
    window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    open('/')
    expect(screen.getByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
  })
})

describe('giriş / kayıt', () => {
  beforeEach(() => window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'))

  it('üye olmadan keşfet misafir oturumu açar ve şehir seçimine götürür', async () => {
    open('/giris')
    await userEvent.click(screen.getByRole('button', { name: 'Üye olmadan keşfet' }))
    expect(screen.getByRole('heading', { name: 'Nereyi keşfetmek istersin?' })).toBeInTheDocument()
    expect(screen.getByText('Misafir')).toBeInTheDocument()
  })

  it('geçersiz e-posta ve kısa parolada hata gösterir, oturum açmaz', async () => {
    open('/giris')
    await userEvent.type(screen.getByLabelText('E-posta'), 'yanlis')
    await userEvent.type(screen.getByLabelText('Parola'), 'kisa')
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap', hidden: false, description: undefined }))
    expect(screen.getByText('Geçerli bir e-posta adresi yaz.')).toBeInTheDocument()
    expect(screen.getByText('Parola en az 8 karakter olmalı.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nereyi keşfetmek istersin?' })).not.toBeInTheDocument()
  })

  it('kayıtta parola tekrarı uyuşmazsa uyarır; doğruysa geçici oturum açar', async () => {
    open('/giris')
    await userEvent.click(screen.getByRole('tab', { name: 'Kayıt ol' }))
    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse@example.com')
    await userEvent.type(screen.getByLabelText('Parola'), 'gizli-parola-1')
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), 'baska-parola-1')
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    expect(screen.getByText('Parolalar aynı değil.')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Parola (tekrar)'))
    await userEvent.type(screen.getByLabelText('Parola (tekrar)'), 'gizli-parola-1')
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }))
    expect(screen.getByRole('heading', { name: 'Nereyi keşfetmek istersin?' })).toBeInTheDocument()
    expect(screen.getByText(/Geçici oturum · ayse@example.com/)).toBeInTheDocument()
    // Parola hiçbir yerde saklanmaz.
    expect(JSON.stringify(window.localStorage)).not.toContain('gizli-parola-1')
  })

  it('Google istemci kimliği yokken dürüst bir bilgi verir', async () => {
    open('/giris')
    await userEvent.click(screen.getByRole('button', { name: /Google ile devam et/ }))
    expect(screen.getByRole('status')).toHaveTextContent('henüz etkinleştirilmedi')
  })
})

describe('kabuk ve gezinme', () => {
  beforeEach(() => window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'))

  it('üst ve alt menüde aynı dört bölüm vardır; sayfa değişir', async () => {
    open('/giris')
    await userEvent.click(screen.getByRole('button', { name: 'Üye olmadan keşfet' }))
    for (const name of ['Ana menü', 'Alt menü']) {
      const nav = screen.getByRole('navigation', { name })
      expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/sehir', '/eserler', '/pasaport', '/hesap'])
    }
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Alt menü' })).getByRole('link', { name: /Pasaport/ }))
    expect(screen.getByRole('heading', { name: 'Pasaport' })).toBeInTheDocument()
  })

  it('oturum yoksa kabuk sayfaları girişe yönlendirir', () => {
    open('/pasaport')
    expect(screen.getByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
  })
})

describe('şehir seçimi', () => {
  beforeEach(() => window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'))

  it('oturum yoksa girişe yönlendirir', () => {
    open('/sehir')
    expect(screen.getByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
  })

  it('Bursa açık, diğer şehirler "yakında" ve tıklanamaz', async () => {
    open('/giris')
    await userEvent.click(screen.getByRole('button', { name: 'Üye olmadan keşfet' }))
    const cards = screen.getByRole('list', { name: 'Şehirler' })
    expect(within(cards).getByRole('link', { name: /Bursa/ })).toHaveAttribute('href', '/bursa')
    // Harita: Bursa işareti bağlantıdır, diğer şehirler değildir.
    expect(screen.getByRole('link', { name: 'Bursa: Pilot şehir · 10 eser' })).toHaveAttribute('href', '/bursa')
    const list = screen.getByRole('list', { name: 'Şehirler' })
    expect(list.querySelectorAll('a')).toHaveLength(1)
    expect(screen.getAllByText('Yakında').length).toBeGreaterThanOrEqual(5)
  })

  it('çıkış oturumu kapatır', async () => {
    open('/giris')
    await userEvent.click(screen.getByRole('button', { name: 'Üye olmadan keşfet' }))
    await userEvent.click(screen.getAllByRole('link', { name: /Hesap/ })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Çıkış' }))
    expect(screen.getByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
  })
})
