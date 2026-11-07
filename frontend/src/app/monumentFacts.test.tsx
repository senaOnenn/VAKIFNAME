import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import { sourceRef } from './sourceRef'

// R3.4 "Tarih Defteri". Kurgusal eser ve kayıtlar (BUR-9xxx gerçek katalog kimliği değildir).
const REAL_FORMAT = 'Bursa Vakıf Eserleri / Foundation Buildings of Bursa, Cilt II (Nisan 2026)'
const fact = (n: number, certainty: string, sourceTitle = 'Bursa Vakıf Eserleri, Cilt I', page = 20 + n) => ({
  fact_id: `BUR-9001-F00${n}`, title: `Kayıt ${n}`, text: `Kayıt ${n} metni.`, category: 'construction', certainty,
  source: { title: sourceTitle, pdf_physical_page: page, page_kind: 'physical' },
  sources: [{ title: `Bağlantı ${n}`, publisher: `Kültür Portalı ${n}`, url: `https://example.org/${n}` }], game_use: false,
})
const detail = (facts: ReturnType<typeof fact>[]) => ({
  monument_id: 'BUR-9001', name: 'Deneme Camii', alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi',
  address: 'Deneme adresi', location: { latitude: 40.18, longitude: 29.06, accuracy_m: 20, represents: 'building_footprint_centroid' },
  checkin_available: false, checkin: null, site_notice: null, illustration: 'representative_drawing', facts, images: [],
})
const FIVE = [fact(1, 'documented'), fact(2, 'uncertain', REAL_FORMAT), fact(3, 'documented'), fact(4, 'reported'), fact(5, 'documented')]

function open(facts: ReturnType<typeof fact>[]) {
  stubFetch({ '/auth/me': { status: 401, body: { detail: 'Oturum açık değil.' } }, '/monuments/BUR-9001': { body: detail(facts) } })
  window.history.replaceState(null, '', '/eser/BUR-9001')
  return render(<VakifnameApp />)
}
const region = () => screen.getByRole('dialog', { name: 'Tarih Defteri' })
const bookButton = () => screen.getByRole('button', { name: /^Tarih Defteri/ })
async function openBook(facts = FIVE) {
  open(facts)
  await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
  await userEvent.click(bookButton())
}
const ref = (term: string) => {
  const dt = within(screen.getByRole('complementary', { name: 'Kaynak bilgisi' })).getByText(term, { selector: 'dt' })
  return dt.nextElementSibling!.textContent
}
const recordTitle = () => within(region()).getByRole('heading', { level: 3 }).textContent

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  window.localStorage.setItem('vakifname.guest', '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('kaynak ayrıştırma', () => {
  it('ad, cilt, baskı ve sayfa yalnızca katalog alanlarından; eksik parça null (uydurma yok)', () => {
    expect(sourceRef(REAL_FORMAT, 20, 'tr')).toEqual({ name: 'Bursa Vakıf Eserleri', volume: 'II', edition: 'Nisan 2026', page: 20 })
    expect(sourceRef(REAL_FORMAT, 20, 'en').name).toBe('Foundation Buildings of Bursa')
    expect(sourceRef('Bursa Vakıf Eserleri, Cilt I', 21, 'tr')).toEqual({ name: 'Bursa Vakıf Eserleri', volume: 'I', edition: null, page: 21 })
    expect(sourceRef('Yerel Tarih Dergisi', 5, 'tr')).toEqual({ name: 'Yerel Tarih Dergisi', volume: null, edition: null, page: 5 })
    expect(sourceRef('', 0, 'tr')).toEqual({ name: null, volume: null, edition: null, page: null })
    expect(sourceRef(undefined, undefined, 'tr').name).toBeNull()
  })
})

