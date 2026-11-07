import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { MemoryRouter } from 'react-router-dom'
import { Narrator } from './components/Narrator'
import { resetLangForTests, setLang } from './i18n'
import { smallTalk } from './smallTalk'

// R3.2 Rehberle Konuş: "Sohbet et" / "Kaynaklara sor". Kurgusal kayıtlar (gerçek katalog değildir).
const MON = {
  monument_id: 'BUR-9001', name: 'Deneme Camii',
  facts: [{ fact_id: 'F1', title: 'Başlık F1', text: 'Yapıyı Deneme Bey yaptırdı.', category: 'construction', certainty: 'documented',
    source: { title: 'Bursa Vakıf Eserleri, Cilt I', pdf_physical_page: 20, page_kind: 'physical' as const }, game_use: true }],
}
const ANSWER = {
  question: 'Kim yaptırdı?', mode: 'generative', status: 'answered', message: 'Onaylı kayıtlara dayanan cevap:',
  sentences: [{ text: 'Yapıyı Deneme Bey yaptırmıştır.', sources: ['F1'] }],
  facts: [{ fact_id: 'F1', monument_id: 'BUR-9001', monument_name: 'Deneme Camii', title: 'Başlık F1', text: '...', category: 'construction',
    certainty: 'documented', certainty_label: 'Kaynaklarda belgelenmiş', sources: [{ title: 'K', publisher: 'Yayıncı', url: 'https://example.org' }],
    publication_decision_id: 'DEC-1' }],
  identities: [], missing: '', removed_claims: 0, monument: null, monuments: [], options: [], photo: null, search: null,
  fallback_reason: null, notice: '', usage: { calls: 1, prompt_tokens: 1, completion_tokens: 1, total_ms: 1 },
}
const asks = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter(([u]) => String(u).includes('/guide/ask'))

async function openTalk(status: Record<string, unknown> = { enabled: true, configured: true }) {
  const fetchMock = stubFetch({ '/guide/status': { body: status }, '/guide/ask': { body: ANSWER } })
  const onAsked = vi.fn()
  render(<Narrator monument={MON} onAsked={onAsked} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Rehberle Konuş' }))
  const box = await screen.findByRole('textbox', { name: 'Sorunu yaz' })
  await waitFor(() => expect(box).toBeEnabled())
  return { fetchMock, onAsked, box }
}
async function say(box: HTMLElement, text: string) {
  await userEvent.type(box, text)
  await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetLangForTests()
})

describe('smallTalk', () => {
  it.each([
    ['Selam', 'greeting'], ['merhaba!', 'greeting'], ['Selamün aleyküm', 'greeting'], ['İyi günler', 'greeting'], ['Hello', 'greeting'],
    ['Nasılsın?', 'how'], ['Merhaba, nasılsın?', 'how'], ['sen kimsin', 'who'], ['Selam, ne yapabilirsin?', 'who'],
    ['Teşekkürler', 'thanks'], ['çok sağol', 'thanks'], ['Görüşürüz', 'bye'], ['thank you', 'thanks'],
  ])('gündelik: %s → %s', (text, kind) => {
    expect(smallTalk(text)).toBe(kind)
  })

  it.each([
    "Merhaba, Ulu Cami'yi kim yaptırdı?", 'Selam Bayezid', 'teşekkürler kim yaptırdı', 'Bu cami ne zaman yapıldı?', '', 'selam '.repeat(20),
  ])('gündelik değil (kaynaklı hatta gider): %s', (text) => {
    expect(smallTalk(text)).toBeNull()
  })
})

