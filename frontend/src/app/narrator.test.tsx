import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { Narrator } from './components/Narrator'
import { buildScript } from './narration'
import { pickTurkishVoice } from './speech'

const fact = (id: string, category: string, certainty: string, text: string) => ({
  fact_id: id, title: `Başlık ${id}`, text, category, certainty,
  source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 20, page_kind: 'physical' as const }, game_use: true,
})
const MON = {
  monument_id: 'BUR-1001',
  name: 'Bursa Ulu Camii',
  facts: [
    fact('F3', 'restoration', 'documented', 'Yapı 1855 depreminden sonra onarıldı.'),
    fact('F1', 'construction', 'documented', 'Yapıyı Yıldırım Bayezid yaptırdı.'),
    fact('F2', 'architecture', 'reported', 'Halk arasında yirmi kubbenin bir adağa dayandığı anlatılır.'),
  ],
}

describe('anlatım metni', () => {
  it('karşılama ve kapanış dışında her cümle onaylı kayda bağlıdır ve kayıttan aynen alınır', () => {
    const lines = buildScript(MON)
    expect(lines[0].kind).toBe('intro')
    expect(lines.at(-1)!.kind).toBe('outro')
    const facts = lines.filter((l) => l.kind === 'fact')
    expect(facts.map((l) => l.factId)).toEqual(['F1', 'F2', 'F3']) // yapım → mimari → onarım
    for (const l of facts) {
      expect(MON.facts.find((f) => f.fact_id === l.factId)!.text).toBe(l.text)
      expect(l.source).toBe('Bursa Vakıf Eserleri, Cilt I, s. 20')
    }
    expect(lines.filter((l) => l.kind !== 'fact').every((l) => !l.factId)).toBe(true)
  })

  it('rivayet ve kesin olmayan bilgi sesli anlatımda da belirtilir; altyazı metni değişmez', () => {
    const l = buildScript(MON).find((x) => x.factId === 'F2')!
    expect(l.spoken.startsWith('Aktarılan bir rivayete göre: ')).toBe(true)
    expect(l.text).toBe(MON.facts[2].text)
  })

  it('en fazla belirtilen sayıda bilgi seçer, belgelenmişleri önceler', () => {
    const facts = buildScript(MON, 2).filter((l) => l.kind === 'fact')
    expect(facts.map((l) => l.factId).sort()).toEqual(['F1', 'F3'])
  })

  it('Türkçe ses seçimi', () => {
    const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice
    expect(pickTurkishVoice([v('Samantha', 'en-US'), v('Yelda', 'tr-TR')])!.name).toBe('Yelda')
    expect(pickTurkishVoice([v('Samantha', 'en-US')])).toBeNull()
  })
})

