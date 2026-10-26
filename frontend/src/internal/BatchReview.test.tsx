import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { BatchReviewPanel, selectable, withoutDependents } from './BatchReview'
import type { BatchItem, BatchListing, ReviewerInfo } from './types'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const item = (over: Partial<BatchItem>): BatchItem => ({
  key: 'fact_editorial|BUR-9001-F001',
  decision_type: 'fact_editorial',
  subject_id: 'BUR-9001-F001',
  monument_id: 'BUR-9001',
  title: 'Kurgusal bilgi',
  label: 'Olgunun editör onayı',
  role: 'editor',
  status: 'pending',
  stale: false,
  done: false,
  allowed: true,
  recommended: true,
  payload: {},
  source_check: 'verified_on_page',
  source_check_required: true,
  evidence: [{ label: 'Kurgusal Portal', url: 'https://example.org/kaynak', text: 'Kurgusal alıntı' }],
  notes: null,
  unmet_prerequisites: [],
  blockers: [],
  depends_on: [],
  ...over,
})

const EDITORIAL = item({})
const PUBLICATION = item({
  key: 'fact_publication|BUR-9001-F001',
  decision_type: 'fact_publication',
  label: 'Olgunun yayımlanması',
  source_check_required: false,
  payload: { basis: 'independent_corroboration', title: 'Başlık', public_text: 'Özgün kurgusal metin burada.', corroboration_source_ids: ['IS-1'] },
  unmet_prerequisites: ['fact_editorial'],
  blockers: [{ code: 'fact_editorial', text: 'Önce bu bilginin doğruluk onayı (editör) gerekir.', resolved_in_batch: true }],
  depends_on: ['fact_editorial|BUR-9001-F001'],
})
const RIGHTS = item({
  key: 'image_rights|commons/BUR-9001/abc',
  decision_type: 'image_rights',
  subject_id: 'commons/BUR-9001/abc',
  title: 'File:Test.jpg',
  role: 'rights',
  allowed: false,
  source_check_required: false,
})

const listing = (): BatchListing => ({
  stages: [
    { decision_type: 'fact_editorial', label: 'Tarihî bilgilerin doğruluğu', role: 'editor', items: [EDITORIAL], counts: { total: 1, done: 0 } },
    { decision_type: 'fact_publication', label: 'Tarihî bilgilerin yayını (özgün metin)', role: 'editor', items: [PUBLICATION], counts: { total: 1, done: 0 } },
    { decision_type: 'image_rights', label: 'Fotoğraf hak ve lisans kayıtları', role: 'rights', items: [RIGHTS], counts: { total: 1, done: 0 } },
  ],
  reviewer_roles: ['editor'],
  max_items: 150,
  seconds_per_item: 0.5,
  excluded: ['gps_checkin (saha doğrulaması gerekir)'],
})

const EDITOR: ReviewerInfo = { reviewer_id: 'editor.a', display_name: 'Editör A', roles: ['editor'] }

describe('toplu inceleme seçim kuralları', () => {
  it('bağımlılığı seçilmeden satır seçilemez; rolü olmayan satır hiç seçilemez', () => {
    expect(selectable(EDITORIAL, new Set())).toBe(true)
    expect(selectable(PUBLICATION, new Set())).toBe(false)
    expect(selectable(PUBLICATION, new Set([EDITORIAL.key]))).toBe(true)
    expect(selectable(RIGHTS, new Set())).toBe(false)
    expect(selectable({ ...EDITORIAL, done: true }, new Set())).toBe(false)
  })

  it('bağımlılık seçimden çıkınca ona bağlı satırlar da çıkar', () => {
    const next = withoutDependents(new Set([EDITORIAL.key, PUBLICATION.key]), EDITORIAL.key, [EDITORIAL, PUBLICATION])
    expect([...next]).toEqual([])
  })
})

