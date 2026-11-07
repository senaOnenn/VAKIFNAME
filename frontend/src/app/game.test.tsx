import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYER, stubFetch, SIGNED_IN, PROFILE } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import type { GameState, Quiz } from './api'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'

vi.mock('./components/RouteMap', () => ({ default: () => <div>harita</div> }))

const ID = 'BUR-1001'
const game = (over: Partial<GameState> = {}): GameState => ({
  monument_id: ID, locked: false, listened: false, asked: false, started: false, guide_required: false, ready_for_quiz: false, quiz_available: true,
  quiz_size: 5, pass_mark: 4, knowledge: null, visit: null, visit_radius_m: 50, simulated_visit_allowed: false, site_notice: null,
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
    '/auth/me': SIGNED_IN,
    '/player/profile': PROFILE,
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

describe('mühür yolu (oyun paneli)', () => {
  it('R6.7: esere tıklayınca görev ekranı; dinlemeden doğrudan "Göreve Başla"; yarım kalan görevde "Göreve Devam Et"', async () => {
    const srv = server(game({ ready_for_quiz: true }))
    const { unmount } = open(`/oyun/eser/${ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Bursa Ulu Camii' })).toBeInTheDocument()
    expect(screen.getByText('Henüz keşfedilmedi')).toBeInTheDocument()
    // Tek ana eylem; dinleme şartı, kilit ve üç sütunlu mühür yolu yok.
    expect(screen.getByRole('link', { name: 'Göreve Başla' })).toHaveAttribute('href', `/oyun/eser/${ID}/rozet`)
    expect(screen.getByRole('heading', { name: '5 soru, en az 4 doğru' })).toBeInTheDocument()
    expect(screen.queryByText(/kilitli/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Mühür yolu' })).not.toBeInTheDocument()
    // Bilgi mührü olmadan ziyaret (bonus) görünmez.
    expect(screen.queryByRole('heading', { name: 'Eseri yerinde ziyaret et' })).not.toBeInTheDocument()
    unmount()
    srv.set(game({ ready_for_quiz: true, started: true }))
    open(`/oyun/eser/${ID}`)
    expect(await screen.findByRole('link', { name: 'Göreve Devam Et' })).toHaveAttribute('href', `/oyun/eser/${ID}/rozet`)
    expect(screen.getByText('Göreve başlandı')).toBeInTheDocument()
  })

  it('R6.8: görevi hazır olmayan eserde dürüst içerik durumu; çalışmayan düğme yok; hazır başka göreve geçiş', async () => {
    server(game({ quiz_available: false }), {
      '/route': { body: { city: 'bursa', total: 2, completed_count: 0, next: ID,
        start: { source: 'city_center', latitude: 40.18, longitude: 29.06 }, completed: [],
        stops: [
          { monument_id: ID, name: 'Bursa Ulu Camii', type: 'cami', latitude: 40.18, longitude: 29.06, state: 'unlocked', progress: 'new', quest_ready: false, distance_m: 100, order: 1 },
          { monument_id: 'BUR-9002', name: 'Hazır Eser', type: 'han', latitude: 40.19, longitude: 29.07, state: 'unlocked', progress: 'new', quest_ready: true, distance_m: 300, order: 2 },
        ] } },
    })
    open(`/oyun/eser/${ID}`)
    expect(await screen.findByRole('heading', { name: 'Görev hazırlanıyor' })).toBeInTheDocument()
    expect(screen.getByText(/onaylı kayıtlarından henüz 5 soru çıkmıyor/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Göreve Başla' })).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Hazır bir görevle devam et: Hazır Eser' })).toHaveAttribute('href', '/oyun/eser/BUR-9002')
    // Tarihî kayıtlar ve hikâye yine erişilebilir; sistem hatası gibi gösterilmez.
    expect(screen.getByRole('button', { name: 'Tarih Defteri' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hikâyeyi dinle' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('R6.8: eski sunucu (quiz_available yok) "soru yok" diye yanlış söylenmez; sunucunun güncel olmadığı söylenir', async () => {
    const old = game({ ready_for_quiz: false }) as Partial<GameState>
    delete old.quiz_available
    server(old as GameState)
    open(`/oyun/eser/${ID}`)
    expect(await screen.findByText(/Oyun sunucusu güncel değil/)).toBeInTheDocument()
    expect(screen.queryByText(/henüz 5 soru çıkmıyor|yeterli onaylı soru/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Göreve Başla' })).not.toBeInTheDocument()
  })

  it('R6.7: isteğe bağlı "Hikâyeyi dinle" rehberi aynı ekranda anlatım sekmesiyle açar; "Tarih Defteri" pencerede açılır', async () => {
    server(game({ ready_for_quiz: true }))
    open(`/oyun/eser/${ID}`)
    await screen.findByRole('link', { name: 'Göreve Başla' })
    await userEvent.click(screen.getByRole('button', { name: 'Hikâyeyi dinle' }))
    expect(await screen.findByRole('tab', { name: 'Anlatım', selected: true })).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/oyun/eser/${ID}`)
    await userEvent.keyboard('{Escape}')
    const bookBtn = screen.getByRole('button', { name: 'Tarih Defteri' })
    await userEvent.click(bookBtn)
    expect(bookBtn).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('R6.7: tamamlanan görevde bilgi mührü ve XP sonucu; ziyaret ayrı bonus görev olarak görünür', async () => {
    server(game({ knowledge: { earned_at: '2026-10-27T10:00:00Z' } }))
    open(`/oyun/eser/${ID}`)
    expect(await screen.findByRole('heading', { name: 'Bilgi mührü kazanıldı' })).toBeInTheDocument()
    expect(screen.getByText(/\+50 XP · vakfiyenin bir parçası yerine oturdu/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Göreve Başla' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Eseri yerinde ziyaret et' })).toBeInTheDocument()
    expect(screen.getByText(/Konumun kaydedilmez/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Konumumu doğrula' })).toBeEnabled()
  })

  it('anlatım sonuna kadar dinlenince sunucuya "listened" bildirilir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const srv = server(game())
    open(`/eser/${ID}`)
    // Eser sayfası katalogdur (R3.7): oyun kontrolleri, mühür ve kademeler yok; yalnızca oyun paneline tek bağlantı.
    expect(await screen.findByRole('link', { name: 'Bilgi Görevine Başla' })).toHaveAttribute('href', `/oyun/eser/${ID}`)
    expect(screen.queryByRole('button', { name: 'Rozeti Al' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /kademe/ })).not.toBeInTheDocument()
    srv.set(game({ asked: true, ready_for_quiz: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Rehbere Sor' }))  // R3.9: rehber paneli
    await userEvent.click(screen.getByRole('tab', { name: 'Anlatım' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await vi.waitFor(() => expect(srv.calls.some((c) => c.path === 'engagement')).toBe(true))
    expect(srv.calls.find((c) => c.path === 'engagement')!.body).toMatchObject({ event: 'listened', user_id: expect.stringMatching(/^u-oyuncu$/) })
  })

  it('bilgi mühründen sonra ziyaret: konum gönderilir, altın mühür olur', async () => {
    let visitBody: Record<string, unknown> = {}
    server(game({ knowledge: { earned_at: '2026-10-27T10:00:00Z' }, listened: true, asked: true }), {
      [`/monuments/${ID}/visit`]: (init?: RequestInit) => {
        visitBody = JSON.parse(String(init!.body))
        return { body: { status: 'gold', distance_m: 12, radius_m: 50, visit_seal: { earned_at: '2026-10-27T11:00:00Z' } } }
      },
    })
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 40.1839, longitude: 29.0619 } } as GeolocationPosition) } })
    open(`/oyun/eser/${ID}`)
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
        return { body: { status: 'gold', distance_m: null, radius_m: 50, visit_seal: { earned_at: '2026-10-27T11:00:00Z' } } }
      },
    })
    open(`/oyun/eser/${ID}`)
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
    open(`/oyun/eser/${ID}/rozet`)
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
    open(`/oyun/eser/${ID}/rozet`)
    expect(await screen.findByText('Önce anlatımı dinleyip rehbere bir soru sormalısın.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Göreve dön' })).toHaveAttribute('href', `/oyun/eser/${ID}`)
  })
})

