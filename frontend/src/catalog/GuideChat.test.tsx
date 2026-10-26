import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { AskMonument } from './AskMonument'
import type { AskFact, AskResult, GuideResult } from './types'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const FACT: AskFact = {
  fact_id: 'BUR-9001-F001',
  monument_id: 'BUR-9001',
  monument_name: 'Kurgusal Cami',
  title: 'Kurgusal yapım',
  text: 'Kurgusal Cami, kurgusal bir sultan tarafından 1400 yılında yaptırılmıştır.',
  category: 'construction',
  certainty: 'documented',
  certainty_label: 'Kaynaklarda belgelenmiş bilgi',
  sources: [{ title: 'Kurgusal Cami', publisher: 'Kurgusal Portal', url: 'https://example.org/kurgusal' }],
  publication_decision_id: 'DEC-0000000000000001',
}

const result = (over: Partial<GuideResult> = {}): GuideResult => ({
  question: 'Kim yaptırdı?',
  mode: 'generative',
  status: 'answered',
  message: 'Onaylı kayıtlara dayanan cevap:',
  sentences: [{ text: 'Kurgusal Cami 1400 yılında yaptırılmıştır.', sources: ['BUR-9001-F001'] }],
  facts: [FACT],
  identities: [],
  missing: '',
  removed_claims: 0,
  monument: { monument_id: 'BUR-9001', name: 'Kurgusal Cami' },
  monuments: [{ monument_id: 'BUR-9001', name: 'Kurgusal Cami' }],
  options: [],
  photo: null,
  search: null,
  fallback_reason: null,
  notice: 'Cevabı yapay zekâ yazar.',
  usage: { calls: 1, prompt_tokens: 100, completion_tokens: 20, total_ms: 900 },
  ...over,
})

const enabled = { '/guide/status': { body: { enabled: true, configured: true, photo: true, max_image_mb: 6 } } }

