import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import type { GameState, Quiz } from './api'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'

vi.mock('./components/RouteMap', () => ({ default: () => <div>harita</div> }))

const ID = 'BUR-1001'
const game = (over: Partial<GameState> = {}): GameState => ({
  monument_id: ID, locked: false, listened: false, asked: false, guide_required: true, ready_for_quiz: false,
  quiz_size: 5, pass_mark: 4, knowledge: null, visit: null, visit_radius_m: 35, simulated_visit_allowed: false, site_notice: null,
  ...over,
})
const DETAIL = {
  monument_id: ID, name: 'Bursa Ulu Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
  address: 'Atatürk Caddesi', location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20, represents: 'building_footprint_centroid' },
  checkin_available: false, checkin: null, site_notice: null, illustration: 'representative_drawing',
  facts: [{ fact_id: 'F1', title: 'Yapım', text: 'Yapıyı Yıldırım Bayezid yaptırdı.', category: 'construction', certainty: 'documented',
    source: { title: 'Cilt I', pdf_physical_page: 20, page_kind: 'physical' }, game_use: true }],
  images: [],
}
const QUIZ: Quiz = {
  quiz_id: 'q-1', expires_at: '2026-10-27T12:00:00Z',
  questions: [
    { qid: 'a', kind: 'image_pick', prompt: 'Hangisi Bursa Ulu Camii?', images: [{ file: 'x.jpeg', attribution: 'Foto X' }, { file: 'y.jpeg', attribution: 'Foto Y' }, { file: 'z.jpeg', attribution: null }] },
    { qid: 'b', kind: 'true_false', prompt: 'Bu bilgi Bursa Ulu Camii ile mi ilgili?', statement: 'Yirmi kubbeyle örtülüdür.' },
    { qid: 'c', kind: 'choice', prompt: 'Kim yaptırdı?', choices: ['II. Murad', 'Yıldırım Bayezid', 'Orhan Gazi'] },
    { qid: 'd', kind: 'choice', prompt: 'Minber tekniği?', choices: ['Kündekâri', 'Malakâri'] },
    { qid: 'e', kind: 'choice', prompt: 'Kaç kubbe?', choices: ['12', '20'] },
  ],
}
const result = (score: number) => ({
  score, total: 5, passed: score >= 4,
  results: QUIZ.questions.map((q, i) => ({ qid: q.qid, correct: i < score, correct_choice: 1, explanation: `Açıklama ${q.qid}`, fact: { title: 'Yapım', text: '...', source: 'Cilt I, s. 20' } })),
  knowledge_seal: score >= 4 ? { earned_at: '2026-10-27T10:00:00Z', new: true } : null,
})

type Calls = { path: string; body: Record<string, unknown> }[]
function server(state: GameState, extra: Record<string, unknown> = {}) {
  const calls: Calls = []
  let s = state
  const rec = (path: string) => (init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : {} })
    return undefined
  }
  const fetchMock = stubFetch({
    '/auth/me': { status: 401, body: {} },
    '/guide/status': { body: { enabled: true } },
    [`/monuments/${ID}`]: { body: DETAIL },
    '/route': { status: 500, body: {} },
    [`/monuments/${ID}/game`]: () => ({ body: s }),
    [`/monuments/${ID}/engagement`]: (init?: RequestInit) => {
      rec('engagement')(init)
      const ev = JSON.parse(String(init!.body)).event
      s = { ...s, [ev]: true }
      return { body: s }
    },
    ...(extra as Record<string, never>),
  })
  return { calls, fetchMock, set: (n: GameState) => (s = n) }
}