describe('pasaport', () => {
  it('yapboz bulunan ve altın parçaları sayar; mühür listesi simüle edilmiş ziyareti belirtir', async () => {
    const summary = (id: string, name: string) => ({
      monument_id: id, name, type: 'cami', city: 'Bursa', district: 'Osmangazi', address: '-',
      location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20 }, // R6.9: vakfiye rotadaki (konumlu) eserlerden
      checkin_available: false, fact_count: 1, game_fact_count: 1, image_count: 0, illustration: 'representative_drawing',
    })
    const seal = (id: string, name: string, kind: string, simulated = false) => ({ user_id: 'x', monument_id: id, monument_name: name, kind, earned_at: '2026-10-27T10:00:00Z', simulated })
    const fetchMock = stubFetch({})
    // R6.2: pasaport hesabındır; mühür defteri oturumdaki hesabın kimliğiyle istenir.
    const vid = PLAYER.user_id
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (path === '/auth/me') return json(PLAYER)
      if (path === '/player/profile') return json(PROFILE.body)
      if (path === '/monuments') return json({ published_count: 3, data_version: 't', generated_at: null, monuments: [summary('BUR-1001', 'Bir'), summary('BUR-1002', 'İki'), summary('BUR-1003', 'Üç')] })
      if (path === `/users/${vid}/seals`)
        return json({ user_id: vid, knowledge_seals: [seal('BUR-1001', 'Bir', 'knowledge'), seal('BUR-1002', 'İki', 'knowledge')], visit_seals: [seal('BUR-1002', 'İki', 'visit', true)], monuments: [] })
      return json({ detail: 'yok' }, 404)
    })
    open('/pasaport')
    expect(await screen.findByRole('heading', { name: 'Kayıp Vakfiye' })).toBeInTheDocument()
    expect(screen.getByText('3 parçadan 2 parça bulundu, 1 parça altın.')).toBeInTheDocument()  // sayılar bir kez (R6.16)
    expect(screen.getByRole('img', { name: /Kayıp Vakfiye: 3 parçadan 2 parça bulundu, 1 parça altın/ })).toBeInTheDocument()
    const list = within(screen.getByRole('region', { name: 'Mühürler' }))
    expect(list.getByText(/Altın · ziyaret .*\(simülasyon\)/)).toBeInTheDocument()
    expect(list.getByText('Henüz yok')).toBeInTheDocument()
    // R6.16: her eser tek satır; bilgi ve altın mühür ayrı işaretli.
    const rows = list.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    const marks = (i: number) => within(rows[i]).getAllByRole('img').map((m) => m.getAttribute('aria-label'))
    expect(marks(0)).toEqual(['Bilgi mührü kazanıldı', 'Altın mühür yok'])
    expect(marks(1)).toEqual(['Bilgi mührü kazanıldı', 'Altın mühür kazanıldı'])
    expect(marks(2)).toEqual(['Bilgi mührü yok', 'Altın mühür yok'])
    expect(within(rows[1]).getByRole('link', { name: 'İki' })).toHaveAttribute('href', '/oyun/eser/BUR-1002')
    // Künye: karakter, seviye ve XP sunucudan.
    const crest = screen.getByRole('region', { name: 'Kâşifin' })
    expect(within(crest).getByText('Seviye 1')).toBeInTheDocument()
    expect(within(crest).getByText('0 / 50 XP')).toBeInTheDocument()
    // Ayrı sayaç paneli yok (aynı bilgi tekrar edilmez).
    expect(screen.queryByRole('heading', { name: 'Kazanılanlar' })).not.toBeInTheDocument()
  })
})
