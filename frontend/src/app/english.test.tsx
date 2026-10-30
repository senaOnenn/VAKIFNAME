import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { Narrator } from './components/Narrator'
import { factIn, nameOf, textIn } from './contentLang'
import { resetLangForTests, setLang } from './i18n'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import { pickVoice } from './speech'
import VakifnameApp from './VakifnameApp'

// Faz 11: İngilizce seçiliyken içeriğin onaylı İngilizcesi gösterilir; yoksa Türkçe metin "Türkçe" diye etiketlenir.
// Tarihî içerikte makine çevirisi yoktur.

const src = (page: number) => ({ title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: page, page_kind: 'physical' as const })
const DETAIL = {
  monument_id: 'BUR-1001', name: 'Bursa Ulu Camii', name_en: 'Bursa Grand Mosque', alternative_names: [], type: 'cami',
  city: 'Bursa', district: 'Osmangazi', address: 'Atatürk Caddesi', location: null, checkin_available: false, checkin: null,
  site_notice: 'Aktif ibadet mekânıdır; sessiz olun.', site_notice_en: 'This is an active place of worship; please keep quiet.',
  illustration: 'representative_drawing', images: [],
  facts: [
    { fact_id: 'F1', title: 'Yirmi kubbe', text: 'Yapıyı yirmi kubbe örter.', title_en: 'Twenty domes',
      text_en: 'The building is covered by twenty domes.', en_page: 121, category: 'architecture', certainty: 'documented',
      source: src(21), game_use: true },
    { fact_id: 'F2', title: 'Bir rivayet', text: 'Halk arasında anlatılır.', category: 'historical_event', certainty: 'reported',
      source: src(22), game_use: false },
  ],
}

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
  setLang('en')
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetLangForTests()
})

function open(path: string, extra: Record<string, unknown> = {}) {
  const fetchMock = stubFetch({
    '/auth/me': { status: 401, body: {} },
    '/guide/status': { body: { enabled: false } },
    '/monuments/BUR-1001': { body: DETAIL },
    '/route': { status: 500, body: {} },
    ...(extra as Record<string, never>),
  })
  window.history.replaceState(null, '', path)
  render(<VakifnameApp />)
  return fetchMock
}

describe('içerik dili seçimi', () => {
  it('İngilizcesi onaylıysa onu, değilse Türkçeyi "yalnızca Türkçe" işaretiyle verir', () => {
    expect(nameOf(DETAIL, 'en')).toBe('Bursa Grand Mosque')
    expect(nameOf({ name: 'Koza Han', name_en: null }, 'en')).toBe('Koza Han')
    expect(nameOf(DETAIL, 'tr')).toBe('Bursa Ulu Camii')
    expect(factIn(DETAIL.facts[0], 'en')).toEqual({ title: 'Twenty domes', text: 'The building is covered by twenty domes.', page: 121, turkishOnly: false })
    expect(factIn(DETAIL.facts[1], 'en')).toEqual({ title: 'Bir rivayet', text: 'Halk arasında anlatılır.', page: 22, turkishOnly: true })
    expect(factIn(DETAIL.facts[0], 'tr').turkishOnly).toBe(false)
    expect(textIn('Türkçe', null, 'en')).toEqual({ text: 'Türkçe', turkishOnly: true })
    expect(textIn(null, null, 'en')).toEqual({ text: '', turkishOnly: false })
  })

  it('İngilizce anlatım için tarayıcının İngilizce sesi seçilir', () => {
    const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice
    expect(pickVoice([v('Yelda', 'tr-TR'), v('Daniel', 'en-GB'), v('Moira', 'en-IE')], 'en')!.name).toBe('Daniel')
    expect(pickVoice([v('Moira', 'en-IE')], 'en')!.name).toBe('Moira')
    expect(pickVoice([v('Yelda', 'tr-TR')], 'en')).toBeNull()
    expect(pickVoice([v('Daniel', 'en-GB'), v('Yelda', 'tr-TR')], 'tr')!.name).toBe('Yelda')
  })
})

