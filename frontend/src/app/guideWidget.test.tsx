import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import VakifnameApp from './VakifnameApp'

// R3.11: site genelinde tek "Rehbere Sor". Kurgusal eser (BUR-9xxx gerçek katalog kimliği değildir).
const LOC = { latitude: 40.18, longitude: 29.06, accuracy_m: 20 }
const DETAIL = {
  monument_id: 'BUR-9001', name: 'Deneme Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
  address: 'Deneme adresi', location: { ...LOC, represents: 'building_footprint_centroid' }, checkin_available: false,
  checkin: null, site_notice: null, illustration: 'representative_drawing', images: [],
  facts: [{ fact_id: 'BUR-9001-F001', title: 'Kayıt 1', text: 'Kayıt 1 metni.', category: 'construction', certainty: 'documented',
    source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 21, page_kind: 'physical' }, game_use: true }],
}
const CATALOG = {
  published_count: 1, data_version: 't', generated_at: null,
  monuments: [{ monument_id: 'BUR-9001', name: 'Deneme Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
    address: 'Deneme adresi', location: LOC, checkin_available: false, fact_count: 1, game_fact_count: 1, image_count: 0,
    cover: null, lead: null, illustration: 'representative_drawing' }],
}
const answer = (text: string) => ({
  question: 'q', mode: 'generative', status: 'answered', message: '', sentences: [{ text, sources: ['BUR-9001-F001'] }],
  facts: [{ fact_id: 'BUR-9001-F001', monument_id: 'BUR-9001', monument_name: 'Deneme Camii', title: 'Kayıt 1', text: '...',
    category: 'construction', certainty: 'documented', certainty_label: 'Kaynaklarda belgelenmiş',
    sources: [{ title: 'K', publisher: 'Yayıncı', url: 'https://example.org/k' }], publication_decision_id: 'DEC-1' }],
  identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [], photo: null, search: null,
  fallback_reason: null, notice: '', usage: { calls: 1, prompt_tokens: 1, completion_tokens: 1, total_ms: 1 },
})

function open(path: string) {
  const fetchMock = stubFetch({
    '/auth/me': { status: 401, body: {} },
    '/monuments': { body: CATALOG },
    '/monuments/BUR-9001': { body: DETAIL },
    '/route': { status: 500, body: { detail: 'x' } },
    '/guide/status': { body: { enabled: true, configured: true } },
    '/guide/ask': (init?: RequestInit) => {
      const body = JSON.parse(String(init!.body))
      return { body: answer(body.monument_id ? 'Eser cevabı.' : 'Genel cevap.') }
    },
  })
  window.history.replaceState(null, '', path)
  render(<VakifnameApp />)
  return fetchMock
}
const fabs = () => screen.queryAllByRole('button', { name: 'Rehbere Sor' })
const drawer = () => screen.queryByRole('dialog', { name: 'Rehber' })
const asks = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter(([u]) => new URL(String(u)).pathname === '/guide/ask')
const go = async (path: string) => {
  await act(async () => {
    window.history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}
async function ask(text: string) {
  const box = await within(drawer()!).findByRole('textbox', { name: 'Sorunu yaz' })
  await vi.waitFor(() => expect(box).toBeEnabled())
  await userEvent.type(box, text)
  await userEvent.click(within(drawer()!).getByRole('button', { name: 'Sor' }))
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('site genelinde Rehbere Sor', () => {
  it.each(['/', '/eserler', '/harita', '/eser/BUR-9001', '/oyun'])('%s sayfasında tam bir kez görünür', async (path) => {
    open(path)
    await vi.waitFor(() => expect(fabs()).toHaveLength(1))
    expect(fabs()[0]).toHaveAttribute('aria-expanded', 'false')
    expect(drawer()).not.toBeInTheDocument()  // ilk açılışa kadar sohbet oluşturulmaz (API çağrısı yok)
  })

  it.each(['/rehber', '/giris', '/oyun/eser/BUR-9001/rozet'])('%s sayfasında gösterilmez (rehber sayfası, giriş, Rozeti Al soruları)', async (path) => {
    open(path)
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(fabs()).toHaveLength(0)
  })

  it('genel sayfalarda genel sohbet (eser kimliği yok); sayfalar arasında sohbet korunur', async () => {
    const f = open('/eserler')
    await vi.waitFor(() => expect(fabs()).toHaveLength(1))
    await userEvent.click(fabs()[0])
    expect(drawer()).toHaveAccessibleDescription('Yerel rehber, canlandırma. Konu: bütün eserler')
    await ask('Vakfiye nedir?')
    expect(await within(drawer()!).findByText('Genel cevap.')).toBeInTheDocument()
    expect(JSON.parse(String(asks(f)[0][1]!.body)).monument_id ?? null).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(drawer()).not.toBeInTheDocument()
    expect(fabs()[0]).toHaveFocus()
    await go('/harita')
    await userEvent.click(fabs()[0])
    expect(within(drawer()!).getByText('Genel cevap.')).toBeInTheDocument()  // gezinmede sohbet sıfırlanmaz
  })

  it('eser sayfasında eser sohbeti (eser kimliğiyle, anlatım ayrı sekmede); genel sohbete karışmaz', async () => {
    const f = open('/eser/BUR-9001')
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await userEvent.click(fabs()[0])
    await vi.waitFor(() => expect(drawer()).toHaveAccessibleDescription('Yerel rehber, canlandırma. Konu: Deneme Camii'))
    expect(await within(drawer()!).findByRole('tab', { name: 'Anlatım' })).toHaveAttribute('aria-selected', 'false')  // kendiliğinden konuşmaz
    await ask('Kim yaptırdı?')
    expect(await within(drawer()!).findByText('Eser cevabı.')).toBeInTheDocument()
    expect(JSON.parse(String(asks(f)[0][1]!.body))).toMatchObject({ monument_id: 'BUR-9001' })
    await go('/eserler')
    await vi.waitFor(() => expect(drawer()).toHaveAccessibleDescription('Yerel rehber, canlandırma. Konu: bütün eserler'))
    expect(within(drawer()!).getByText('Eser cevabı.')).not.toBeVisible()  // eser sohbeti gizli, genel sohbete karışmaz
    await go('/eser/BUR-9001')
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    await vi.waitFor(() => expect(within(drawer()!).getByText('Eser cevabı.')).toBeInTheDocument())  // aynı esere dönünce korunur
  })

  it('rehberin gizlendiği sayfaya geçilince panel kapanır, dönünce sohbet yerinde', async () => {
    open('/eserler')
    await vi.waitFor(() => expect(fabs()).toHaveLength(1))
    await userEvent.click(fabs()[0])
    await ask('Vakfiye nedir?')
    await within(drawer()!).findByText('Genel cevap.')
    await go('/rehber')
    expect(fabs()).toHaveLength(0)
    await go('/eserler')
    expect(drawer()).not.toBeInTheDocument()
    await userEvent.click(fabs()[0])
    expect(within(drawer()!).getByText('Genel cevap.')).toBeInTheDocument()
  })
})
