import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Routes } from '../test/fixtures'
import InventoryApp from './InventoryApp'
import type { MonumentDetail, MonumentSummary } from './types'

// Kurgusal test kayıtları; BUR-9xxx kimlikleri gerçek V20 eserleri değildir.
const REVIEW = {
  editor_review: 'pending',
  publication_status: 'blocked',
  license_review: 'not_checked',
  location_status: 'missing' as const,
  facts_total: 1,
  facts_publicly_usable: 0,
  facts_awaiting_editor: 1,
  facts_license_unchecked: 1,
  source_audit: { quote_found_on_page: 1 },
  drafts_quarantined: 1,
  images_total: 2,
  images_publishable: 0,
  images_license_pending: 2,
  images_link_unverified: 2,
  open_issues: 0,
  public_release_blockers: ['editor_review_pending', 'publication_blocked', 'location_missing', 'facts_not_approved'],
}

const MONUMENT: MonumentSummary = {
  monument_id: 'BUR-9001',
  name: 'Test Eseri',
  city: 'Test',
  district: 'Test',
  type: 'cami',
  review_status: 'pending',
  publication_status: 'blocked',
  license_review_status: 'not_checked',
  location: {
    status: 'missing',
    latitude: null,
    longitude: null,
    source: null,
    source_reference: null,
    accuracy_m: null,
    verified_by: null,
    verified_at: null,
    note: null,
  },
  checkin_eligible: false,
  map_eligible: false,
  fact_count: 1,
  quarantined_draft_count: 1,
  image_count: 2,
  open_issue_ids: [],
  review: REVIEW,
}

const DETAIL: MonumentDetail = {
  ...MONUMENT,
  facts: [
    {
      fact_id: 'BUR-9001-F001',
      monument_id: 'BUR-9001',
      title: 'Kurgusal olgu başlığı',
      text: 'KURGUSAL OLGU METNİ',
      category: 'construction',
      certainty: 'documented',
      review_status: 'pending',
      open_issue_ids: [],
      publicly_usable: false,
      access: {
        publication_status: 'blocked',
        editor_approval_required: true,
        license_review_status: 'not_checked',
        public_answer_eligible: false,
        game_eligible: false,
      },
      source: {
        source_file: 'kaynak-a.pdf',
        pdf_physical_page: 2,
        pdf_physical_page_count: 5,
        pdf_page_kind: 'physical',
        evidence_quote: 'KURGUSAL ALINTI',
        evidence_status: 'text_matched',
        source_page_id: 'BUR-9001-P01',
        page_audit: 'quote_found_on_page',
      },
    },
  ],
  open_issues: [],
}

const STATUS = {
  counts: { monuments: 1, existing_historical_facts: 1, unapproved_drafts: 1, open_editorial_issues: 0 },
  images: 2,
  locations: { missing: 1, unverified: 0, verified: 0 },
  publicly_usable_facts: 0,
  publishable_images: 0,
  public_access: false,
}

const TOKEN = 'kurgusal-test-anahtari-0123456789abcdef'

function routes(authenticated: { value: boolean }, overrides: Routes = {}): Routes {
  const guard = (body: unknown) => () => (authenticated.value ? { body } : { status: 401, body: { detail: 'Yetkisiz' } })
  return {
    '/internal/session': (init?: RequestInit) => {
      if (init?.method === 'POST') {
        const { token } = JSON.parse(String(init.body))
        if (token !== TOKEN) return { status: 401, body: { detail: 'Erişim anahtarı geçersiz.' } }
        authenticated.value = true
        return { status: 204, body: null }
      }
      if (init?.method === 'DELETE') {
        authenticated.value = false
        return { status: 204, body: null }
      }
      return guard({ authenticated: true })()
    },
    '/internal/status': guard(STATUS),
    '/internal/catalog/monuments': guard([MONUMENT]),
    '/internal/catalog/monuments/BUR-9001': guard(DETAIL),
    '/internal/catalog/drafts': guard({
      quarantined: true,
      drafts: [
        {
          draft_id: 'DRAFT-BUR-9001-001',
          monument_id: 'BUR-9001',
          category: 'historical_event',
          statement: 'KURGUSAL ADAY',
          source_file: 'kaynak-a.pdf',
          pdf_physical_page: 3,
          historical_verification: 'pending_editor_review',
          page_audit: 'no_direct_quote',
        },
      ],
    }),
    ...overrides,
  }
}

/** `stubFetch` gibi çalışır; ayrıca gövdesiz 204 yanıtı döndürebilir. */
function stubReviewFetch(r: Routes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const entry = r[new URL(String(input)).pathname]
    const route = typeof entry === 'function' ? await entry(init) : entry
    if (route instanceof Error) throw route
    const { status = 200, body } = route ?? { status: 404, body: { detail: 'Not Found' } }
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const calls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([input, init]) => ({
    path: new URL(String(input)).pathname,
    init: (init ?? {}) as RequestInit,
  }))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function login(user = userEvent.setup(), token = TOKEN) {
  await user.type(await screen.findByLabelText('Dahili erişim anahtarı'), token)
  await user.click(screen.getByRole('button', { name: 'Oturum aç' }))
}

