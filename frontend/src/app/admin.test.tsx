import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import { pageOf, trackPage } from './stats'

const ADMIN = { user_id: 'u-1', email: 'yonetici@example.com', display_name: null, provider: 'password', is_admin: true }
const STATS = {
  days: [{ day: '2026-10-26', visitors: 3, pageviews: 9 }, { day: '2026-10-27', visitors: 5, pageviews: 14 }],
  totals: { visitors: 8, pageviews: 23, monument_views: 7 },
  pages: [{ page: 'eser', views: 7 }, { page: 'sehir', views: 4 }],
  monuments: [{ monument_id: 'BUR-1001', name: 'Bursa Ulu Camii', views: 5 }, { monument_id: 'BUR-1009', name: 'Koza Han', views: 2 }],
  game: { players: 4, listened: 6, asked: 3, knowledge: 2, visit: 1, visit_simulated: 1 },
}

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('anonim sayfa sayımı', () => {
  it('adresleri sayfa türüne çevirir; listede olmayanı saymaz', () => {
    expect(pageOf('/eser/BUR-1001')).toEqual({ page: 'eser', monument_id: 'BUR-1001' })
    expect(pageOf('/oyun/eser/BUR-1001/rozet')).toEqual({ page: 'rozet', monument_id: 'BUR-1001' })
    expect(pageOf('/oyun/rota/bursa')).toEqual({ page: 'rota' })
    expect(pageOf('/oyun/sehir')).toEqual({ page: 'sehir' })
    expect(pageOf('/harita')).toEqual({ page: 'eserler' })
    // Eski adresler oyun paneline yönlenir; yönlenme öncesi adres ve eserin mühür yolu ayrıca sayılmaz.
    expect(pageOf('/sehir')).toBeNull()
    expect(pageOf('/rota/bursa')).toBeNull()
    expect(pageOf('/oyun/eser/BUR-1001')).toBeNull()
    expect(pageOf('/gizlilik')).toBeNull()
  })

  it('çerezsiz gönderir; "izleme" kapalıysa hiç göndermez', () => {
    const f = stubFetch({})
    trackPage('/oyun/sehir', 1_000)
    trackPage('/oyun/sehir', 1_500) // aynı sayfa hemen tekrar: sayılmaz
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(String(url)).toMatch(/\/stats\/hit$/)
    expect(JSON.parse(String(init!.body))).toEqual({ page: 'sehir' })
    expect(init).not.toHaveProperty('credentials')
    trackPage('/oyun/sehir', 9_000)
    expect(f).toHaveBeenCalledTimes(2)
    vi.stubGlobal('navigator', { ...navigator, doNotTrack: '1' })
    trackPage('/eserler', 20_000)
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('yönetim paneli', () => {
  it('yönetici menüde "Yönetim"i görür; pano KPI, grafik ve tablo gösterir; aralık değişince yeniden ister', async () => {
    const f = stubFetch({ '/auth/me': { body: ADMIN }, '/admin/stats': { body: STATS } })
    open('/sehir')
    const nav = await screen.findByRole('navigation', { name: 'Ana menü' })
    await userEvent.click(within(nav).getByRole('link', { name: 'Yönetim' }))
    expect(await screen.findByRole('heading', { name: 'Ziyaret istatistikleri' })).toBeInTheDocument()
    // Başlık veriden önce çizilir; sayıları beklemeden aramak yük altında yarış yaratıyordu.
    expect((await screen.findByText('Tekil ziyaretçi (günlük toplam)')).nextSibling).toHaveTextContent('8')
    expect(screen.getByRole('group', { name: 'Eser sayfası görüntülemeleri' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Eser sayfası' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Oyun kademelerine ulaşan sayısı' })).toBeInTheDocument()
    expect(screen.getByText(/1 sunum modu \(simüle edilmiş\) ziyaret/)).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(3)
    await userEvent.click(screen.getByRole('button', { name: 'Son 7 gün' }))
    const urls = f.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/admin/stats'))
    expect(urls.at(-1)).toMatch(/days=7$/)
  })

  it('yönetici olmayan kullanıcı menüde görmez ve sayfada sunucunun nedenini okur', async () => {
    stubFetch({
      '/auth/me': { body: { ...ADMIN, is_admin: false, email: 'uye@example.com' } },
      '/admin/stats': { status: 403, body: { detail: 'Bu sayfa yalnızca yöneticilere açıktır.' } },
    })
    open('/yonetim')
    expect(await screen.findByText('Bu sayfa yalnızca yöneticilere açıktır.')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Ana menü' })).queryByRole('link', { name: 'Yönetim' })).not.toBeInTheDocument()
  })
})
