import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch, type Routes } from '../test/fixtures'
import { GUIDE_TIMEOUT_MS } from '../catalog/guideClient'
import { GuideChat } from './components/Narrator'

// Rehber cevabı: POST /guide/ask (Evren + Gemma + onaylı katalog, sunucu tarafı). Arayüz yalnızca sunucunun doğruladığı
// cümleleri ve kayıtları gösterir. Kayıtlar Bursa Ulu Camii'nin onaylı katalog kayıtlarıyla aynı biçimdedir.
const F001 = {
  fact_id: 'BUR-9001-F001', monument_id: 'BUR-9001', monument_name: 'Bursa Ulu Camii', title: "Yıldırım Bayezid'in camisi",
  text: 'Ulu Cami, Sultan Yıldırım Bayezid tarafından yaptırılmıştır.', category: 'construction', certainty: 'documented',
  certainty_label: 'Kaynaklarda belgelenmiş',
  sources: [{ title: 'Bursa Ulu Camii', publisher: 'Vakıflar Genel Müdürlüğü', url: 'https://www.vgm.gov.tr/ornek' },
            { title: 'Düz bağlantı', publisher: 'Güvensiz', url: 'http://guvensiz.invalid/x' }],
  publication_decision_id: 'DEC-378e01a36081296c',
}
const base = {
  question: 'Bursa Ulu Cami\'yi kim yaptırmıştır?', identities: [], missing: '', removed_claims: 0, monument: null,
  monuments: [], options: [], photo: null, search: null, fallback_reason: null, notice: '',
  usage: { calls: 1, prompt_tokens: 1, completion_tokens: 1, total_ms: 1 },
}
const GENERATIVE = {
  ...base, mode: 'generative', status: 'answered', message: 'Onaylı kayıtlara dayanan cevap:',
  sentences: [{ text: "Bursa Ulu Camii'ni Sultan Yıldırım Bayezid yaptırmıştır.", sources: ['BUR-9001-F001'] }], facts: [F001],
}

function setup(ask: Routes[string]) {
  const fetchMock = stubFetch({ '/guide/status': { body: { enabled: true, configured: true } }, '/guide/ask': ask })
  render(<GuideChat monumentId="BUR-9001" />)
  return fetchMock
}