describe('BatchReviewPanel', () => {
  it('yeni bilette kaydet düğmesi bekleme süresi dolana kadar kapalıdır', async () => {
    stubFetch({
      '/internal/review/batch': { body: listing() },
      '/internal/review/batch/tickets': { body: { ticket_id: 't-2', keys: [EDITORIAL.key], min_review_seconds: 30, expires_in_s: 1800 } },
    })
    render(<BatchReviewPanel reviewer={EDITOR} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Seç: Olgunun editör onayı/ }))
    await userEvent.type(screen.getByLabelText(/Toplu karar gerekçesi/), 'Kaynak sayfalarını tek tek açtım.')
    await userEvent.click(screen.getByRole('button', { name: 'Seçili 1 kaydı incelemeye başla' }))
    expect(await screen.findByRole('button', { name: '1 kararı kaydet' })).toBeDisabled()
    expect(screen.getByText(/onay 30 sn sonra gönderilebilir/)).toBeInTheDocument()
  })

  it('hiçbir satırı önceden seçmez; önerilenleri yalnızca açık eylemle seçer ve ayrı kararlar gönderir', async () => {
    let submitted: { rationale: string; items: { key: string; decision: string; payload?: unknown }[] } | null = null
    const fetchMock = stubFetch({
      '/internal/review/batch': { body: listing() },
      '/internal/review/batch/tickets': async (init?: RequestInit) => ({
        body: { ticket_id: 't-1', keys: JSON.parse(String(init?.body)).keys, min_review_seconds: 0, expires_in_s: 1800 },
      }),
      '/internal/review/batch/decisions': async (init?: RequestInit) => {
        submitted = JSON.parse(String(init?.body))
        return { body: { results: [], recorded: 2, failed: 0 } }
      },
    })
    render(<BatchReviewPanel reviewer={EDITOR} />)
    const checkbox = await screen.findByRole('checkbox', { name: /Seç: Olgunun editör onayı/ })
    expect(checkbox).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Seçili 0 kaydı incelemeye başla/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Bu aşamada önerilenleri seç' }))
    expect(checkbox).toBeChecked()
    // Yayın aşaması: doğruluk onayı seçildiği için artık seçilebilir.
    await userEvent.click(screen.getByRole('button', { name: /Tarihî bilgilerin yayını/ }))
    const pub = screen.getByRole('checkbox', { name: /Seç: Olgunun yayımlanması/ })
    expect(pub).toBeEnabled()
    await userEvent.click(pub)
    // Formda yayın metni düzenlenebilir; ret seçilince ayrıntı alanları kalkar.
    expect(screen.getByLabelText(/Yayın metni/)).toHaveValue('Özgün kurgusal metin burada.')
    await userEvent.selectOptions(screen.getByLabelText('Karar'), 'rejected')
    expect(screen.queryByLabelText(/Yayın metni/)).not.toBeInTheDocument()

    // Hak aşaması bu rol için salt okunurdur.
    await userEvent.click(screen.getByRole('button', { name: /Fotoğraf hak ve lisans/ }))
    expect(screen.queryByRole('checkbox', { name: /Seç: .*File:Test.jpg/ })).not.toBeInTheDocument()
    expect(screen.getByText('Bu karar “rights” rolündeki hesapla verilir.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Toplu karar gerekçesi/), 'Kaynak sayfalarını tek tek açtım.')
    await userEvent.click(screen.getByRole('button', { name: 'Seçili 2 kaydı incelemeye başla' }))
    await userEvent.click(await screen.findByRole('button', { name: '2 kararı kaydet' }))
    expect(await screen.findByText(/2 karar kaydedildi/)).toBeInTheDocument()
    expect(submitted!.rationale).toBe('Kaynak sayfalarını tek tek açtım.')
    const byKey = Object.fromEntries(submitted!.items.map((i) => [i.key, i]))
    expect(byKey[EDITORIAL.key].decision).toBe('approved')
    expect(byKey[PUBLICATION.key]).toMatchObject({ decision: 'rejected' })
    expect(byKey[PUBLICATION.key].payload).toBeUndefined()
    // Liste yeniden yüklenir (kaydedilenler "onaylı" görünsün diye).
    expect(fetchMock.mock.calls.filter(([u]) => new URL(String(u)).pathname === '/internal/review/batch').length).toBeGreaterThan(1)
  })

  it('düzeltilen kaydı rozet ve değişiklik özetiyle gösterir; kapanmış düzeltmeyi göstermez', async () => {
    const revision = {
      addresses_decision_id: 'DEC-1', revised_at: '2026-10-24', changes: ['Bağımsız kaynak eklendi.'],
      removed_details: ['Doğrulanamayan tarih çıkarıldı.'], pending_evidence: ['Bir dergi sayısı açılamadı.'], open: true,
    }
    const base = listing()
    base.stages[0].items = [{ ...EDITORIAL, status: 'needs_revision', revision }]
    base.stages[1].items = [{ ...PUBLICATION, revision: { ...revision, open: false } }]
    stubFetch({ '/internal/review/batch': { body: base } })
    render(<BatchReviewPanel reviewer={EDITOR} />)
    expect(await screen.findByText('Düzeltildi · yeniden incelemede')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Kanıt ve ayrıntı' }))
    const note = screen.getByRole('region', { name: 'Düzeltme özeti' })
    expect(within(note).getByText('Doğrulanamayan tarih çıkarıldı.')).toBeInTheDocument()
    expect(within(note).getByText('Bir dergi sayısı açılamadı.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Tarihî bilgilerin yayını/ }))
    expect(screen.queryByText('Düzeltildi · yeniden incelemede')).not.toBeInTheDocument()
  })

  it('incelemeci girişi yoksa gönderim alanı göstermez', async () => {
    stubFetch({ '/internal/review/batch': { body: { ...listing(), reviewer_roles: [] } } })
    render(<BatchReviewPanel reviewer={null} />)
    expect(await screen.findByText(/kişisel incelemeci hesabınızla giriş yapın/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Toplu karar gönderimi' })).not.toBeInTheDocument()
    const stage = screen.getByRole('navigation', { name: 'İnceleme aşamaları' })
    expect(within(stage).getAllByRole('button')).toHaveLength(3)
  })
})

describe('yeni Commons adayları', () => {
  const facts = {
    candidate_batch: 'g28-commons-candidates-v1',
    monument_name: 'Kurgusal Cami',
    file_page_url: 'https://commons.wikimedia.org/wiki/File:Aday.jpg',
    artist: 'Aday Fotoğrafçı',
    credit: null,
    license_short_name: 'CC BY 3.0',
    license_url: 'https://creativecommons.org/licenses/by/3.0',
    license_obligations: 'Yazar adı ve lisans gösterilmeli.',
    attribution: 'Fotoğraf: Aday Fotoğrafçı, CC BY 3.0, Wikimedia Commons',
    stored_size: [1600, 1067] as [number, number],
    original_size: [4000, 2667] as [number, number],
    date: '2014',
    angle_classes: ['dis_cephe'],
    people: 1,
    sign_or_text: 0,
    confusion_risk: 'Düşük',
    doubts: ['Kamera GPS’i yok: kimlik yalnızca görsel karşılaştırmaya dayanıyor.'],
    reviewed_by: 'masa başı',
  }
  const cand = (over: Partial<BatchItem>) =>
    item({
      subject_id: 'commons/BUR-9001/c0ffee0000000001',
      title: 'File:Aday.jpg',
      role: 'rights',
      source_check_required: false,
      media_url: '/internal/review/media/card/commons/BUR-9001/c0ffee0000000001',
      image_facts: facts,
      ...over,
    })
  const RIGHTS_C = cand({
    key: 'image_rights|commons/BUR-9001/c0ffee0000000001',
    decision_type: 'image_rights',
    label: 'Görsel hak, lisans ve eşleşme kaydı',
    payload: { rights_holder: 'Aday Fotoğrafçı', license: 'CC-BY-3.0', attribution: facts.attribution, source_url: facts.file_page_url },
  })
  const REF_C = cand({
    key: 'image_reference_index|commons/BUR-9001/c0ffee0000000001',
    decision_type: 'image_reference_index',
    label: 'Fotoğrafın görsel tanıma referans indeksinde kullanılması',
    payload: { angle_classes: ['dis_cephe'], people: 'incidental', visible_text: 'none' },
    depends_on: ['image_rights|commons/BUR-9001/c0ffee0000000001'],
  })
  const RIGHTS_REVIEWER: ReviewerInfo = { reviewer_id: 'rights.a', display_name: 'Hak', roles: ['rights'] }

  it('künyeyi, saklanan önizlemeyi ve şüpheleri gösterir; eser eşleşmesi işaretli gelmez', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path.startsWith('/internal/review/media/')) return new Response('x', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      const body: BatchListing = {
        ...listing(),
        stages: [
          { decision_type: 'image_rights', label: 'Fotoğraf hak ve lisans kayıtları', role: 'rights', items: [RIGHTS_C], counts: { total: 1, done: 0 } },
          { decision_type: 'image_reference_index', label: 'Referans', role: 'rights', items: [REF_C], counts: { total: 1, done: 0 } },
        ],
        reviewer_roles: ['rights'],
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:onizleme'), revokeObjectURL: vi.fn() }))
    const user = userEvent.setup()
    render(<BatchReviewPanel reviewer={RIGHTS_REVIEWER} />)

    const row = (await screen.findByText('File:Aday.jpg')).closest('li')!
    await user.click(within(row).getByRole('checkbox', { name: /Seç: Görsel hak/ }))
    expect(await within(row).findByAltText('Önizleme: File:Aday.jpg')).toHaveAttribute('src', 'blob:onizleme')
    const media = fetchMock.mock.calls.find(([u]) => String(u).includes('/internal/review/media/'))!
    expect((media as unknown as [string, RequestInit])[1].headers).toEqual({ 'X-Vakifname-Review': '1' })
    expect(within(row).getByText(/Yeni aday/)).toBeInTheDocument()
    expect(within(row).getByText(facts.attribution)).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'CC BY 3.0' })).toHaveAttribute('href', facts.license_url)
    expect(within(row).getByText(/Saklanan 1600×1067 px · özgün 4000×2667 px/)).toBeInTheDocument()
    expect(within(row).getByText(facts.doubts[0])).toBeInTheDocument()
    expect(within(row).getByRole('checkbox', { name: /bu eseri gösterdiğini kontrol ettim/ })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: /Referans/ }))
    const refRow = (await screen.findByText('File:Aday.jpg')).closest('li')!
    await user.click(within(refRow).getByRole('checkbox', { name: /Seç: Fotoğrafın görsel tanıma/ }))
    expect(within(refRow).getByRole('checkbox', { name: 'Dış cephe' })).toBeChecked()
    expect(within(refRow).getByRole('checkbox', { name: /referans kullanımı için ayrıca kontrol ettim/ })).not.toBeChecked()
    expect(within(refRow).getByText(/ziyaretçilere yayımlamaz/)).toBeInTheDocument()
  })
})