describe('Rehberle Konuş', () => {
  it('başlık, canlandırma kuralları ve iki mod görünür; varsayılan "Sohbet et"; fotoğraf analizi kapalıyken fotoğraf seçeneği yok', async () => {
    await openTalk({ enabled: true, configured: true })
    expect(screen.getByRole('tab', { name: 'Rehberle Konuş' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Rehberle Konuş' })).toBeVisible()
    // "Canlı Vasiyet" adı bu sohbet alanında kullanılmaz (docs/CANLI_VASIYET.md'deki onaylı anlatıma aittir).
    expect(document.body).not.toHaveTextContent(/Canlı Vasiyet/)
    expect(screen.getByText('Yerel rehberle sohbet · canlandırma')).toBeVisible()
    expect(screen.getByText(/tarihî kişiler adına konuşmaz/)).toBeVisible()
    const modes = screen.getByRole('group', { name: 'Konuşma modu' })
    expect(within(modes).getByRole('radio', { name: 'Sohbet et' })).toBeChecked()
    expect(within(modes).getByRole('radio', { name: 'Kaynaklara sor' })).not.toBeChecked()
    expect(within(modes).getByRole('radio', { name: 'Sohbet et' })).toHaveAccessibleDescription(/tarihî sorular yine kaynaklı/)
    expect(screen.queryByText('Fotoğraf ekle')).not.toBeInTheDocument()  // sunucu photo: true demedi (R5.3)
    expect(screen.queryByText(/Fotoğraf analizi şu anda kapalı/)).not.toBeInTheDocument()  // kapalıyken gürültü yok
  })

  it('Sohbet et: "Selam" API\'ye gitmeden, tarihî iddia içermeyen yerel karşılık alır; oyun sayacı ilerlemez', async () => {
    const { fetchMock, onAsked, box } = await openTalk()
    await say(box, 'Selam')
    const log = screen.getByRole('list', { name: 'Konuşma' })
    expect(within(log).getByText('Rehber · canlandırma')).toBeInTheDocument()
    expect(within(log).getByText(/Merhaba! Ben bu eserin yerel rehberiyim; bir canlandırmayım\. Deneme Camii hakkında/)).toBeInTheDocument()
    expect(asks(fetchMock)).toHaveLength(0)
    expect(onAsked).not.toHaveBeenCalled()
    expect(box).toHaveValue('')
  })

  it('Kaynaklara sor: gündelik mesaja da yerel karşılık verilir (API yok, kaynak taranmaz); mod değişince geçmiş korunur', async () => {
    const { fetchMock, box } = await openTalk()
    await say(box, 'Teşekkürler')
    await userEvent.click(screen.getByRole('radio', { name: 'Kaynaklara sor' }))
    await say(box, 'Merhaba')
    const log = screen.getByRole('list', { name: 'Konuşma' })
    expect(within(log).getAllByRole('listitem')).toHaveLength(2)
    expect(within(log).getByText('Rica ederim! Başka bir sorun olursa buradayım.')).toBeInTheDocument()
    expect(within(log).getByText(/Merhaba! Ben bu eserin yerel rehberiyim/)).toBeInTheDocument()
    expect(screen.queryByText('Kaynaklar taranıyor…')).not.toBeInTheDocument()
    expect(asks(fetchMock)).toHaveLength(0)
  })

  it('tarihî soru iki modda da kaynaklı hattan geçer; "Kaynaklı cevap" etiketi; yerel turlar geçmiş olarak gönderilmez', async () => {
    const { fetchMock, onAsked, box } = await openTalk()
    await say(box, 'Selam')
    await say(box, 'Kim yaptırdı?')
    const log = screen.getByRole('list', { name: 'Konuşma' })
    expect(await within(log).findByText('Yapıyı Deneme Bey yaptırmıştır.')).toBeInTheDocument()
    expect(within(log).getByText('Kaynaklı cevap')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Kaynaklar' })).getByText('Başlık F1')).toBeInTheDocument()
    const [call] = asks(fetchMock)
    expect(JSON.parse(String(call[1]!.body))).toEqual({ question: 'Kim yaptırdı?', history: [], monument_id: 'BUR-9001' })
    expect(onAsked).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('radio', { name: 'Kaynaklara sor' }))
    await say(box, 'Ne zaman yapıldı?')
    await waitFor(() => expect(asks(fetchMock)).toHaveLength(2))
    expect(JSON.parse(String(asks(fetchMock)[1][1]!.body)).history).toHaveLength(1)  // yalnızca kaynaklı tur
  })
})

describe('Rehberle Konuş (İngilizce)', () => {
  it('sekme, başlık, mod grubu ve radyo adları İngilizcedir; eski ad kullanılmaz', async () => {
    setLang('en')
    stubFetch({ '/guide/status': { body: { enabled: true, configured: true } } })
    render(<Narrator monument={MON} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Talk to the Guide' }))
    expect(screen.getByRole('heading', { name: 'Talk to the Guide' })).toBeVisible()
    const modes = screen.getByRole('group', { name: 'Conversation mode' })
    expect(within(modes).getByRole('radio', { name: 'Chat' })).toBeChecked()
    expect(within(modes).getByRole('radio', { name: 'Chat' })).toHaveAccessibleDescription(/historical questions are still answered from sources/)
    expect(within(modes).getByRole('radio', { name: 'Ask the sources' })).not.toBeChecked()
    expect(await screen.findByRole('textbox', { name: 'Type your question' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Living Testament|Canlı Vasiyet/)
  })
})

describe('Rehberle Konuş: fotoğraf (R5.3)', () => {
  const NM_MESSAGE = 'Fotoğraftaki yapı kayıtlı eserlerden biriyle güvenilir şekilde eşleşmedi; bu yüzden yapının adı, yaptıranı, tarihi veya konumu hakkında bilgi veremiyorum.'
  const photoFile = () => new File([new Uint8Array([255, 216, 255, 224])], 'yapi.jpg', { type: 'image/jpeg' })
  const NOT_MATCHED = {
    ...ANSWER, status: 'photo_not_matched', mode: 'generative', message: NM_MESSAGE,
    sentences: [], facts: [], options: [{ monument_id: 'BUR-9002', name: 'Deneme Han' }], manual_options: [{ monument_id: 'BUR-9001', name: 'Deneme Camii' }],
  }

  it('sunucu fotoğrafa hazırsa (photo: true) yükleme, önizleme, kaldırma ve onay çalışır; onaysız gönderilmez', async () => {
    const { fetchMock, box } = await openTalk({ enabled: true, configured: true, photo: true })
    const input = (await screen.findByLabelText(/Fotoğraf ekle/)) as HTMLInputElement
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    await userEvent.upload(input, photoFile())
    expect(await screen.findByRole('img', { name: 'Seçilen fotoğraf' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fotoğrafı kaldır' }))
    expect(screen.queryByRole('img', { name: 'Seçilen fotoğraf' })).not.toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText(/Fotoğraf ekle/), photoFile())
    await screen.findByRole('img', { name: 'Seçilen fotoğraf' })
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByText('Fotoğrafı göndermek için onay kutusunu işaretle.')).toBeInTheDocument()
    expect(asks(fetchMock)).toHaveLength(0)
    await userEvent.click(screen.getByRole('checkbox', { name: /göndermeyi onaylıyorum/ }))
    await userEvent.type(box, 'Selam')  // fotoğraflı mesaj gündelik sohbet sayılmaz: kaynaklı hatta gider
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    await waitFor(() => expect(asks(fetchMock)).toHaveLength(1))
    const body = JSON.parse(String(asks(fetchMock)[0][1]!.body))
    expect(body).toMatchObject({ question: 'Selam', monument_id: 'BUR-9001', image: { consent: true, mime: 'image/jpeg' } })
  })

  async function sendPhoto(body: unknown, question = '') {
    const fetchMock = stubFetch({ '/guide/status': { body: { enabled: true, configured: true, photo: true } }, '/guide/ask': { body } })
    render(<MemoryRouter><Narrator monument={MON} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('tab', { name: 'Rehberle Konuş' }))
    await userEvent.upload(await screen.findByLabelText(/Fotoğraf ekle/), photoFile())
    await screen.findByRole('img', { name: 'Seçilen fotoğraf' })
    await userEvent.click(screen.getByRole('checkbox', { name: /göndermeyi onaylıyorum/ }))
    if (question) await userEvent.type(screen.getByRole('textbox', { name: 'Sorunu yaz' }), question)
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    return { fetchMock, log: screen.getByRole('list', { name: 'Konuşma' }) }
  }
  const PHOTO = {
    is_architecture: true, building_type: 'diğer', features: ['kırmızı çatılar', 'karlı dağ'], visible_text: '', architecture_explanation: '',
    description: 'Fotoğrafta kırmızı çatılı, sık dizilmiş evlerden oluşan bir kent görülüyor. Arka planda karla kaplı bir dağ var.',
    candidates: [], metadata_removed: ['EXIF/XMP'], observed: true,
  }

  it('fotoğraf eserle eşleşmezse dürüst mesaj; sorulan eser bağlantısı; katalog listesi aday gibi değil "kendin seç" altında', async () => {
    const { fetchMock, log } = await sendPhoto(NOT_MATCHED)
    expect(await within(log).findByText(NM_MESSAGE)).toBeInTheDocument()
    expect(within(log).getByText(/Sorduğun eser fotoğrafla güvenle eşleşmedi/)).toBeInTheDocument()
    expect(within(log).getByRole('link', { name: 'Deneme Han' })).toHaveAttribute('href', '/eser/BUR-9002')
    const manual = within(log).getByText('Eseri kendin seçmek istersen').closest('details')!
    expect(within(manual).getByRole('link', { name: 'Deneme Camii' })).toHaveAttribute('href', '/eser/BUR-9001')
    expect(within(log).queryByText(/şunlardan biri olabilir/)).not.toBeInTheDocument()
    expect(within(log).queryByRole('region', { name: 'Fotoğrafta görülenler' })).not.toBeInTheDocument()  // gözlem yok
    expect(within(log).queryByText('Kaynaklı cevap')).not.toBeInTheDocument()
    expect(within(log).getByText(/Başka bir fotoğraf deneyebilir/)).toBeInTheDocument()
    expect(asks(fetchMock)).toHaveLength(1)
  })

  it('fotoğraf analizi kapalıyken metin soruları her iki modda normal çalışır', async () => {
    const { fetchMock, box } = await openTalk({ enabled: true, configured: true, photo: false })
    expect(screen.queryByLabelText(/Fotoğraf ekle/)).not.toBeInTheDocument()
    await say(box, 'Kim yaptırdı?')
    expect(await screen.findByText('Yapıyı Deneme Bey yaptırmıştır.')).toBeInTheDocument()
    expect(JSON.parse(String(asks(fetchMock)[0][1]!.body)).image ?? null).toBeNull()
  })

  it('eşleşmeyen kent fotoğrafı + "Burada ne görüyorsun?": önce betimleme (kaynak değildir), eşleşmeme ardından ikincil', async () => {
    const { log } = await sendPhoto({ ...NOT_MATCHED, options: [], photo: PHOTO }, 'Burada ne görüyorsun?')
    const seen = await within(log).findByRole('region', { name: 'Fotoğrafta görülenler' })
    expect(within(seen).getByText(/kırmızı çatılı, sık dizilmiş evlerden/)).toBeInTheDocument()
    expect(within(seen).getByText('Yapay zekânın fotoğraftan görsel yorumu; onaylı tarihî kaynak değildir.')).toBeInTheDocument()
    expect(within(within(seen).getByRole('list', { name: 'Görülen öğeler' })).getAllByRole('listitem')).toHaveLength(2)
    const note = within(log).getByText(NM_MESSAGE).closest('div')!
    expect(note).toHaveClass('vk-chat__a--secondary')
    expect(seen.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()  // betimleme önce
    expect(within(log).queryByText('Kaynaklı cevap')).not.toBeInTheDocument()
    expect(within(seen).queryByRole('list', { name: 'Kaynaklar' })).not.toBeInTheDocument()
  })

  it('eşleşen eser + "Kim yaptırdı?": betimleme ve "Kaynaklı cevap" ayrı bölümlerde; kaynaklar yalnızca kaynaklı kısımda', async () => {
    const matched = { ...ANSWER, photo: { ...PHOTO, candidates: [{ monument_id: 'BUR-9001', name: 'Deneme Camii', likelihood: 'high' }] } }
    const { log } = await sendPhoto(matched, 'Kim yaptırdı?')
    const seen = await within(log).findByRole('region', { name: 'Fotoğrafta görülenler' })
    expect(within(seen).queryByText('Yapıyı Deneme Bey yaptırmıştır.')).not.toBeInTheDocument()
    const sourced = within(log).getByText('Yapıyı Deneme Bey yaptırmıştır.').closest('div')!
    expect(within(sourced).getByText('Kaynaklı cevap')).toBeInTheDocument()
    expect(within(sourced).getByRole('list', { name: 'Kaynaklar' })).toBeInTheDocument()
  })

  it('görsel analiz başarısızsa sahte betimleme gösterilmez', async () => {
    const failed = { ...ANSWER, status: 'photo_analysis_failed', sentences: [], facts: [], photo: null,
      message: 'Fotoğraf analiz edilemedi. Yapay zekâ sağlayıcısına şu anda ulaşılamıyor.' }
    const { log } = await sendPhoto(failed, 'Burada ne görüyorsun?')
    expect(await within(log).findByText(/Fotoğraf analiz edilemedi/)).toBeInTheDocument()
    expect(within(log).queryByRole('region', { name: 'Fotoğrafta görülenler' })).not.toBeInTheDocument()
  })

  it('gözlem tamamen elendiyse (observed: false) betimleme bölümü yok; eşleşmeme mesajı ana mesajdır', async () => {
    const empty = { ...NOT_MATCHED, options: [], photo: { ...PHOTO, description: '', features: [], observed: false } }
    const { log } = await sendPhoto(empty, 'Burada ne görüyorsun?')
    const msg = await within(log).findByText(NM_MESSAGE)
    expect(within(log).queryByRole('region', { name: 'Fotoğrafta görülenler' })).not.toBeInTheDocument()
    expect(msg.closest('div')).not.toHaveClass('vk-chat__a--secondary')
  })
})
