import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { AskMonument } from './AskMonument'
import type { AskFact, AskResult } from './types'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const FACT: AskFact = {
  fact_id: 'BUR-9001-F001',
  monument_id: 'BUR-9001',
  monument_name: 'Kurgusal Cami',
  title: 'Kurgusal yapım',
  text: 'Kurgusal Cami, kurgusal bir sultan tarafından yaptırılmıştır.',
  category: 'construction',
  certainty: 'documented',
  certainty_label: 'Kaynaklarda belgelenmiş bilgi',
  sources: [{ title: 'Kurgusal Cami', publisher: 'Kurgusal Portal', url: 'https://example.org/kurgusal' }],
  publication_decision_id: 'DEC-0000000000000001',
}

const base = (over: Partial<AskResult>): AskResult => ({
  question: 'Kim yaptırdı?',
  status: 'answered',
  message: 'Kurgusal Cami hakkında onaylı kayıt:',
  monument: { monument_id: 'BUR-9001', name: 'Kurgusal Cami' },
  answer: FACT,
  related: [],
  options: [],
  answer_method: 'approved_text_retrieval',
  retrieval: 'hybrid',
  notice: 'Cevaplar yalnızca yayın onayı verilmiş tarihî kayıtlardan alınır.',
  verification: { answerable: true, selected_fact_id: 'BUR-9001-F001', confidence: 0.91, reason: 'Kavramlar olguda geçiyor.', method: 'learned_relevance_verifier' },
  ...over,
})

describe('AskMonument', () => {
  it('önerilen soruyla kaynaklı cevap kartı gösterir ve eser bağlamını gönderir', async () => {
    let sent: unknown = null
    stubFetch({
      '/monuments/BUR-9001/ask/suggestions': { body: { monument_id: 'BUR-9001', suggestions: ['Kim yaptırdı?'] } },
      '/monuments/ask': async (init?: RequestInit) => {
        sent = JSON.parse(String(init?.body))
        return { body: base({}) }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    expect(screen.getByText(/yapay zekâ yeni metin üretmez/i)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Kim yaptırdı?' }))
    const card = await screen.findByRole('article', { name: 'Onaylı kayıt: Kurgusal yapım' })
    expect(within(card).getByText(FACT.text)).toBeInTheDocument()
    expect(within(card).getByText('Kaynaklarda belgelenmiş bilgi')).toBeInTheDocument()
    const link = within(card).getByRole('link', { name: /Kurgusal Portal/ })
    expect(link).toHaveAttribute('href', 'https://example.org/kurgusal')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(within(card).getByText(/BUR-9001-F001/)).toBeInTheDocument()
    const verified = within(card).getByText(/Otomatik denetim bu kaydı soruyla eşleştirdi/)
    expect(verified).toHaveTextContent(/kaynağı kontrol edin/)
    expect(verified.textContent).not.toMatch(/%|güven/)
    expect(sent).toEqual({ question: 'Kim yaptırdı?', monument_id: 'BUR-9001' })
  })

  it('belirsiz soruda eser seçenekleri sunar; seçilen eserle aynı soruyu yeniden sorar', async () => {
    const bodies: unknown[] = []
    stubFetch({
      '/monuments/ask': async (init?: RequestInit) => {
        const b = JSON.parse(String(init?.body))
        bodies.push(b)
        if (b.monument_id === 'BUR-9002') return { body: base({ answer: { ...FACT, monument_id: 'BUR-9002' } }) }
        return {
          body: base({
            status: 'clarification_required', message: '“Muradiye” adı birden fazla esere karşılık geliyor.', answer: null,
            options: [{ monument_id: 'BUR-9002', name: 'Kurgusal Türbe' }],
          }),
        }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Muradiye ne zaman yapıldı?')
    await userEvent.click(screen.getByRole('button', { name: 'Sor' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Kurgusal Türbe' }))
    await screen.findByRole('article', { name: /Onaylı kayıt/ })
    expect(bodies[1]).toEqual({ question: 'Muradiye ne zaman yapıldı?', monument_id: 'BUR-9002' })
  })

  it('yazım düzeltmesi zayıfsa "bunu mu demek istediniz?" sorar; onaylanınca düzeltilmiş soruyu sorar', async () => {
    const bodies: unknown[] = []
    stubFetch({
      '/monuments/ask': async (init?: RequestInit) => {
        const b = JSON.parse(String(init?.body))
        bodies.push(b)
        if (bodies.length > 1) return { body: base({ question: b.question }) }
        return {
          body: base({
            status: 'clarification_required', answer: null,
            message: 'Sorunuzu tam anlayamadım. “Kurgusal Cami kim yaptı” mı demek istediniz?',
            interpreted_question: 'Kurgusal Cami kim yaptı',
            suggestions: [{ question: 'Kurgusal Cami kim yaptı', fact_id: 'BUR-9001-F001', title: 'Kurgusal yapım',
              monument_id: 'BUR-9001', monument_name: 'Kurgusal Cami' }],
          }),
        }
      },
    })
    render(<AskMonument monumentId="BUR-9002" monumentName="Kurgusal Han" />)
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'krgsl cmi kim ypti{Enter}')
    const yes = await screen.findByRole('button', { name: /Evet, “Kurgusal Cami kim yaptı” · Kurgusal Cami/ })
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    await userEvent.click(yes)
    await screen.findByRole('article', { name: 'Onaylı kayıt: Kurgusal yapım' })
    expect(bodies[1]).toEqual({ question: 'Kurgusal Cami kim yaptı', monument_id: 'BUR-9001' })
  })

  it('bozuk öneri biçimini reddeder', async () => {
    stubFetch({
      '/monuments/ask': {
        body: base({ status: 'clarification_required', answer: null, suggestions: [{ question: 'x' }] as never }),
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'krgsl{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/beklenmeyen/)
  })

  it('cevap bulunamadığında açık mesaj verir; kaynaksız olgu cevabını reddeder', async () => {
    let n = 0
    stubFetch({
      '/monuments/ask': async () => {
        n += 1
        if (n === 1) return { body: base({ status: 'not_found', message: 'Bu soruyu cevaplayan onaylı bir kayıt bulamadım.', answer: null }) }
        return { body: base({ answer: { ...FACT, sources: [] } }) }
      },
    })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    const input = screen.getByLabelText(/hakkında sorunuz/)
    await userEvent.type(input, 'Kaç penceresi var?{Enter}')
    expect(await screen.findByText(/onaylı bir kayıt bulamadım/)).toBeInTheDocument()
    await userEvent.type(input, 'Kim yaptırdı?{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/beklenmeyen/)
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })

  it('sunucuda kapatılmışsa bölümü göstermez; açıksa deneme sürümü olduğunu belirtir', async () => {
    stubFetch({ '/monuments/BUR-9001/ask/suggestions': { status: 503, body: { detail: 'Esere Sor şu anda kapalı.' } } })
    const { container, rerender } = render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    expect(screen.getByText('Deneme sürümü')).toBeInTheDocument()
    await vi.waitFor(() => expect(container.querySelector('#esere-sor')).toBeNull())
    rerender(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    expect(container.querySelector('#esere-sor')).toBeNull()
  })

  it('istek sınırı aşılınca anlaşılır uyarı gösterir', async () => {
    stubFetch({ '/monuments/ask': { status: 429, body: { detail: 'Çok fazla soru gönderildi.' } } })
    render(<AskMonument monumentId="BUR-9001" monumentName="Kurgusal Cami" />)
    await userEvent.type(screen.getByLabelText(/hakkında sorunuz/), 'Kim yaptırdı?{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/bir dakika sonra/)
  })
})