async function askQuestion(user: Pick<ReturnType<typeof userEvent.setup>, 'type' | 'click'> = userEvent) {
  const box = await screen.findByRole('textbox', { name: 'Sorunu yaz' })
  await user.type(box, "Bursa Ulu Cami'yi kim yaptırmıştır?")
  await user.click(screen.getByRole('button', { name: 'Sor' }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Rehber cevabı (Ulu Cami)', () => {
  it('soru seçili eserin kimliğiyle gönderilir; anahtar veya kimlik bilgisi gövdede yoktur', async () => {
    const fetchMock = setup({ body: GENERATIVE })
    await askQuestion()
    await screen.findByText("Bursa Ulu Camii'ni Sultan Yıldırım Bayezid yaptırmıştır.")
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/guide/ask'))!
    expect(new URL(String(url)).pathname).toBe('/guide/ask')
    const body = JSON.parse(String(init!.body))
    expect(body).toEqual({ question: "Bursa Ulu Cami'yi kim yaptırmıştır?", history: [], monument_id: 'BUR-9001' })
    expect(init!.credentials).toBe('include')
    expect(new Headers(init!.headers).get('X-Vakifname-Guide')).toBe('1')
    expect(JSON.stringify(init)).not.toMatch(/api[-_]?key|x-api-key|authorization/i)
  })

  it('doğrulanmış cümle, dayandığı kayıt, kesinlik etiketi ve yalnızca https kaynak bağlantısı gösterilir', async () => {
    setup({ body: GENERATIVE })
    await askQuestion()
    expect(await screen.findByText("Bursa Ulu Camii'ni Sultan Yıldırım Bayezid yaptırmıştır.")).toBeInTheDocument()
    const refs = screen.getByRole('list', { name: 'Kaynaklar' })
    expect(within(refs).getByText("Yıldırım Bayezid'in camisi")).toBeInTheDocument()  // dayandığı kayıt
    expect(within(refs).getByText('Kaynaklarda belgelenmiş')).toBeInTheDocument()
    const link = within(refs).getByRole('link', { name: 'Vakıflar Genel Müdürlüğü' })
    expect(link).toHaveAttribute('href', 'https://www.vgm.gov.tr/ornek')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(within(refs).queryByRole('link', { name: 'Güvensiz' })).not.toBeInTheDocument()
  })

  it('kesin olmayan kayıt "kesin değil" etiketiyle gösterilir', async () => {
    const f2 = { ...F001, fact_id: 'BUR-9001-F002', title: "Ulu Cami'nin mimarı kim?", certainty: 'uncertain', certainty_label: 'Kesin değil' }
    setup({ body: { ...GENERATIVE, sentences: [{ text: 'Mimarın kim olduğu kaynaklarda kesin değildir.', sources: ['BUR-9001-F002'] }], facts: [f2] } })
    await askQuestion()
    const refs = await screen.findByRole('list', { name: 'Kaynaklar' })
    expect(within(refs).getByText('Kesin değil')).toHaveClass('vk-chat__cert--uncertain')
  })

  it('yapay zekâ cevap veremeyince kaynaklı aramanın onaylı kaydı özgün metniyle ve kaynağıyla gösterilir', async () => {
    const message = 'Yapay zekâ cevabı zamanında gelmedi. Bunun yerine onaylı katalogda arama yapıldı. Aşağıdaki bilgi yapay zekâ tarafından üretilmedi; onaylı kaydın özgün metnidir ve kaynaklarıyla gösterilir.'
    setup({ body: { ...base, mode: 'fallback_search', status: 'answered', message, sentences: [], facts: [], fallback_reason: 'timeout',
      search: { status: 'answered', message: '', answer: F001, related: [], options: [], monument: null } } })
    await askQuestion()
    expect(await screen.findByText(/onaylı kaydın özgün metnidir/)).toBeInTheDocument()
    expect(screen.getByText(F001.text)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Kaynaklar' })).getByRole('link', { name: 'Vakıflar Genel Müdürlüğü' })).toBeInTheDocument()
  })

  it('kaynaklı aramanın cevabında kaynak bağlantısı yoksa kayıt metni gösterilmez', async () => {
    const message = 'Yapay zekâ sağlayıcısına şu anda ulaşılamıyor. Bunun yerine onaylı katalogda arama yapıldı.'
    setup({ body: { ...base, mode: 'fallback_search', status: 'answered', message, sentences: [], facts: [], fallback_reason: 'unavailable',
      search: { status: 'answered', message: '', answer: { ...F001, sources: [] }, related: [], options: [], monument: null } } })
    await askQuestion()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(F001.text)).not.toBeInTheDocument()
  })

  it('kaynakta bilgi yoksa dürüst "yetersiz kanıt" mesajı gösterilir, cümle veya kaynak gösterilmez', async () => {
    const message = 'Bu soruyu cevaplayan onaylı bir tarihî kayıt bulamadım. Yanlış bilgi vermemek için tahmin etmiyorum.'
    setup({ body: { ...base, mode: 'generative', status: 'insufficient_evidence', message, sentences: [], facts: [] } })
    await askQuestion()
    expect(await screen.findByText(message)).toHaveClass('vk-chat__a--note')
    expect(screen.queryByRole('list', { name: 'Kaynaklar' })).not.toBeInTheDocument()
  })

  it('kaynağı yanıtta bulunmayan cümle taşıyan yanıt bütünüyle reddedilir', async () => {
    setup({ body: { ...GENERATIVE, sentences: [{ text: 'Mimarı Ali Neccar\'dır.', sources: ['BUR-9001-F099'] }] } })
    await askQuestion()
    expect(await screen.findByText('Sunucudan beklenmeyen bir yanıt geldi.')).toBeInTheDocument()
    expect(screen.queryByText("Mimarı Ali Neccar'dır.")).not.toBeInTheDocument()
  })

  it('beklerken "Kaynaklar taranıyor…" görünür ve gönder düğmesi kilitlenir', async () => {
    let release: (v: { body: unknown }) => void = () => undefined
    setup(() => new Promise((r) => (release = r)))
    await askQuestion()
    expect(await screen.findByText('Kaynaklar taranıyor…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sor' })).toBeDisabled()
    await act(async () => release({ body: GENERATIVE }))
    expect(await screen.findByText("Bursa Ulu Camii'ni Sultan Yıldırım Bayezid yaptırmıştır.")).toBeInTheDocument()
  })

  it('sunucu hatası (ör. önceki soru sürüyor) anlaşılır mesajla gösterilir', async () => {
    setup({ status: 409, body: { detail: 'Önceki sorunuz hâlâ yanıtlanıyor; lütfen o cevabı bekleyin.' } })
    await askQuestion()
    expect(await screen.findByText('Önceki sorunuz hâlâ yanıtlanıyor; lütfen o cevabı bekleyin.')).toBeInTheDocument()
  })

  it('sunucuya ulaşılamazsa ağ hatası gösterilir', async () => {
    setup(new TypeError('Failed to fetch'))
    await askQuestion()
    expect(await screen.findByText('Rehbere ulaşılamadı. Bağlantını kontrol edip tekrar dene.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument()
  })

  it('cevap arayüz bekleme süresini aşarsa zaman aşımı mesajı gösterilir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/guide/status')) {
        return Promise.resolve(new Response(JSON.stringify({ enabled: true }), { headers: { 'Content-Type': 'application/json' } }))
      }
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }))
    render(<GuideChat monumentId="BUR-9001" />)
    await askQuestion(user)
    await screen.findByText('Kaynaklar taranıyor…')
    await act(async () => {
      vi.advanceTimersByTime(GUIDE_TIMEOUT_MS + 1000)
    })
    expect(await screen.findByText('Rehber zamanında cevap veremedi. Biraz sonra tekrar dene.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument()
  })
})