describe('anlatıcı bileşeni', () => {
  beforeEach(() => {
    stubFetch({ '/guide/status': { body: { enabled: false } } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ses otomatik başlamaz; "Dinle" ile altyazı satır satır ilerler ve bitince dinlendi sayılır', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onListened = vi.fn()
    render(<Narrator monument={MON} onListened={onListened} />)
    const intro = buildScript(MON)[0].text
    const subtitle = () => document.querySelector('.vk-narr__line')!.textContent
    expect(subtitle()).toBe(intro)
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    expect(screen.getByRole('button', { name: 'Duraklat' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(6100) // 17 sözcüklük karşılama okuma modunda ~6 sn ekranda kalır
    })
    expect(screen.getByText('2 / 5')).toBeInTheDocument()
    expect(subtitle()).toBe('Yapıyı Yıldırım Bayezid yaptırdı.')
    expect(screen.getByText(/Kaynak: Bursa Vakıf Eserleri, Cilt I, s\. 20/)).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Anlatımı dinledin.')
    expect(onListened).toHaveBeenCalledTimes(1)
  })

  it('Türkçe ses varsa cümleleri sırayla seslendirir; sessiz modda seslendirmez', async () => {
    const spoken: string[] = []
    class Utter {
      text: string
      voice: unknown
      lang = ''
      rate = 1
      onend: (() => void) | null = null
      onerror: ((e: { error: string }) => void) | null = null
      constructor(t: string) {
        this.text = t
      }
    }
    const synthMock = {
      getVoices: () => [{ name: 'Yelda', lang: 'tr-TR' }],
      speak: (u: Utter) => {
        spoken.push(u.text)
        setTimeout(() => u.onend?.(), 0)
      },
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    vi.stubGlobal('speechSynthesis', synthMock)
    vi.stubGlobal('SpeechSynthesisUtterance', Utter)
    Object.defineProperty(window, 'speechSynthesis', { value: synthMock, configurable: true })
    render(<Narrator monument={MON} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    await screen.findByText('Anlatımı dinledin. ✓')
    expect(spoken).toHaveLength(5)
    expect(spoken[2]).toBe('Aktarılan bir rivayete göre: Halk arasında yirmi kubbenin bir adağa dayandığı anlatılır.')
    // @ts-expect-error test temizliği
    delete window.speechSynthesis
  })

  it('büyük altyazı seçeneği altyazıyı büyütür', async () => {
    render(<Narrator monument={MON} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Büyük altyazı' }))
    expect(document.querySelector('.vk-narr__sub')!.className).toContain('vk-narr__sub--large')
  })

  it('anlatımın tam metni (transkript) her zaman erişilebilir', () => {
    render(<Narrator monument={MON} />)
    const t = screen.getByText('Anlatımın tam metni').closest('details')!
    expect(within(t).getAllByRole('listitem')).toHaveLength(5)
  })

  it('rehber kapalıysa soru kutusu yerine dürüst bilgi verir', async () => {
    render(<Narrator monument={MON} />)
    expect(await screen.findByText(/Rehber şu anda soru alamıyor/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('rehbere soru sorulur; cevap dayandığı kayıtlarla gösterilir', async () => {
    const onAsked = vi.fn()
    const fetchMock = stubFetch({
      '/guide/status': { body: { enabled: true, configured: true } },
      '/guide/ask': {
        body: {
          question: 'Kim yaptırdı?', mode: 'generative', status: 'answered', message: 'Onaylı kayıtlara dayanan cevap:',
          sentences: [{ text: 'Yapıyı Yıldırım Bayezid yaptırmıştır.', sources: ['F1'] }],
          facts: [{ fact_id: 'F1', monument_id: 'BUR-1001', monument_name: 'Bursa Ulu Camii', title: 'Yıldırım Bayezid\'in camisi', text: '...', category: 'construction', certainty: 'documented', certainty_label: 'Belgeli', sources: [{ title: 'Kaynak', publisher: 'Yayıncı', url: 'https://example.org' }], publication_decision_id: 'DEC-1' }],
          identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [], photo: null, search: null,
          fallback_reason: null, notice: '', usage: { calls: 1, prompt_tokens: 1, completion_tokens: 1, total_ms: 1 },
        },
      },
    })
    render(<Narrator monument={MON} onAsked={onAsked} />)
    const box = await screen.findByRole('textbox', { name: 'Rehbere sorun' })
    await userEvent.type(box, 'Kim yaptırdı?')
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByText('Yapıyı Yıldırım Bayezid yaptırmıştır.')).toBeInTheDocument()
    expect(screen.getByText(/Dayandığı kayıtlar: Yıldırım Bayezid'in camisi/)).toBeInTheDocument()
    expect(onAsked).toHaveBeenCalledTimes(1)
    const ask = fetchMock.mock.calls.find(([u]) => String(u).includes('/guide/ask'))!
    expect(JSON.parse(String(ask[1]!.body))).toMatchObject({ question: 'Kim yaptırdı?', monument_id: 'BUR-1001' })
  })
})
