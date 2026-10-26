import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { DecisionPanel } from './DecisionPanel'
import type { ReviewerInfo, ReviewSubject } from './types'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Kurgusal eser; BUR-9xxx gerçek V20 eseri değildir.
const source = (id: string, kind: string, extra = {}) => ({
  source_id: id, kind, publisher: 'Test', title: `Başlık ${id}`, url: kind === 'v20_source_pdf' ? null : 'https://example.org/k',
  pdf_file: kind === 'v20_source_pdf' ? 'kaynak-a.pdf' : null, pdf_physical_page: kind === 'v20_source_pdf' ? 2 : null,
  supports: ['identity', 'address'], summary: 'Kurgusal özet.', ...extra,
})
const SUBJECT: ReviewSubject = {
  subject_kind: 'monument',
  subject_id: 'BUR-9001',
  subject_sha256: 'a'.repeat(64),
  content: {
    monument_id: 'BUR-9001', v20_name: 'Test Eser', city: 'Bursa', district: 'Osmangazi', type: 'türbe',
    research: {
      monument_id: 'BUR-9001', full_name: 'Test Eseri Türbesi', alternative_names: ['Eski Ad'],
      address_claims: [{ value: 'Kitap Mahallesi', source_id: 'S-9001-PDF' }, { value: 'Portal Caddesi', source_id: 'S-9001-KP' }],
      sources: [source('S-9001-PDF', 'v20_source_pdf'), source('S-9001-KP', 'official_portal'),
                source('S-9001-OSM', 'open_map_data', { supports: ['location'] })],
      discrepancies: [{ discrepancy_id: 'D-9001-01', topic: 'Adres', description: 'Kurgusal fark.', source_ids: ['S-9001-PDF'] }],
      site_context: { active_place_of_worship: false, burial_site: true, access_notes: 'ARAŞTIRMA NOTU' },
      vgm_search: 'Yok.',
    },
  },
  decisions: {
    catalog_identity: { status: 'pending', stale: false, decision: null, label: 'Eser kimliği', role: 'editor', unmet_prerequisites: [] },
  },
  history: [],
}
const EDITOR: ReviewerInfo = { reviewer_id: 'editor.a', display_name: 'Editör A', roles: ['editor'] }

function stub(decisions: unknown[]) {
  stubFetch({
    '/internal/review/subjects/monument/BUR-9001': { body: SUBJECT },
    '/internal/review/tickets': { body: { ticket_id: 't-1', decision_type: 'catalog_identity', subject_sha256: 'x',
                                         supersedes: null, min_review_seconds: 0, unmet_prerequisites: [] } },
    '/internal/review/decisions': (init) => {
      decisions.push(JSON.parse(String(init?.body)))
      return { status: 201, body: {} }
    },
  })
}

describe('temel kimlik formu', () => {
  it('JSON yazdırmadan seçimlerden kimlik ayrıntısını kurar; hiçbir alan önceden seçili değildir', async () => {
    const decisions: unknown[] = []
    stub(decisions)
    const user = userEvent.setup()
    render(<DecisionPanel kind="monument" subjectId="BUR-9001" reviewer={EDITOR} />)
    await user.click(await screen.findByRole('button', { name: 'Eser kimliği: karar ver' }))
    const form = await screen.findByRole('group', { name: /Temel kimlik/ })
    expect(screen.queryByLabelText(/JSON/)).not.toBeInTheDocument()
    expect(form).toHaveTextContent('BUR-9001')
    expect(form).toHaveTextContent('türbe')
    expect(form).toHaveTextContent('Bursa / Osmangazi')
    expect(within(form).getByLabelText(/Eser adı/)).toHaveValue('')
    for (const box of within(form).getAllByRole('checkbox')) expect(box).not.toBeChecked()
    for (const radio of within(form).getAllByRole('radio')) expect(radio).not.toBeChecked()
    // Resmî kaynak bağlantısı tıklanabilir; harita kaynağı kimlik kaynağı olarak sunulmaz.
    expect(within(form).getByRole('link', { name: 'Başlık S-9001-KP' })).toHaveAttribute('href', 'https://example.org/k')
    expect(form).not.toHaveTextContent('S-9001-OSM')
    expect(within(form).getByRole('list', { name: 'Kimlik onayı için eksikler' })).toHaveTextContent('1 tutarsızlık')

    await user.selectOptions(within(form).getByLabelText(/Eser adı/), 'Test Eseri Türbesi')
    await user.click(within(form).getByRole('radio', { name: /Portal Caddesi/ }))
    await user.click(within(form).getByRole('checkbox', { name: /S-9001-KP/ }))
    await user.click(within(form).getByRole('checkbox', { name: /D-9001-01/ }))
    expect(within(form).queryByRole('list', { name: 'Kimlik onayı için eksikler' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Editör kararı'), 'approved')
    await user.selectOptions(screen.getByLabelText('Kaynak kontrolü'), 'verified_on_page')
    await user.type(screen.getByLabelText(/Karar gerekçesi/), 'Kültür Portalı kaydıyla ad ve adres doğrulandı.')
    await user.click(screen.getByRole('button', { name: 'Kararı kaydet' }))
    expect(decisions).toEqual([{
      ticket_id: 't-1', decision: 'approved', source_check: 'verified_on_page',
      rationale: 'Kültür Portalı kaydıyla ad ve adres doğrulandı.',
      payload: { display_name: 'Test Eseri Türbesi', display_address: 'Portal Caddesi', identity_source_ids: ['S-9001-KP'],
                 published_alternative_names: [], public_site_notice: null, acknowledged_discrepancy_ids: ['D-9001-01'] },
    }])
  })

  it('kaynak kitap seçilince kullanım hakkı onayı gerektiğini söyler; araştırma notunu kopyalamaz', async () => {
    stub([])
    const user = userEvent.setup()
    render(<DecisionPanel kind="monument" subjectId="BUR-9001" reviewer={EDITOR} />)
    await user.click(await screen.findByRole('button', { name: 'Eser kimliği: karar ver' }))
    const form = await screen.findByRole('group', { name: /Temel kimlik/ })
    await user.click(within(form).getByRole('checkbox', { name: /S-9001-PDF/ }))
    const hints = within(form).getByRole('list', { name: 'Kimlik onayı için eksikler' })
    expect(hints).toHaveTextContent('Resmî kaynak seçilmedi')
    expect(hints).toHaveTextContent('kaynak-a.pdf')
    expect(within(form).getByLabelText(/Ziyaretçi notu/)).toHaveValue('')
    expect(form).not.toHaveTextContent('ARAŞTIRMA NOTU')
  })

  it('düzeltme veya ret kararında kimlik ayrıntısı gönderilmez', async () => {
    const decisions: { payload: unknown }[] = []
    stub(decisions)
    const user = userEvent.setup()
    render(<DecisionPanel kind="monument" subjectId="BUR-9001" reviewer={EDITOR} />)
    await user.click(await screen.findByRole('button', { name: 'Eser kimliği: karar ver' }))
    const form = await screen.findByRole('group', { name: /Temel kimlik/ })
    await user.click(within(form).getByRole('checkbox', { name: /S-9001-KP/ }))
    await user.type(screen.getByLabelText(/Karar gerekçesi/), 'Adres iddiaları çelişiyor, tekrar bakılacak.')
    await user.click(screen.getByRole('button', { name: 'Kararı kaydet' }))
    expect(decisions.map((d) => d.payload)).toEqual([{}])
  })
})
