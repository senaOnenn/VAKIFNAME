import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYER, PROFILE, SIGNED_IN, stubFetch, type Routes } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { resetAuthForTests } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

/**
 * R6.4.1: gerçek tarayıcıda yeni arayüz eski kodla çalışan sunucuya bağlanınca (`/player/profile` → 404) "Oyuncu profili
 * yüklenemedi" çıkıyor ve oyun boş kalıyordu. Hata türüne göre kısa mesaj; teknik ayrıntı yok; varsayılan profil yok.
 */
const CATALOG = { body: { published_count: 0, data_version: 't', generated_at: null, monuments: [] } }

function open(path: string, routes: Routes) {
  const f = stubFetch({ '/auth/me': SIGNED_IN, '/monuments': CATALOG, ...routes })
  window.history.replaceState(null, '', path)
  render(<VakifnameApp />)
  return f
}
const called = (f: ReturnType<typeof stubFetch>, path: string) => f.mock.calls.some((c) => new URL(String(c[0])).pathname === path)

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('oyuncu profili hataları (R6.4.1)', () => {
  it('eski sürüm sunucu (uç yok, sürüm bilgisi yok): "sunucu güncel değil"; oyun açılmaz, varsayılan karakter yazılmaz', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = open('/oyun', {
      '/player/profile': { status: 404, body: { detail: 'Not Found' } },
      '/': { body: { status: 'ok', message: 'VAKIFNAME API Service Active' } }, // R6.4 öncesi kök yanıtı
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Oyun sunucusu güncel değil; oyuncu bilgileri alınamadı.')
    expect(screen.queryByText(/Not Found|404/)).not.toBeInTheDocument()
    expect(called(f, '/player/character')).toBe(false)
    expect(called(f, '/route')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('yeniden başlatın'))
  })

  it('güncel sunucu 404 verirse (sürüm uygun) genel "alınamadı" mesajı; "Tekrar dene" yeniden ister', async () => {
    let ok = false
    open('/oyun/sehir', {
      '/player/profile': () => (ok ? PROFILE : { status: 404, body: { detail: 'Not Found' } }),
      '/': { body: { status: 'ok', api_version: 5, features: ['player_profile', 'xp', 'open_quests'] } },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Oyuncu bilgileri alınamadı; yeniden dene.')
    ok = true
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByRole('heading', { name: 'Nereyi keşfetmek istersin?' })).toBeInTheDocument()
  })

  it('sunucuya ulaşılamazsa bağlantı mesajı', async () => {
    open('/oyun', { '/player/profile': new TypeError('Failed to fetch') })
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya bağlanılamıyor. Bağlantını kontrol edip yeniden dene.')
  })

  it('oturum düşmüşse (401) mesaj verilir ve girişe, dönüş adresiyle gidilir', async () => {
    let session = true
    open('/oyun/rota/bursa', {
      '/auth/me': () => (session ? { body: PLAYER } : { status: 401, body: { detail: 'Oturum açık değil.' } }),
      '/player/profile': () => {
        session = false // sunucuda oturum bu arada sona erdi
        return { status: 401, body: { detail: 'Oyunu oynamak ve ilerlemeni görmek için giriş yapmalısın.' } }
      },
    })
    await waitFor(() => expect(window.location.pathname).toBe('/giris'))
    expect(new URLSearchParams(window.location.search).get('sonra')).toBe('/oyun/rota/bursa')
    expect(await screen.findByRole('heading', { name: 'Maceraya katıl' })).toBeInTheDocument()
  })

  it('karakter seçimi ekranı da aynı türlü mesajı verir (eski sunucu)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    open('/oyun/karakter', {
      '/player/profile': { status: 404, body: { detail: 'Not Found' } },
      '/': { body: { status: 'ok', message: 'VAKIFNAME API Service Active' } },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Oyun sunucusu güncel değil')
    // R6.5: kâşifler profil yüklenemese de görünür (boş ekran yok); kaydetmek yine sunucuya bağlıdır.
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(document.querySelectorAll('.vk-cs__arch img[data-character]')).toHaveLength(2)
  })
})