describe('GuideChat (yapay zekâ rehberi)', () => {
  it('rehber kapalıysa eski kaynaklı aramayı gösterir', async () => {
    stubFetch({ '/guide/status': { body: { enabled: false } } })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    expect(await screen.findByText(/yapay zekâ yeni metin üretmez/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fotoğraf ekle' })).toBeNull()
  })

  it('serbest soruya atıflı cevap ve kaynak kartları gösterir; takip sorusunda geçmişi ve eseri gönderir', async () => {
    const bodies: Record<string, unknown>[] = []
    stubFetch({
      ...enabled,
      '/monuments/BUR-9001/ask/suggestions': { body: { monument_id: 'BUR-9001', suggestions: ['Kim yaptırdı?'] } },
      '/guide/ask': async (init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return { body: result() }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    expect(await screen.findByRole('button', { name: 'Fotoğraf ekle' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Örnek sorular \(isteğe bağlı\)/ })).toBeInTheDocument()
    const input = screen.getByLabelText(/hakkında sorunuz/)
    await userEvent.type(input, 'Bu caminin hikâyesi ne?{Enter}')
    const answer = await screen.findByLabelText('Yapay zekâ cevabı')
    expect(within(answer).getByText(/1400 yılında yaptırılmıştır/)).toBeInTheDocument()
    const cite = within(answer).getByRole('link', { name: 'Kaynak 1: BUR-9001-F001' })
    expect(cite.getAttribute('href')).toMatch(/#rehber-1-BUR-9001-F001$/)
    const card = screen.getByRole('article', { name: 'Onaylı kayıt: Kurgusal yapım' })
    expect(within(card).getByRole('link', { name: /Kurgusal Portal/ })).toHaveAttribute('href', 'https://example.org/kurgusal')
    expect(bodies[0]).toEqual({ question: 'Bu caminin hikâyesi ne?', history: [], monument_id: 'BUR-9001' })

    await userEvent.type(input, 'Peki ne zaman?{Enter}')
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual({
      question: 'Peki ne zaman?',
      monument_id: 'BUR-9001',
      history: [{ question: 'Bu caminin hikâyesi ne?', answer: 'Kurgusal Cami 1400 yılında yaptırılmıştır.' }],
    })
  })

  it('kaynağı yanıtta olmayan cümle taşıyan cevabı reddeder', async () => {
    stubFetch({
      ...enabled,
      '/guide/ask': { body: result({ sentences: [{ text: 'Uydurma bilgi.', sources: ['BUR-9001-F999'] }] }) },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Kim yaptırdı?{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/beklenmeyen/)
    expect(screen.queryByText('Uydurma bilgi.')).toBeNull()
  })

  it('yapay zekâ çalışmadığında yedek arama cevabını uyarıyla gösterir', async () => {
    stubFetch({
      ...enabled,
      '/guide/ask': {
        body: result({
          mode: 'fallback_search', message: 'Yapay zekâ sağlayıcısına ulaşılamadı. Bunun yerine onaylı kayıtlarda arama yapıldı.',
          sentences: [], facts: [], fallback_reason: 'unavailable',
          search: {
            question: 'Kim yaptırdı?', status: 'answered', message: 'Kurgusal Cami hakkında onaylı kayıt:',
            monument: { monument_id: 'BUR-9001', name: 'Kurgusal Cami' }, answer: FACT, related: [], options: [],
            answer_method: 'approved_text_retrieval', retrieval: 'lexical', notice: '',
          },
        }),
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Kim yaptırdı?{Enter}')
    expect(await screen.findByText(/Bunun yerine onaylı kayıtlarda arama yapıldı/)).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Onaylı kayıt: Kurgusal yapım' })).toBeInTheDocument()
  })

  it('yedek aramada yazım düzeltmesi zayıfsa olguyu göstermez; öneri onaylanınca düzeltilmiş soruyu o eserde sorar', async () => {
    const bodies: Record<string, unknown>[] = []
    stubFetch({
      ...enabled,
      '/guide/ask': async (init?: RequestInit) => {
        const b = JSON.parse(String(init?.body))
        bodies.push(b)
        const search: AskResult = bodies.length === 1
          ? {
              question: 'krgsl cmi kim ypti', status: 'clarification_required',
              message: 'Sorunuzu tam anlayamadım. “Kurgusal Cami kim yaptı” mı demek istediniz?',
              monument: { monument_id: 'BUR-9001', name: 'Kurgusal Cami' }, answer: null, related: [], options: [],
              answer_method: 'approved_text_retrieval', retrieval: 'lexical', notice: '',
              interpreted_question: 'Kurgusal Cami kim yaptı',
              suggestions: [{ question: 'Kurgusal Cami kim yaptı', fact_id: 'BUR-9001-F001', title: 'Kurgusal yapım',
                monument_id: 'BUR-9001', monument_name: 'Kurgusal Cami' }],
            }
          : {
              question: 'Kurgusal Cami kim yaptı', status: 'answered', message: 'Kurgusal Cami hakkında onaylı kayıt:',
              monument: { monument_id: 'BUR-9001', name: 'Kurgusal Cami' }, answer: FACT, related: [], options: [],
              answer_method: 'approved_text_retrieval', retrieval: 'lexical', notice: '',
            }
        return {
          body: result({
            mode: 'fallback_search', message: 'Yapay zekâ sağlayıcısına ulaşılamadı. Bunun yerine onaylı katalogda arama yapıldı.',
            sentences: [], facts: [], fallback_reason: 'unavailable', search,
          }),
        }
      },
    })
    render(<AskMonument monumentId="BUR-9002" monumentName="Kurgusal Han" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'krgsl cmi kim ypti{Enter}')
    const yes = await screen.findByRole('button', { name: /Evet, “Kurgusal Cami kim yaptı”/ })
    expect(screen.queryByRole('article', { name: 'Onaylı kayıt: Kurgusal yapım' })).not.toBeInTheDocument()
    await userEvent.click(yes)
    expect(await screen.findByRole('article', { name: 'Onaylı kayıt: Kurgusal yapım' })).toBeInTheDocument()
    expect(bodies[1]).toMatchObject({ question: 'Kurgusal Cami kim yaptı', monument_id: 'BUR-9001' })
  })

  it('fotoğraf önizlemesi, sağlayıcı bilgilendirmesi ve gizlilik onayı gösterir; fotoğrafı onayla gönderir; belirsiz eşleşmede seçenek sunar', async () => {
    const bodies: Record<string, unknown>[] = []
    stubFetch({
      ...enabled,
      '/guide/ask': async (init?: RequestInit) => {
        const b = JSON.parse(String(init?.body))
        bodies.push(b)
        if (b.image) {
          return {
            body: result({
              status: 'clarification_required', message: 'Fotoğraftaki yapı birden fazla esere benzeyebilir.',
              sentences: [], facts: [], monument: null,
              options: [{ monument_id: 'BUR-9002', name: 'Kurgusal Han' }],
              photo: {
                is_architecture: true, description: 'Fotoğrafta iki katlı, revaklı bir avlu görülüyor.',
                features: ['revaklı avlu'], visible_text: '', candidates: [], metadata_removed: ['EXIF/XMP'],
              },
            }),
          }
        }
        return { body: result() }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Galeriden fotoğraf seç'), file)
    expect(await screen.findByAltText('Eklenecek fotoğrafın önizlemesi')).toBeInTheDocument()
    expect(screen.getByText(/OpenRouter üzerinden\s+NVIDIA Nemotron modeline gönderilir ve VAKIFNAME'de saklanmaz/)).toBeInTheDocument()
    expect(screen.queryByText(/EVREN/)).toBeNull()
    // Gizlilik onayı verilmeden fotoğraf gönderilemez.
    expect(screen.getByRole('button', { name: 'Sor' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /insan yüzü, kişisel bilgi veya gizli belge olmadığını onaylıyorum/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByLabelText('Fotoğrafın Mimari Analizi')).toHaveTextContent(/revaklı bir avlu/)
    expect(screen.getByText(/konum ve cihaz bilgileri gönderilmeden önce silindi/)).toBeInTheDocument()
    expect(bodies[0].question).toBe('Bu fotoğraftaki yapı hakkında ne söyleyebilirsin?')
    expect(bodies[0].image).toMatchObject({ mime: 'image/jpeg', consent: true })
    expect(screen.queryByAltText('Eklenecek fotoğrafın önizlemesi')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Kurgusal Han' }))
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].image).toBeUndefined()
    expect(bodies[1].monument_id).toBe('BUR-9002')
    expect(JSON.stringify(bodies[1].history)).toContain('Fotoğraftan gözlem: Fotoğrafta iki katlı')
  })

  it('kimlik bulunamasa da mimari analizi tek alanda gösterir; kimlik yalnızca altta not; daha ayrıntılı açıklama ve takip soruları analiz bağlamıyla gider', async () => {
    const bodies: Record<string, unknown>[] = []
    const manual = [
      { monument_id: 'BUR-9001', name: 'Kurgusal Cami' },
      { monument_id: 'BUR-9002', name: 'Kurgusal Han' },
    ]
    const analysis =
      'Fotoğraf gece çekilmiş; yapı sarı ışıklarla aydınlatılmış. Üstte sıra sıra dizilmiş küçük kubbeler ve iki yüksek minare görülüyor.'
    stubFetch({
      ...enabled,
      '/guide/ask': async (init?: RequestInit) => {
        const b = JSON.parse(String(init?.body))
        bodies.push(b)
        if (b.image) {
          return {
            body: result({
              status: 'photo_analyzed', message: 'Fotoğraftan yapının kesin kimliği doğrulanamadı.',
              sentences: [], facts: [], monument: null, options: [], manual_options: manual,
              actions: ['explain_more', 'choose_manually', 'upload_another'],
              photo: {
                is_architecture: true, building_type: 'cami', description: analysis,
                features: ['küçük kubbeler', 'iki minare', 'gece aydınlatması'], visible_text: '', candidates: [],
                metadata_removed: [], identity: { identifiable: 'uncertain', reason: '' },
                synthetic_signs: ['Minarelerin şerefe sayıları farklı görünüyor; görsel kurgusal olabilir.'],
              },
            }),
          }
        }
        if (b.photo_context) {
          return {
            body: result({
              status: 'photo_followup', monument: null, facts: [],
              message: 'Önceki fotoğraf analizine ve genel mimari bilgiye dayanan açıklama (fotoğraf yeniden incelenmedi):',
              sentences: [
                { text: 'Fotoğrafta küçük kubbeler sıra sıra dizilmiş.', sources: ['FOTOGRAF'] },
                { text: 'Kubbe, altındaki mekânı örten yarım küre biçimli örtüdür.', sources: ['GENEL'] },
              ],
              actions: ['upload_another'],
            }),
          }
        }
        return { body: result() }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Galeriden fotoğraf seç'), file)
    await userEvent.click(await screen.findByRole('checkbox', { name: /insan yüzü/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    const panel = await screen.findByLabelText('Fotoğrafın Mimari Analizi')
    expect(within(panel).getByRole('heading', { name: 'Fotoğrafın Mimari Analizi' })).toBeInTheDocument()
    expect(within(panel).getByText(analysis)).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Dikkat Çeken Mimari Özellikler' })).toBeInTheDocument()
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toContain('gece aydınlatması')
    expect(panel).toHaveTextContent(/olası işaretler \(kesin yargı değildir\).*kurgusal olabilir/)
    // Kimlik notu yalnızca bir kez, analizin altında; eski "eşleştirilemedi" ana mesajı ve ikinci açıklama kutusu yok.
    expect(screen.getAllByText('Fotoğraftan yapının kesin kimliği doğrulanamadı.')).toHaveLength(1)
    expect(panel.lastElementChild).toHaveTextContent('Fotoğraftan yapının kesin kimliği doğrulanamadı.')
    expect(screen.queryByText(/eşleştirilemedi/)).toBeNull()
    expect(screen.getAllByText(analysis)).toHaveLength(1)
    expect(screen.queryByRole('group', { name: 'Olası eserler' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kurgusal Cami' })).toBeNull()
    const actions = screen.getByRole('group', { name: 'Ne yapmak istersiniz?' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Mimariyi daha ayrıntılı açıkla', 'Kayıtlı eserlerden birini seç', 'Başka fotoğraf yükle',
    ])

    // Daha ayrıntılı açıklama: fotoğraf yeniden gönderilmez, analiz metni bağlam olur.
    await userEvent.click(within(actions).getByRole('button', { name: 'Mimariyi daha ayrıntılı açıkla' }))
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].image).toBeUndefined()
    expect(bodies[1].question).toBe('Fotoğraftaki mimariyi daha ayrıntılı açıklar mısın?')
    expect(bodies[1].photo_context).toEqual({ description: analysis, features: ['küçük kubbeler', 'iki minare', 'gece aydınlatması'] })
    const followup = await screen.findByLabelText('Mimari açıklama')
    expect(within(followup).getByText('fotoğraf')).toBeInTheDocument()
    expect(within(followup).getByText('genel bilgi')).toBeInTheDocument()

    // Serbest takip sorusu da aynı analiz bağlamıyla gider.
    const input = screen.getByLabelText(/hakkında sorunuz/)
    expect(input).toHaveAttribute('placeholder', expect.stringMatching(/Fotoğraftaki mimari hakkında sorun/))
    await userEvent.type(input, 'Minarelerin mimari işlevi nedir?{Enter}')
    await vi.waitFor(() => expect(bodies).toHaveLength(3))
    expect(bodies[2].photo_context).toEqual(bodies[1].photo_context)

    // Kendi seçimi: yalnızca tarihî sorunun bağlamı; fotoğraf ve analiz gönderilmez.
    const first = screen.getAllByRole('group', { name: 'Ne yapmak istersiniz?' })[0]
    await userEvent.click(within(first).getByRole('button', { name: 'Kayıtlı eserlerden birini seç' }))
    expect(screen.getByText(/bu seçim fotoğrafın o esere ait olduğu anlamına gelmez/)).toBeInTheDocument()
    const list = screen.getByRole('group', { name: 'Kayıtlı eserler' })
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Kurgusal Cami', 'Kurgusal Han'])
    await userEvent.click(within(list).getByRole('button', { name: 'Kurgusal Han' }))
    await vi.waitFor(() => expect(bodies).toHaveLength(4))
    expect(bodies[3].image).toBeUndefined()
    expect(bodies[3].photo_context).toBeUndefined()
    expect(bodies[3].monument_id).toBe('BUR-9002')
    expect(await screen.findByText(/fotoğrafla eşleştirilmeden, seçtiğiniz eserin onaylı kayıtlarına dayanır/)).toBeInTheDocument()
    // Fotoğraf dışı bir cevaptan sonra analiz bağlamı düşer.
    await userEvent.type(input, 'Kim yaptırdı?{Enter}')
    await vi.waitFor(() => expect(bodies).toHaveLength(5))
    expect(bodies[4].photo_context).toBeUndefined()
  })

  it('fotoğraf analizi başarısızsa eser bilgisi göstermez; tekrar dene, başka fotoğraf ve fotoğrafsız sor sunar', async () => {
    const bodies: Record<string, unknown>[] = []
    stubFetch({
      ...enabled,
      '/guide/ask': async (init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return {
          body: result({
            status: 'photo_analysis_failed', message: 'Fotoğraf şu anda analiz edilemedi. Yeniden deneyebilirsiniz.',
            sentences: [], facts: [], monument: null, options: [], manual_options: [], photo: null,
            actions: ['retry_photo', 'upload_another', 'ask_without_photo'], fallback_reason: 'timeout',
          }),
        }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Galeriden fotoğraf seç'), file)
    await userEvent.click(await screen.findByRole('checkbox', { name: /insan yüzü/ }))
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Bu yapı ne zaman yapıldı?')
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByText('Fotoğraf şu anda analiz edilemedi. Yeniden deneyebilirsiniz.')).toBeInTheDocument()
    // Açık eserin kaydı veya kaynak kartı gösterilmez; sahte analiz veya mimari açıklama seçeneği yok.
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.queryByLabelText('Fotoğrafın Mimari Analizi')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mimariyi daha ayrıntılı açıkla' })).toBeNull()
    const actions = screen.getByRole('group', { name: 'Ne yapmak istersiniz?' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Tekrar dene', 'Başka fotoğraf yükle', 'Fotoğraf olmadan soru sor',
    ])
    // Tekrar dene: yalnızca tıklanınca, aynı fotoğraf ve soru bir kez daha gönderilir.
    expect(bodies).toHaveLength(1)
    await userEvent.click(within(actions).getByRole('button', { name: 'Tekrar dene' }))
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].image).toEqual(bodies[0].image)
    expect(bodies[1].question).toBe('Bu yapı ne zaman yapıldı?')
    // Fotoğrafsız sor: soru giriş alanına konur, kendiliğinden gönderilmez.
    const last = screen.getAllByRole('group', { name: 'Ne yapmak istersiniz?' }).at(-1)!
    await userEvent.click(within(last).getByRole('button', { name: 'Fotoğraf olmadan soru sor' }))
    expect(screen.getByLabelText(/hakkında sorunuz/)).toHaveValue('Bu yapı ne zaman yapıldı?')
    expect(screen.getByText(/Fotoğraf kullanılmadan, Kurgusal Cami hakkındaki onaylı kayıtlardan cevaplanır/)).toBeInTheDocument()
    expect(bodies).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    await vi.waitFor(() => expect(bodies).toHaveLength(3))
    expect(bodies[2].image).toBeUndefined()
  })

  it('fotoğraflı soru ağ hatasıyla düşerse açık eserin kayıtlarını aramayı önermez', async () => {
    stubFetch({ ...enabled, '/guide/ask': new TypeError('ağ yok') })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Galeriden fotoğraf seç'), file)
    await userEvent.click(await screen.findByRole('checkbox', { name: /insan yüzü/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Fotoğraf şu anda analiz edilemedi\./)
    expect(screen.queryByRole('button', { name: 'Onaylı kayıtlarda ara (yapay zekâsız)' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument()
  })

  it('güvenilir eşleşmede mimari analiz ile onaylı tarihî bilgiyi ayrı bölümlerde gösterir', async () => {
    stubFetch({
      ...enabled,
      '/guide/ask': {
        body: result({
          photo: {
            is_architecture: true, description: 'Giriş kemerli. Cephe tuğla ve taş sıralarına benziyor.',
            features: ['kemerli giriş'], visible_text: 'KURGUSAL', metadata_removed: [],
            candidates: [{ monument_id: 'BUR-9001', name: 'Kurgusal Cami', likelihood: 'high' }],
          },
        }),
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Kim yaptırdı?{Enter}')
    const panel = await screen.findByLabelText('Fotoğrafın Mimari Analizi')
    expect(panel).toHaveTextContent('tuğla ve taş sıralarına benziyor')
    expect(panel).toHaveTextContent('Fotoğrafta okunan yazı: «KURGUSAL»')
    expect(panel).toHaveTextContent('Kayıtlı eserlerle karşılaştırma: Kurgusal Cami ile yüksek görsel benzerlik (kesin kimlik değildir).')
    expect(panel).not.toHaveTextContent('1400')
    const answer = screen.getByLabelText('Yapay zekâ cevabı')
    expect(answer).not.toHaveTextContent('tuğla')
    expect(answer).toHaveTextContent('Onaylı kayıtlardan doğrulanmış tarihî bilgi')
  })

  it('sunucuda yüz taraması hazır değilse fotoğraf düğmelerini göstermez', async () => {
    stubFetch({ '/guide/status': { body: { enabled: true, configured: true, photo: false, max_image_mb: 6 } } })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Sor' })
    expect(screen.queryByRole('button', { name: 'Fotoğraf ekle' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kamerayla çek' })).toBeNull()
  })

  it('test modunda anahtarı yalnızca formdan, çerezli oturumla gönderir; URL veya depo kullanmaz', async () => {
    let opened = false
    const calls: { path: string; init?: RequestInit }[] = []
    const fetchMock = stubFetch({
      '/guide/status': async (init?: RequestInit) => {
        calls.push({ path: '/guide/status', init })
        return { body: opened ? { enabled: true, configured: true, photo: true, max_image_mb: 6 } : { enabled: false, tester_login: true } }
      },
      '/guide/session': async (init?: RequestInit) => {
        calls.push({ path: '/guide/session', init })
        opened = JSON.parse(String(init?.body)).key === 'deneme-anahtari-0123456789'
        return opened ? { body: {} } : { status: 401, body: { detail: 'Test anahtarı geçersiz.' } }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await userEvent.click(await screen.findByText('Yapay zekâ rehberi deneme erişimi'))
    const input = screen.getByLabelText('Test anahtarı')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.type(input, 'deneme-anahtari-0123456789')
    await userEvent.click(screen.getByRole('button', { name: 'Giriş' }))
    expect(await screen.findByRole('button', { name: 'Fotoğraf ekle' })).toBeInTheDocument()
    const login = calls.find((c) => c.path === '/guide/session')!
    expect(login.init?.credentials).toBe('include')
    expect((login.init?.headers as Record<string, string>)['X-Vakifname-Guide']).toBe('1')
    for (const [input] of fetchMock.mock.calls) expect(String(input)).not.toContain('deneme-anahtari')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('deneme-anahtari')
    expect(JSON.stringify({ ...localStorage })).not.toContain('deneme-anahtari')
    expect(window.location.href).not.toContain('deneme-anahtari')
  })

  it('uzun beklemede aşamalı durum ve süre gösterir; zaman aşımında yeniden göndermez, isteğe bağlı kaynaklı arama sunar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let guideCalls = 0
      const searchBodies: unknown[] = []
      stubFetch({
        ...enabled,
        '/guide/ask': (init?: RequestInit) => {
          guideCalls += 1
          // Sağlayıcı hiç cevap vermiyor: istek ancak arayüzün zaman aşımıyla kesilir.
          return new Promise((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          )
        },
        '/monuments/ask': async (init?: RequestInit) => {
          searchBodies.push(JSON.parse(String(init?.body)))
          return {
            body: {
              question: 'Kim yaptırdı?', status: 'answered', message: 'Kurgusal Cami hakkında onaylı kayıt:',
              monument: { monument_id: 'BUR-9001', name: 'Kurgusal Cami' }, answer: FACT, related: [], options: [],
              answer_method: 'approved_text_retrieval', retrieval: 'lexical', notice: '',
            },
          }
        },
      })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
      await screen.findByRole('button', { name: 'Fotoğraf ekle' })
      await user.type(screen.getByLabelText(/hakkında sorunuz/), 'Kim yaptırdı?{Enter}')
      expect(await screen.findByText('Onaylı kayıtlar aranıyor, cevap yazılıyor…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Yanıtlanıyor…' })).toBeDisabled()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.getByText(/yarım dakikayı bulabilir/)).toBeInTheDocument()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(screen.getByText(/Beklenenden uzun sürüyor\. En geç \d+ saniye içinde/)).toBeInTheDocument()
      expect(screen.getByText(/^3\d sn$/)).toBeInTheDocument()
      await vi.advanceTimersByTimeAsync(45_000)
      expect(await screen.findByRole('alert')).toHaveTextContent(/70 saniye içinde gelmedi.*yeniden gönderilmedi/)
      expect(guideCalls).toBe(1)
      await user.click(screen.getByRole('button', { name: 'Onaylı kayıtlarda ara (yapay zekâsız)' }))
      expect(await screen.findByText(/Yapay zekâsız arama sonucu/)).toBeInTheDocument()
      expect(screen.getByRole('article', { name: 'Onaylı kayıt: Kurgusal yapım' })).toBeInTheDocument()
      expect(searchBodies).toEqual([{ question: 'Kim yaptırdı?', monument_id: 'BUR-9001' }])
      expect(guideCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('test oturumunda kalan kotayı, azaldığında ve dolduğunda uyarıyı gösterir; her cevaptan sonra yeniler', async () => {
    let remaining = 6
    const status = () => ({
      body: { enabled: true, configured: true, photo: true, max_image_mb: 6, tester: true, remaining_today: remaining, deadline_s: 50 },
    })
    stubFetch({
      '/guide/status': async () => status(),
      '/guide/ask': async () => {
        remaining = Math.max(0, remaining - 1)
        return { body: result() }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    expect(await screen.findByText(/Bugün kalan yapay zekâ hakkı: 6 çağrı/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test oturumunu kapat' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Kim yaptırdı?{Enter}')
    const low = await screen.findByText(/Bugün kalan yapay zekâ hakkı: 5 çağrı/)
    expect(low).toHaveClass('notice--warning')
    remaining = 1
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Peki ne zaman?{Enter}')
    expect(await screen.findByText(/Bugünkü yapay zekâ kullanım sınırı doldu/)).toBeInTheDocument()
  })

  it('aynı oturumda süren soru varken sunucunun 409 cevabını anlaşılır gösterir', async () => {
    stubFetch({ ...enabled, '/guide/ask': { status: 409, body: { detail: 'x' } } })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Kim yaptırdı?{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Önceki sorunuz hâlâ yanıtlanıyor')
  })

  it('desteklenmeyen dosya türünü reddeder', async () => {
    stubFetch(enabled)
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await screen.findByRole('button', { name: 'Fotoğraf ekle' })
    const gif = new File(['GIF89a'], 'a.gif', { type: 'image/gif' })
    await userEvent.upload(screen.getByLabelText('Galeriden fotoğraf seç'), gif, { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Yalnızca JPEG, PNG veya WebP/)
  })
})
