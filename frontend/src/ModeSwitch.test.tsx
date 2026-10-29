import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { stubFetch } from './test/fixtures'


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
    expect(document.body).not.toHaveTextContent(/Geliştirme ortamı|Gerçek Bursa Envanteri/)
    const paths = pathsOf(fetchMock)
    expect(paths.some((p) => p.startsWith('/internal') || p.startsWith('/places') || p.endsWith('/passport'))).toBe(false)
  })

  it('eski ?mod=demo adresi genel platformu açar (demo oyunu kaldırıldı)', async () => {
    window.history.replaceState(null, '', '/?mod=demo')
    stubFetch({ '/monuments': { body: EMPTY_CATALOG } })
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Uygulama bölümleri' })).not.toBeInTheDocument()
  })

  it('?mod=envanter dahili envanteri açar; genel platform yüklenmez', async () => {
    window.history.replaceState(null, '', '/?mod=envanter')
    const fetchMock = stubFetch({ '/internal/session': { status: 401, body: { detail: 'Yetkisiz' } } })
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Gerçek Bursa Envanteri' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Dahili erişim anahtarı')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Uygulama bölümleri' })
    expect(within(nav).getByRole('link', { name: /Gerçek Bursa Envanteri/ })).toHaveAttribute('aria-current', 'page')
    expect(pathsOf(fetchMock)).toEqual(['/internal/session'])
    expect(screen.queryByRole('navigation', { name: 'Ana menü' })).not.toBeInTheDocument()
  })
})
