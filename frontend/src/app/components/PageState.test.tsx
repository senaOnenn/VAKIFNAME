import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../../test/fixtures'
import VakifnameApp from '../VakifnameApp'
import { INTRO_SEEN_KEY } from '../screens/Intro'
import { resetAuthForTests } from '../session'
import { PageState } from './PageState'

// Kurgusal test kayıtları (BUR-9xxx / KUT-9xxx gerçek katalog kimlikleri değildir).
vi.mock('./RouteMap', () => ({
  default: ({ points }: { points: { id: string; name: string }[] }) => (
    <ul aria-label="Harita noktaları">{points.map((p) => <li key={p.id}>Harita: {p.name}</li>)}</ul>
  ),
}))

describe('PageState', () => {
  it('yükleniyor durumu status rolüyle ve mesajıyla görünür, eylem düğmesi yoktur', () => {
    render(<PageState kind="loading" title="Eserler yükleniyor…" />)
    const st = screen.getByRole('status')
    expect(st).toHaveTextContent('Eserler yükleniyor…')
    expect(st).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('hata durumu alert rolüyle görünür; eylem verilmediyse yeniden dene düğmesi gösterilmez', () => {
    render(<PageState kind="error" title="Eserler yüklenemedi:">Sunucuya ulaşılamadı.</PageState>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Eserler yüklenemedi:')
    expect(alert).toHaveTextContent('Sunucuya ulaşılamadı.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('eylem verildiğinde düğme o işlevi çağırır', async () => {
    const retry = vi.fn()
    render(<PageState kind="error" title="Eserler yüklenemedi:" action={{ label: 'Tekrar dene', onClick: retry }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('boş ve filtre sonucu boş durumları status rolüyle mesaj gösterir', () => {
    const { unmount } = render(<PageState kind="empty" title="Katalogda henüz yayımlanmış eser yok." />)
    expect(screen.getByRole('status')).toHaveTextContent('Katalogda henüz yayımlanmış eser yok.')
    unmount()
    render(<PageState kind="filtered-empty" title="Seçilen filtrelerle eşleşen eser yok." />)
    expect(screen.getByRole('status')).toHaveTextContent('Seçilen filtrelerle eşleşen eser yok.')
  })

  it('bilgi durumu canlı bölge değildir ama metni görünür; simge ekran okuyucudan gizlidir', () => {
    const { container } = render(<PageState kind="info" title="Bilgi metni" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Bilgi metni')).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

// --- Eserler ekranındaki durumlar (gerçek ekran, sahte fetch) ---------------------------------------------------------
const summary = (id: string, name: string, type: string, city: string) => ({
  monument_id: id, name, alternative_names: [], type, city, district: 'Merkez', address: `${name} adresi`,
  location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20 }, checkin_available: false, fact_count: 1, game_fact_count: 1,
  image_count: 1, cover: { file: `${id}.jpeg`, attribution: `Fotoğraf: ${name} çekeni, CC BY-SA`, license: 'CC-BY-SA-4.0', title: null, source_url: null },
  lead: `${name} kısa giriş.`, illustration: 'representative_drawing',
})
const TWO_CITIES = {
  published_count: 2, data_version: 'test', generated_at: null,
  monuments: [summary('BUR-9001', 'Deneme Camii', 'cami', 'Bursa'), summary('KUT-9001', 'Deneme Türbesi', 'türbe', 'Kütahya')],
}
const catalog = (body: unknown, extra: Record<string, unknown> = {}) =>
  stubFetch({
    '/auth/me': { status: 401, body: { detail: 'Oturum açık değil.' } },
    '/monuments': { body },
    '/route': { status: 500, body: { detail: 'rota yok' } },
    ...(extra as Record<string, never>),
  })

function openList() {
  window.history.replaceState(null, '', '/eserler')
  return render(<VakifnameApp />)
}

describe('Eserler ekranının durumları', () => {
  beforeEach(() => {
    resetAuthForTests()
    window.localStorage.clear()
    window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    window.localStorage.setItem('vakifname.guest', '1')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('katalog yüklenirken yükleniyor durumu görünür', async () => {
    let release: (v: { body: unknown }) => void = () => undefined
    catalog(TWO_CITIES, { '/monuments': () => new Promise((r) => (release = r)) })
    openList()
    const loading = (await screen.findByText('Eserler yükleniyor…')).closest('[role="status"]')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    release({ body: TWO_CITIES })
    expect(await screen.findByRole('heading', { name: 'Deneme Camii' }, { timeout: 3000 })).toBeInTheDocument()
  })

  it('katalog yüklenemezse hata uyarısı ve çalışan "Tekrar dene" görünür', async () => {
    let calls = 0
    catalog(TWO_CITIES, {
      '/monuments': () => (++calls === 1 ? { status: 500, body: { detail: 'Sunucu hatası' } } : { body: TWO_CITIES }),
    })
    openList()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Eserler yüklenemedi:')
    await userEvent.click(within(alert).getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByRole('heading', { name: 'Deneme Camii' })).toBeInTheDocument()
    expect(calls).toBe(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('katalog boşsa boş durum görünür; filtre temizleme düğmesi yoktur', async () => {
    catalog({ ...TWO_CITIES, published_count: 0, monuments: [] })
    openList()
    expect(await screen.findByText('Katalogda henüz yayımlanmış eser yok.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filtreleri temizle' })).not.toBeInTheDocument()
  })

  it('filtre sonucu boşsa filtreyi temizleme seçeneği sunulur; temizleyince bütün eserler geri gelir', async () => {
    catalog(TWO_CITIES)
    openList()
    await screen.findByRole('heading', { name: 'Deneme Camii' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Şehir' }), 'bursa')
    await userEvent.click(within(screen.getByRole('group', { name: 'Eser türü' })).getByRole('button', { name: 'Türbe' }))
    expect(screen.getByText('0 eser')).toBeInTheDocument()
    expect(screen.getByText('Seçilen filtrelerle eşleşen eser yok.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Filtreleri temizle' }))
    expect(screen.getByText('2 eser')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Deneme Camii' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Deneme Türbesi' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Şehir' })).toHaveValue('')
    expect(within(screen.getByRole('group', { name: 'Eser türü' })).getByRole('button', { name: 'Tümü' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2 eser')).toHaveFocus()
    expect(screen.queryByText('Seçilen filtrelerle eşleşen eser yok.')).not.toBeInTheDocument()
  })

  it('normal durumda kartlar ve görsel atıfları değişmeden listelenir', async () => {
    catalog(TWO_CITIES)
    openList()
    expect(await screen.findByRole('heading', { name: 'Deneme Camii' })).toBeInTheDocument()
    expect(screen.getByText('2 eser')).toBeInTheDocument()
    expect(screen.getByText('Fotoğraf: Deneme Camii çekeni, CC BY-SA')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