describe('Gerçek Bursa Envanteri', () => {
  it('oturum yokken yalnızca giriş formunu gösterir ve katalog istemez', async () => {
    const fetchMock = stubReviewFetch(routes({ value: false }))
    render(<InventoryApp />)
    const input = await screen.findByLabelText('Dahili erişim anahtarı')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(calls(fetchMock).map((c) => c.path)).toEqual(['/internal/session'])
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('anahtarı yalnızca oturum isteğinde gönderir; sonraki istekler çerez ve inceleme başlığıyla gider', async () => {
    const fetchMock = stubReviewFetch(routes({ value: false }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<InventoryApp />)
    await login()
    await screen.findByRole('table')

    const all = calls(fetchMock)
    const withToken = all.filter((c) => String(c.init.body ?? '').includes(TOKEN))
    expect(withToken.map((c) => [c.path, c.init.method])).toEqual([['/internal/session', 'POST']])
    for (const c of all) {
      const headers = c.init.headers as Record<string, string>
      expect(headers['X-Vakifname-Review']).toBe('1')
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-internal-token')
      expect(JSON.stringify(headers)).not.toContain(TOKEN)
      expect(c.init.credentials).toBe('same-origin')
      expect(new URL(String(fetchMock.mock.calls[0][0])).origin).toBe(window.location.origin)
    }
    expect(setItem.mock.calls.flat().join(' ')).not.toContain(TOKEN)
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  it('geçersiz anahtarda hata gösterir ve envanteri açmaz', async () => {
    stubReviewFetch(routes({ value: false }))
    render(<InventoryApp />)
    await login(userEvent.setup(), 'yanlis-anahtar')
    expect(await screen.findByRole('alert')).toHaveTextContent('Erişim anahtarı geçersiz.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Dahili erişim anahtarı')).toHaveValue('')
  })

  it('eserleri BUR kimliği, kayıt, koordinat, kaynak ve yayın engelleriyle listeler; check-in yoktur', async () => {
    stubReviewFetch(routes({ value: true }))
    render(<InventoryApp />)
    const table = await screen.findByRole('table')
    const row = within(table).getByRole('row', { name: /Test Eseri/ })
    expect(within(row).getByText('BUR-9001')).toBeInTheDocument()
    expect(within(row).getByText('Editör incelemesi bekliyor')).toBeInTheDocument()
    expect(within(row).getByText('Koordinat yok')).toBeInTheDocument()
    expect(within(row).getByText('Haritada gösterilmez · check-in kapalı')).toBeInTheDocument()
    expect(within(row).getByText('1/1 alıntı sayfada bulundu')).toBeInTheDocument()
    const blockers = within(row).getByRole('list', { name: 'Test Eseri yayın engelleri' })
    expect(within(blockers).getByText('Doğrulanmış koordinat')).toBeInTheDocument()
    expect(within(blockers).getByText('Olgu onayları')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Envanter özeti' })).toHaveTextContent('1 eserde koordinat yok')

    // Tek harita dahili araştırma haritasıdır ve adayları doğrulanmamış olarak etiketler; genel eser haritası yoktur.
    expect(screen.getByRole('region', { name: 'Bursa araştırma haritası' })).toHaveTextContent('doğrulanmamış konum adayı')
    expect(screen.queryByRole('region', { name: 'Gerçek eser haritası' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check-in|görevi dene/i })).not.toBeInTheDocument()
  })

  it('seçilen eserin kaynak sayfa referanslarını ve karantinadaki adayları gösterir', async () => {
    const user = userEvent.setup()
    stubReviewFetch(routes({ value: true }))
    render(<InventoryApp />)
    await user.click(await screen.findByRole('button', { name: 'Test Eseri' }))
    const panel = await screen.findByRole('article', { name: 'Test Eseri' })
    await within(panel).findByText('KURGUSAL OLGU METNİ')
    expect(within(panel).getByText('KURGUSAL ALINTI')).toBeInTheDocument()
    expect(within(panel).getByText('Fiziksel PDF sayfası 2 / 5')).toBeInTheDocument()
    expect(within(panel).getByText('Denetim: Alıntı sayfada bulundu')).toBeInTheDocument()
    expect(within(panel).getByText('Yayına kapalı')).toBeInTheDocument()
    expect(within(panel).getByText(/Doğrulanmış koordinat yok/)).toBeInTheDocument()

    await user.click(within(panel).getByText(/Karantinadaki aday kayıtlar \(1\)/))
    expect(await within(panel).findByText('KURGUSAL ADAY')).toBeInTheDocument()
    expect(within(panel).getByText('Karantina')).toBeInTheDocument()
  })

  it('oturum süresi dolunca giriş formuna döner', async () => {
    const auth = { value: true }
    stubReviewFetch(routes(auth, { '/internal/catalog/monuments': { status: 401, body: { detail: 'Yetkisiz' } } }))
    render(<InventoryApp />)
    expect(await screen.findByText(/Oturumun süresi doldu/)).toBeInTheDocument()
    expect(screen.getByLabelText('Dahili erişim anahtarı')).toBeInTheDocument()
  })

  it('oturumu kapatınca sunucu oturumunu siler ve veriyi kaldırır', async () => {
    const user = userEvent.setup()
    const fetchMock = stubReviewFetch(routes({ value: true }))
    render(<InventoryApp />)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Oturumu kapat' }))
    await screen.findByLabelText('Dahili erişim anahtarı')
    expect(calls(fetchMock).some((c) => c.path === '/internal/session' && c.init.method === 'DELETE')).toBe(true)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('dahili sunucu kapalıysa açık bir hata gösterir', async () => {
    stubReviewFetch({ '/internal/session': new TypeError('Failed to fetch') })
    render(<InventoryApp />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Dahili inceleme sunucusuna ulaşılamadı')
    await waitFor(() => expect(screen.queryByLabelText('Dahili erişim anahtarı')).not.toBeInTheDocument())
  })
})
