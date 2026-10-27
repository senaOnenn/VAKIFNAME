import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { placeRoutes, stubFetch } from './test/fixtures'

vi.mock('./components/PlaceMap', () => ({ default: () => <div>Harita yer tutucusu</div> }))
vi.mock('./catalog/MonumentMap', () => ({ default: () => <div>Eser haritası yer tutucusu</div> }))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const EMPTY_CATALOG = { published_count: 0, data_version: 'V20:test', generated_at: null, monuments: [] }
const pathsOf = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([input]) => new URL(String(input), window.location.href).pathname)

describe('genel platform ve geliştirme ortamı ayrımı', () => {
  it('varsayılan sayfa genel platformdur: açılışla başlar; mod seçici, geliştirme çubuğu veya demo bağlantısı yok', async () => {
    const fetchMock = stubFetch({ '/monuments': { body: EMPTY_CATALOG } })
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Uygulama bölümleri' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Geliştirme ortamı|Demo Keşif Oyunu|Gerçek Bursa Envanteri/)
    const paths = pathsOf(fetchMock)
    expect(paths.some((p) => p.startsWith('/internal') || p.startsWith('/places') || p.endsWith('/passport'))).toBe(false)
  })

  it('geliştirme sunucusunda ?mod=demo yalnızca otomatik testler için Demo Keşif Oyununu açar', async () => {
    window.history.replaceState(null, '', '/?mod=demo')
    const fetchMock = stubFetch(placeRoutes())
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Uygulama bölümleri' })
    expect(nav).toHaveTextContent('Geliştirme ortamı')
    expect(within(nav).getByRole('link', { name: /Demo Keşif Oyunu/ })).toHaveAttribute('aria-current', 'page')
    await screen.findByRole('list', { name: 'Eser listesi' })
    const paths = pathsOf(fetchMock)
    expect(paths.some((p) => p.startsWith('/internal') || p.startsWith('/monuments'))).toBe(false)
  })

  it('?mod=envanter dahili envanteri açar; demo eserleri, harita ve pasaport yüklenmez', async () => {
    window.history.replaceState(null, '', '/?mod=envanter')
    const fetchMock = stubFetch({ '/internal/session': { status: 401, body: { detail: 'Yetkisiz' } } })
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Gerçek Bursa Envanteri' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Dahili erişim anahtarı')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Uygulama bölümleri' })
    expect(within(nav).getByRole('link', { name: /Gerçek Bursa Envanteri/ })).toHaveAttribute('aria-current', 'page')
    expect(pathsOf(fetchMock)).toEqual(['/internal/session'])
    expect(screen.queryByText('Harita yer tutucusu')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Ana menü' })).not.toBeInTheDocument()
  })
})