function open(path: string) {
  window.history.replaceState(null, '', path)
  return render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('mühür yolu (eser sayfası)', () => {
  it('kilitli eserde oyun yerine kilit açıklaması ve rotaya dönüş verir', async () => {
    server(game({ locked: true }))
    open(`/eser/${ID}`)
    expect(await screen.findByText(/Bu eser henüz kilitli/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rotaya dön' })).toHaveAttribute('href', '/rota/bursa')
  })

  it('I. kademe bitmeden "Rozeti Al" kapalıdır; hazır olunca sınava götürür', async () => {
    const srv = server(game())
    const { unmount } = open(`/eser/${ID}`)
    expect(await screen.findByRole('button', { name: 'Rozeti Al' })).toBeDisabled()
    unmount()
    srv.set(game({ listened: true, asked: true, ready_for_quiz: true }))
    open(`/eser/${ID}`)
    expect(await screen.findByRole('link', { name: 'Rozeti Al' })).toHaveAttribute('href', `/eser/${ID}/rozet`)
  })

  it('anlatım sonuna kadar dinlenince sunucuya "listened" bildirilir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const srv = server(game())
    open(`/eser/${ID}`)
    await screen.findByRole('button', { name: 'Rozeti Al' })
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(await screen.findByText(/Anlatımı dinledin ✓/)).toBeInTheDocument()
    expect(srv.calls.find((c) => c.path === 'engagement')!.body).toMatchObject({ event: 'listened', user_id: expect.stringMatching(/^ziyaretci-/) })
  })

  it('bilgi mühründen sonra ziyaret: konum gönderilir, altın mühür olur', async () => {
    let visitBody: Record<string, unknown> = {}
    server(game({ knowledge: { earned_at: '2026-10-27T10:00:00Z' }, listened: true, asked: true }), {
      [`/monuments/${ID}/visit`]: (init?: RequestInit) => {
        visitBody = JSON.parse(String(init!.body))
        return { body: { status: 'gold', distance_m: 12, radius_m: 35, visit_seal: { earned_at: '2026-10-27T11:00:00Z' } } }
      },
    })
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 40.1839, longitude: 29.0619 } } as GeolocationPosition) } })
    open(`/eser/${ID}`)
    expect(screen.queryByRole('button', { name: /Sunum modu/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Konumumu doğrula' }))
    expect(await screen.findByText('Ziyaretin doğrulandı. Mührün altına dönüştü!')).toBeInTheDocument()
    expect(visitBody).toMatchObject({ latitude: 40.1839, longitude: 29.0619 })
    expect(visitBody).not.toHaveProperty('simulate')
  })

  it('ziyaret simülasyonu yalnızca izinliyse görünür ve açıkça simülasyon olarak gönderilir', async () => {
    let visitBody: Record<string, unknown> = {}
    server(game({ knowledge: { earned_at: '2026-10-27T10:00:00Z' }, simulated_visit_allowed: true }), {
      [`/monuments/${ID}/visit`]: (init?: RequestInit) => {
        visitBody = JSON.parse(String(init!.body))
        return { body: { status: 'gold', distance_m: null, radius_m: 35, visit_seal: { earned_at: '2026-10-27T11:00:00Z' } } }
      },
    })
    open(`/eser/${ID}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Sunum modu: ziyareti simüle et' }))
    await screen.findByText('Ziyaretin doğrulandı. Mührün altına dönüştü!')
    expect(visitBody).toMatchObject({ simulate: true })
  })
})

describe('Rozeti Al (sınav)', () => {
  async function answerAll() {
    await userEvent.click(await screen.findByRole('radio', { name: /^Seçenek 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }))
    expect(screen.getByText('Yirmi kubbeyle örtülüdür.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Doğru' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Yıldırım Bayezid' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Kündekâri' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }))
    expect(screen.getByRole('button', { name: 'Cevapları gönder' })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: '20' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cevapları gönder' }))
  }

  it('5 soru cevaplanır; 4 doğru ile bilgi mührü kazanılır, cevaplar kaynaklarıyla gösterilir', async () => {
    let submitted: Record<string, unknown> = {}
    const { fetchMock } = server(game({ ready_for_quiz: true }), {
      [`/monuments/${ID}/quiz`]: { status: 201, body: QUIZ },
      '/quiz/q-1/submit': (init?: RequestInit) => {
        submitted = JSON.parse(String(init!.body))
        return { body: result(4) }
      },
    })
    open(`/eser/${ID}/rozet`)
    expect(await screen.findByText('Soru 1 / 5')).toBeInTheDocument()
    await answerAll()
    expect(await screen.findByRole('heading', { name: 'Bilgi mührünü kazandın!' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Bilgi mührü' })).toBeInTheDocument()
    expect(submitted.answers).toEqual([{ qid: 'a', choice: 0 }, { qid: 'b', choice: 1 }, { qid: 'c', choice: 1 }, { qid: 'd', choice: 0 }, { qid: 'e', choice: 1 }])
    expect(screen.getAllByText('Kaynak: Cilt I, s. 20')).toHaveLength(5)
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/quiz'))).toHaveLength(1)
  })

  it('3 doğruda mühür verilmez; "Yeniden dene" yeni sınav açar', async () => {
    const { fetchMock } = server(game({ ready_for_quiz: true }), {
      [`/monuments/${ID}/quiz`]: { status: 201, body: QUIZ },
      '/quiz/q-1/submit': { body: result(3) },
    })
    open(`/eser/${ID}/rozet`)
    await answerAll()
    expect(await screen.findByRole('heading', { name: 'Bu sefer olmadı' })).toBeInTheDocument()
    expect(screen.getByText(/en az 4 doğru gerekiyordu/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }))
    expect(await screen.findByText('Soru 1 / 5')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/quiz'))).toHaveLength(2)
  })

  it('sunucu sınavı reddederse (ör. I. kademe bitmedi) nedenini ve geri dönüşü gösterir', async () => {
    server(game(), { [`/monuments/${ID}/quiz`]: { status: 409, body: { detail: 'Önce anlatımı dinleyip rehbere bir soru sormalısın.' } } })
    open(`/eser/${ID}/rozet`)
    expect(await screen.findByText('Önce anlatımı dinleyip rehbere bir soru sormalısın.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Esere dön' })).toHaveAttribute('href', `/eser/${ID}`)
  })
})

describe('pasaport', () => {
  it('yapboz bulunan ve altın parçaları sayar; mühür listesi simüle edilmiş ziyareti belirtir', async () => {
    const summary = (id: string, name: string) => ({
      monument_id: id, name, type: 'cami', city: 'Bursa', district: 'Osmangazi', address: '-', location: null,
      checkin_available: false, fact_count: 1, game_fact_count: 1, image_count: 0, illustration: 'representative_drawing',
    })
    const seal = (id: string, name: string, kind: string, simulated = false) => ({ user_id: 'x', monument_id: id, monument_name: name, kind, earned_at: '2026-10-27T10:00:00Z', simulated })
    const fetchMock = stubFetch({})
    // Misafir kimliği önceden sabitlenir ki mühür defteri yolu bilinsin.
    const vid = 'ziyaretci-0b8f2c1e-1a2b-4c3d-8e9f-0123456789ab'
    window.localStorage.setItem('vakifname.visitorId', vid)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (path === '/auth/me') return json({}, 401)
      if (path === '/monuments') return json({ published_count: 3, data_version: 't', generated_at: null, monuments: [summary('BUR-1001', 'Bir'), summary('BUR-1002', 'İki'), summary('BUR-1003', 'Üç')] })
      if (path === `/users/${vid}/seals`)
        return json({ user_id: vid, knowledge_seals: [seal('BUR-1001', 'Bir', 'knowledge'), seal('BUR-1002', 'İki', 'knowledge')], visit_seals: [seal('BUR-1002', 'İki', 'visit', true)], monuments: [] })
      return json({ detail: 'yok' }, 404)
    })
    open('/pasaport')
    expect(await screen.findByRole('heading', { name: 'Kayıp Vakfiye' })).toBeInTheDocument()
    expect(screen.getByText('3 parçadan 2 parça bulundu, 1 parça altın. Her bilgi mührü bir parça getirir.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Kayıp Vakfiye: 3 parçadan 2 parça bulundu, 1 parça altın/ })).toBeInTheDocument()
    const list = within(screen.getByRole('region', { name: 'Mühürler' }))
    expect(list.getByText(/Altın · ziyaret .*\(simülasyon\)/)).toBeInTheDocument()
    expect(list.getByText('Henüz yok')).toBeInTheDocument()
  })
})
