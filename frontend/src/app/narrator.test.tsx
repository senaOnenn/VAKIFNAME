import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { Narrator } from './components/Narrator'
import { buildScript } from './narration'
import { pickTurkishVoice, resetSpeechStatusForTests } from './speech'

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

  it('rehber çerçevesiz Osmanlı portresi olarak görünür (video paneli yok); konuşurken "konuşuyor" durumuna geçer', async () => {
    render(<Narrator monument={MON} />)
    const char = document.querySelector('.vk-gchar--portrait')!
    expect(char).toBeInTheDocument()
    expect(char.getAttribute('aria-hidden')).toBe('true')  // süs; ad ve rol metin olarak verilir
    const img = char.querySelector('img')!
    expect(img).toHaveAttribute('alt', '')
    expect(img.getAttribute('srcset')).toMatch(/320w.*480w.*640w/)
    expect(document.querySelector('svg.vk-gchar')).toBeNull()
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Rehber' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    expect(document.querySelector('.vk-gchar--portrait')!.getAttribute('class')).toContain('is-speaking')
  })

  it('portre durağandır: ağız varyantı yokken sahte ağız katmanı çizilmez; eski SVG karakter geri dönüş için durur', async () => {
    const { GuidePortrait, MOUTH_FRAMES, PORTRAIT_LIP_SYNC } = await import('./components/GuidePortrait')
    const { FIGURE_LIP_SYNC } = await import('./components/GuideFigure')
    expect(Object.keys(MOUTH_FRAMES)).toHaveLength(0)
    expect(PORTRAIT_LIP_SYNC).toBe(false)
    expect(FIGURE_LIP_SYNC).toBe(false)  // anlatıcı ağız senkronunu hesaplamaz
    const { container, rerender } = render(<GuidePortrait mouth="X" />)
    const src = container.querySelector('img')!.getAttribute('src')
    rerender(<GuidePortrait mouth="D" speaking />)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('.vk-gchar__mouth')).toBeNull()
    expect(container.querySelector('img')!.getAttribute('src')).toBe(src)
    expect(container.firstElementChild).toHaveAttribute('data-lip-sync', 'off')
    const { GuideCharacter } = await import('./components/GuideCharacter')
    const legacy = render(<GuideCharacter mouth="D" />)
    expect(legacy.container.querySelector('svg.vk-gchar')).toBeInTheDocument()
  })

  it('sunucu sesi bu cümlede yoksa ve tarayıcı sesi de yoksa: "Bu cümlenin sesi şu anda yok" ekran okuyucuya duyurulur; altyazı ve tam metin sürer', async () => {
    resetSpeechStatusForTests()
    stubFetch({
      '/guide/status': { body: { enabled: false } },
      '/speech/status': { body: { enabled: true, provider: 'files', voice: 'izinli-ses-1' } },
      '/monuments/BUR-1001/speech': { status: 404, body: { detail: 'Bu cümlenin sesi henüz hazır değil.' } },
    })
    vi.stubGlobal('Audio', class {})
    render(<Narrator monument={MON} />)
    const live = screen.getByRole('status')
    expect(live).toBeEmptyDOMElement()  // canlı bölge baştan bağlı ve boş
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    expect(await within(live).findByText('Bu cümlenin sesi şu anda yok; altyazıyla ilerliyor.')).toBeInTheDocument()
    expect(screen.queryByText(/Tarayıcında Türkçe ses bulunamadı/)).not.toBeInTheDocument()  // sunucu sesi açık: genel not yok
    expect(document.querySelector('.vk-narr__line')!.textContent).toMatch(/^Hoş geldin!/)  // altyazı sürer
    expect(screen.getByRole('button', { name: 'Duraklat' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Hız' })).toBeEnabled()
    expect(screen.getByText('Anlatımın tam metni')).toBeInTheDocument()
    // Sessiz moda geçilince bilgi kalkar (ses zaten istenmiyor).
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sessiz (yalnızca altyazı)' }))
    expect(live).toBeEmptyDOMElement()
    resetSpeechStatusForTests()
  })

  it('sunucu sesi çalınabiliyorsa "sesi yok" bilgisi görünmez', async () => {
    resetSpeechStatusForTests()
    stubFetch({
      '/guide/status': { body: { enabled: false } },
      '/speech/status': { body: { enabled: true, provider: 'files', voice: 'izinli-ses-1' } },
      '/monuments/BUR-1001/speech': { body: { url: `/speech/audio/${'a'.repeat(64)}.mp3` } },
    })
    const played: string[] = []
    vi.stubGlobal('Audio', class {
      playbackRate = 1; currentTime = 0; duration = 1; paused = true
      onended: (() => void) | null = null; onerror: (() => void) | null = null
      src: string
      constructor(src: string) { this.src = src }
      play() { played.push(this.src); this.paused = false; return Promise.resolve() }
      pause() { this.paused = true }
    })
    render(<Narrator monument={MON} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    await vi.waitFor(() => expect(played).toHaveLength(1))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    resetSpeechStatusForTests()
  })

  it('sunucu seslendirmesi açıksa her cümlenin ses dosyası çalınır; seslendirilen metin anlatımın kendisidir', async () => {
    resetSpeechStatusForTests()
    const spoken: string[] = []
    const played: string[] = []
    stubFetch({
      '/guide/status': { body: { enabled: false } },
      '/speech/status': { body: { enabled: true, provider: 'google', voice: 'tr-TR-Chirp3-HD-Leda' } },
      '/monuments/BUR-1001/speech': (init?: RequestInit) => {
        const text = JSON.parse(String(init?.body)).text as string
        spoken.push(text)
        return { body: { url: `/speech/audio/${String(spoken.length).padStart(64, '0')}.mp3` } }
      },
    })
    class FakeAudio {
      src: string
      playbackRate = 1
      currentTime = 0
      duration = 1
      paused = true
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(src: string) {
        this.src = src
      }
      play() {
        played.push(this.src)
        this.paused = false
        setTimeout(() => this.onended?.(), 5)
        return Promise.resolve()
      }
      pause() {
        this.paused = true
      }
    }
    vi.stubGlobal('Audio', FakeAudio)
    const onListened = vi.fn()
    render(<Narrator monument={MON} onListened={onListened} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dinle' }))
    await vi.waitFor(() => expect(onListened).toHaveBeenCalled(), { timeout: 3000 })
    const lines = buildScript(MON)
    expect(played).toHaveLength(lines.length)
    expect(played[0]).toMatch(/\/speech\/audio\/0+1\.mp3$/)
    expect(new Set(spoken)).toEqual(new Set(lines.map((l) => l.spoken)))
    resetSpeechStatusForTests()
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

  it('rehbere ulaşılamazsa dürüst bilgi ve yeniden deneme; kutu kullanılabilir, selam yerelde cevaplanır', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    render(<Narrator monument={MON} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Rehberle Konuş' }))
    expect(await screen.findByText(/Rehbere şu anda ulaşılamıyor/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Bağlantıyı yeniden dene' })).toBeInTheDocument()
    const box = screen.getByRole('textbox')
    expect(box).toBeEnabled()
    await userEvent.type(box, 'Selam{Enter}')
    expect(await screen.findByText(/Merhaba! Ben bu eserin yerel rehberiyim/)).toBeInTheDocument()
    expect(screen.queryByText('Kaynaklar taranıyor…')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/guide/ask'))).toBe(false)
  })

  it('anlatım ve soru sorma iki sekmededir: varsayılan anlatım; ok tuşlarıyla geçilir; canlandırma etiketi korunur', async () => {
    render(<Narrator monument={MON} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Eserin hikâyesi' })).toBeInTheDocument()
    const listen = screen.getByRole('tab', { name: 'Anlatım' })
    const ask = screen.getByRole('tab', { name: 'Rehberle Konuş' })
    expect(listen).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Anlatım' })).toBeVisible()
    expect(screen.getByText('Yerel rehber · canlandırma')).toBeVisible()  // anlatım bir canlandırmadır (CLAUDE.md §4)
    expect(screen.getByRole('button', { name: 'Dinle' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Rehberle Konuş' })).not.toBeInTheDocument()  // gizli panel
    listen.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(ask).toHaveAttribute('aria-selected', 'true')
    expect(ask).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Rehberle Konuş' })).toBeVisible()
    expect(screen.getByText(/tarihî kişiler adına konuşmaz/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Dinle' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Home}')
    expect(listen).toHaveAttribute('aria-selected', 'true')
    expect(listen).toHaveFocus()
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
    await userEvent.click(screen.getByRole('tab', { name: 'Rehberle Konuş' }))
    const box = await screen.findByRole('textbox', { name: 'Sorunu yaz' })
    await userEvent.type(box, 'Kim yaptırdı?')
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByText('Yapıyı Yıldırım Bayezid yaptırmıştır.')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Kaynaklar' })).getByText("Yıldırım Bayezid'in camisi")).toBeInTheDocument()
    expect(onAsked).toHaveBeenCalledTimes(1)
    const ask = fetchMock.mock.calls.find(([u]) => String(u).includes('/guide/ask'))!
    expect(JSON.parse(String(ask[1]!.body))).toMatchObject({ question: 'Kim yaptırdı?', monument_id: 'BUR-1001' })
  })
})