describe('eser sayfası (İngilizce)', () => {
  it('ad, uyarı ve kayıtlar onaylı İngilizcesiyle; İngilizcesi olmayan kayıt Türkçe ve etiketli', async () => {
    open('/eser/BUR-1001')
    expect(await screen.findByRole('heading', { level: 1, name: 'Bursa Grand Mosque' })).toBeInTheDocument()
    expect(screen.getByText('This is an active place of worship; please keep quiet.')).toBeInTheDocument()
    const facts = screen.getByRole('region', { name: 'History and sources' })
    expect(within(facts).getByRole('heading', { name: 'Twenty domes' })).toBeInTheDocument()
    expect(within(facts).getByText(/Source: Bursa Vakıf Eserleri, Cilt I, p\. 121/)).toBeInTheDocument()
    const tr = within(facts).getByText('Halk arasında anlatılır.')
    expect(tr).toHaveAttribute('lang', 'tr')
    expect(within(facts).getAllByText(/No approved English version of this record yet/)).toHaveLength(1)
  })

  it('anlatım yalnızca İngilizcesi onaylı kayıtlardan; Türkçe kayıt anlatılmaz', async () => {
    open('/eser/BUR-1001')
    const intro = 'Welcome! I am your guide here. Let me share what the sources tell us about Bursa Grand Mosque.'
    expect(await screen.findByText(intro, { selector: '.vk-narr__line' })).toBeInTheDocument()
    const transcript = document.querySelector('.vk-narr__transcript')!
    expect(transcript).toHaveTextContent('The building is covered by twenty domes.')
    expect(transcript).not.toHaveTextContent('Halk arasında anlatılır.')
    expect(screen.queryByText(/narration is in Turkish/)).not.toBeInTheDocument()
  })
})

describe('anlatıcı (İngilizce)', () => {
  it('eserde onaylı İngilizce kayıt yoksa Türkçe anlatım çalar ve bu açıkça söylenir', async () => {
    stubFetch({ '/guide/status': { body: { enabled: false } } })
    const mon = { ...DETAIL, facts: [DETAIL.facts[1]] }
    render(<Narrator monument={mon} />)
    expect(screen.getByText(/English narration for this monument has not been approved yet/)).toBeInTheDocument()
    const line = document.querySelector('.vk-narr__line')!
    expect(line.textContent).toMatch(/^Hoş geldin!/)
    expect(line).toHaveAttribute('lang', 'tr')
  })

  it('rehbere İngilizce sorulduğunda istek dili İngilizce olarak gönderilir', async () => {
    const fetchMock = stubFetch({
      '/guide/status': { body: { enabled: true, configured: true } },
      '/guide/ask': {
        body: {
          question: 'Who built it?', mode: 'fallback_search', status: 'answered', message: 'From approved English records:',
          sentences: [], facts: [], identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [],
          photo: null, search: null, fallback_reason: null, notice: '', usage: { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_ms: 1 },
        },
      },
    })
    render(<Narrator monument={DETAIL} />)
    await userEvent.type(await screen.findByRole('textbox'), 'Who built it?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText('From approved English records:')).toBeInTheDocument()
    const ask = fetchMock.mock.calls.find(([u]) => String(u).includes('/guide/ask'))!
    expect(JSON.parse(String(ask[1]!.body))).toMatchObject({ question: 'Who built it?', monument_id: 'BUR-1001', lang: 'en' })
  })
})

describe('sorular (İngilizce)', () => {
  it('İngilizce istenir; yeterli İngilizce kayıt yoksa sunucu Türkçe verir ve bu söylenir', async () => {
    let body: Record<string, unknown> = {}
    open('/eser/BUR-1001/rozet', {
      '/monuments/BUR-1001/quiz': (init?: RequestInit) => {
        body = JSON.parse(String(init!.body))
        return {
          status: 201,
          body: { quiz_id: 'q-1', expires_at: '2026-10-27T12:00:00Z', lang: 'tr',
            questions: [{ qid: 'q1', kind: 'choice', prompt: 'Kaç kubbe?', choices: ['12', '20'] }] },
        }
      },
    })
    const prompt = await screen.findByRole('heading', { level: 1, name: 'Kaç kubbe?' })
    expect(prompt).toHaveAttribute('lang', 'tr')
    expect(body).toMatchObject({ lang: 'en' })
    expect(screen.getByText(/not enough approved English records for this monument yet/)).toBeInTheDocument()
  })
})