describe('Eser sayfası: Tarih Defteri', () => {
  it('kapalı başlar: yan şeritte küçük defter girişi (kayıt sayısıyla); sahne, kayıt listesi ve metinler yok', async () => {
    open(FIVE)
    await screen.findByRole('heading', { level: 1, name: 'Deneme Camii' })
    expect(bookButton()).toHaveAccessibleName(/5 onaylı tarihî kayıt/)
    expect(bookButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: 'Tarih Defteri' })).not.toBeInTheDocument()
    // R6.10: ilk kaydın metni yalnızca künyedeki kaynaklı kısa giriş olarak görünür; defterin sayfaları açılmadan yok.
    expect(screen.getAllByText('Kayıt 1 metni.')).toHaveLength(1)
    expect(screen.queryByText('Kayıt 1 / 5')).not.toBeInTheDocument()
  })

  it('açılınca ilk kayıt: başlık ve metin bir sayfada, kaynak / yayın / kesinlik diğerinde; odak kayda geçer', async () => {
    await openBook()
    const h3 = within(region()).getByRole('heading', { level: 3, name: 'Kayıt 1' })
    expect(h3).toHaveFocus()
    expect(within(region()).getByText('Kayıt 1 metni.')).toBeInTheDocument()
    expect(within(region()).getByText('Kayıt 1 / 5')).toBeInTheDocument()
    expect(ref('Kaynak')).toBe('Bursa Vakıf Eserleri')
    expect(ref('Yayın')).toBe('Cilt I, s. 21')
    expect(ref('Kesinlik')).toBe('Kaynaklarda belgelenmiş')
    // Metin sayfası kaynak sayfasından önce gelir (telefonda tek sütunda bu sırayla okunur).
    const text = h3.closest('article')!
    const source = screen.getByRole('complementary', { name: 'Kaynak bilgisi' })
    expect(text.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('gerçek katalog biçimindeki kaynakta ad, cilt, baskı ve sayfa doğru; kesinlik etiketi korunur', async () => {
    await openBook()
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki kayıt' }))
    expect(recordTitle()).toBe('Kayıt 2')
    expect(ref('Kaynak')).toBe('Bursa Vakıf Eserleri')
    expect(ref('Yayın')).toBe('Cilt II (Nisan 2026), s. 22')
    expect(ref('Kesinlik')).toBe('Kesin değil')
  })

  it('sonraki / önceki; ilk ve son kayıtta ilgili düğme kapanır ve odak diğer düğmeye geçer', async () => {
    await openBook()
    const prev = screen.getByRole('button', { name: 'Önceki kayıt' })
    const next = screen.getByRole('button', { name: 'Sonraki kayıt' })
    expect(prev).toBeDisabled()
    for (let i = 0; i < 4; i++) await userEvent.click(next)
    expect(recordTitle()).toBe('Kayıt 5')
    expect(next).toBeDisabled()
    expect(prev).toHaveFocus()
    await userEvent.click(prev)
    expect(recordTitle()).toBe('Kayıt 4')
    expect(prev).toHaveFocus()
  })

  it('klavye: sağ/sol ok ve Home/End kayıtlar arasında gezer', async () => {
    await openBook()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(recordTitle()).toBe('Kayıt 3')
    await userEvent.keyboard('{End}')
    expect(recordTitle()).toBe('Kayıt 5')
    await userEvent.keyboard('{ArrowLeft}')
    expect(recordTitle()).toBe('Kayıt 4')
    await userEvent.keyboard('{Home}')
    expect(recordTitle()).toBe('Kayıt 1')
  })

  it('bütün kayıtlar kaybolmadan erişilebilir: dizin katalog sırasıyla; sayfa çevirerek her metin okunur; dizinden atlanır', async () => {
    await openBook()
    const index = within(region()).getByText('Bütün kayıtlar (5)').closest('details')!
    expect(within(index).getAllByRole('button').map((b) => b.querySelector('.vk-book__jump-title')!.textContent)).toEqual(
      ['Kayıt 1', 'Kayıt 2', 'Kayıt 3', 'Kayıt 4', 'Kayıt 5'])
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      seen.push(within(region()).getByText(/^Kayıt \d metni\.$/).textContent!)
      if (i < 4) await userEvent.click(screen.getByRole('button', { name: 'Sonraki kayıt' }))
    }
    expect(seen).toEqual(FIVE.map((f) => f.text))
    await userEvent.click(within(index).getByRole('button', { name: /Kayıt 2/ }))
    expect(within(region()).getByRole('heading', { level: 3, name: 'Kayıt 2' })).toHaveFocus()
    expect(within(index).getByRole('button', { name: /Kayıt 2/ })).toHaveAttribute('aria-current', 'true')
  })

  it('"Defteri kapat" pencereyi kapatır ve odak yan şeritteki defter düğmesine döner; Esc de kapatır', async () => {
    await openBook()
    expect(bookButton()).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Defteri kapat' }))
    expect(screen.queryByRole('dialog', { name: 'Tarih Defteri' })).not.toBeInTheDocument()
    expect(bookButton()).toHaveFocus()
    await userEvent.click(bookButton())
    expect(within(region()).getByRole('heading', { level: 3, name: 'Kayıt 1' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Tarih Defteri' })).not.toBeInTheDocument()
    expect(bookButton()).toHaveFocus()
  })

  it('eksik kaynak verisi dürüstçe yazılır; uydurma ad, cilt veya sayfa yok', async () => {
    await openBook([fact(1, 'documented', '', 0), fact(2, 'reported', 'Yerel Tarih Dergisi', 7)])
    expect(ref('Kaynak')).toBe('Kaynak adı kayıtta yok')
    expect(ref('Yayın')).toBe('Cilt bilgisi kayıtta yok, sayfa bilgisi kayıtta yok')
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki kayıt' }))
    expect(ref('Kaynak')).toBe('Yerel Tarih Dergisi')
    expect(ref('Yayın')).toBe('Cilt bilgisi kayıtta yok, s. 7')
    expect(ref('Kesinlik')).toBe('Aktarılan bilgi (rivayet)')
  })

  it('doğrulama bağlantıları (Kültür Portalı) defterde gösterilmez', async () => {
    await openBook()
    expect(within(region()).queryByRole('link')).not.toBeInTheDocument()
    expect(within(region()).queryByText(/Kültür Portalı/)).not.toBeInTheDocument()
  })

  it('tek kayıtta iki düğme de kapalı; kayıt yoksa defter gösterilmez', async () => {
    await openBook([fact(1, 'documented')])
    expect(screen.getByRole('button', { name: 'Önceki kayıt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sonraki kayıt' })).toBeDisabled()
  })
})
