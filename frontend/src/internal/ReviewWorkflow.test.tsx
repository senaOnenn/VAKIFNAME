import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { DecisionPanel } from './DecisionPanel'
import { ReviewerBar, ReviewOverviewPanel } from './ReviewWorkflow'
import type { DecisionState, ReviewerInfo, ReviewOverview, ReviewSubject } from './types'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Kurgusal kayıtlar; BUR-9xxx kimlikleri gerçek V20 eserleri değildir.
const pending = (label: string, role = 'editor', unmet: string[] = []): DecisionState => ({
  status: 'pending',
  stale: false,
  decision: null,
  label,
  role,
  unmet_prerequisites: unmet,
})

const SUBJECT: ReviewSubject = {
  subject_kind: 'fact',
  subject_id: 'BUR-9001-F001',
  content: {},
  subject_sha256: 'a'.repeat(64),
  decisions: {
    fact_editorial: pending('Olgunun editör onayı'),
    fact_publication: pending('Olgunun yayımlanması', 'editor', ['fact_editorial', 'source_usage_rights']),
    fact_game_use: pending('Olgunun oyunda kullanılması', 'editor', ['fact_publication']),
  },
  history: [],
}
const EDITOR: ReviewerInfo = { reviewer_id: 'editor.a', display_name: 'Editör A', roles: ['editor'] }
const SUBJECT_PATH = '/internal/review/subjects/fact/BUR-9001-F001'

describe('karar paneli', () => {
  it('kişisel hesap yoksa her kararı bekliyor gösterir ve karar düğmesi vermez', async () => {
    stubFetch({ [SUBJECT_PATH]: { body: SUBJECT } })
    render(<DecisionPanel kind="fact" subjectId="BUR-9001-F001" reviewer={null} />)
    const rows = await screen.findByRole('list', { name: 'BUR-9001-F001 kararları' })
    expect(within(rows).getAllByText('Karar bekliyor')).toHaveLength(3)
    expect(within(rows).queryByRole('button', { name: /karar ver/ })).not.toBeInTheDocument()
    expect(rows).toHaveTextContent('Onay için önce: fact_editorial, source_usage_rights')
    expect(within(rows).getAllByText(/rolündeki kişisel hesap gerekir/)).toHaveLength(3)
  })

  it('tek kayıt için bilet açar; ayrıntıları yalnızca onayda gönderir', async () => {
    const decisions: unknown[] = []
    const tickets: unknown[] = []
    stubFetch({
      [SUBJECT_PATH]: { body: SUBJECT },
      '/internal/review/tickets': (init) => {
        tickets.push(JSON.parse(String(init?.body)))
        return { body: { ticket_id: 't-1', decision_type: 'fact_editorial', subject_sha256: 'a'.repeat(64),
                         supersedes: null, min_review_seconds: 5, unmet_prerequisites: [] } }
      },
      '/internal/review/decisions': (init) => {
        decisions.push(JSON.parse(String(init?.body)))
        return { status: 201, body: {} }
      },
    })
    render(<DecisionPanel kind="fact" subjectId="BUR-9001-F001" reviewer={EDITOR} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Olgunun editör onayı: karar ver' }))
    expect(tickets).toEqual([{ subject_kind: 'fact', subject_id: 'BUR-9001-F001', decision_type: 'fact_editorial' }])
    expect(await screen.findByText(/onay en erken 5 sn sonra kabul edilir/)).toBeInTheDocument()
    // Varsayılan karar onay değildir.
    expect(screen.getByLabelText('Editör kararı')).toHaveValue('needs_revision')
    expect(screen.getByLabelText('Kaynak kontrolü')).toHaveValue('not_checked')
    await userEvent.type(screen.getByLabelText(/Karar gerekçesi/), 'Kaynak sayfası yeniden okunmalı.')
    await userEvent.click(screen.getByRole('button', { name: 'Kararı kaydet' }))
    expect(decisions).toEqual([{ ticket_id: 't-1', decision: 'needs_revision', source_check: 'not_checked',
                                 rationale: 'Kaynak sayfası yeniden okunmalı.', payload: {} }])
  })

  it('sunucu kural ihlalini gösterir, aynı biletle yeniden göndermez ve yazılanları koruyarak yeni bilet açar', async () => {
    const decisions: { ticket_id: string }[] = []
    let n = 0
    stubFetch({
      [SUBJECT_PATH]: { body: SUBJECT },
      '/internal/review/tickets': () => {
        n += 1
        return { body: { ticket_id: `t-${n}`, decision_type: 'fact_editorial', subject_sha256: 'x',
                         supersedes: null, min_review_seconds: 0, unmet_prerequisites: [] } }
      },
      '/internal/review/decisions': (init) => {
        decisions.push(JSON.parse(String(init?.body)))
        return { status: 409, body: { detail: { code: 'prerequisites_unmet',
                                                message: 'Onay ön koşulları karşılanmadı: issue_unresolved:X' } } }
      },
    })
    render(<DecisionPanel kind="fact" subjectId="BUR-9001-F001" reviewer={EDITOR} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Olgunun editör onayı: karar ver' }))
    await screen.findByText(/onay en erken/)
    await userEvent.selectOptions(screen.getByLabelText('Editör kararı'), 'approved')
    await userEvent.type(screen.getByLabelText(/Karar gerekçesi/), 'Kaynakla birebir uyumlu ifade.')
    await userEvent.click(screen.getByRole('button', { name: 'Kararı kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('issue_unresolved:X')
    expect(screen.getByRole('alert')).toHaveTextContent('Yeni inceleme bileti açıldı')
    expect(screen.getByLabelText(/Karar gerekçesi/)).toHaveValue('Kaynakla birebir uyumlu ifade.')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Kararı kaydet' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Kararı kaydet' }))
    await vi.waitFor(() => expect(decisions).toHaveLength(2))
    expect(decisions.map((d) => d.ticket_id)).toEqual(['t-1', 't-2'])
  })

  it('asgari inceleme süresi dolmadan onay gönderilemez; diğer kararlar bekletilmez', async () => {
    stubFetch({
      [SUBJECT_PATH]: { body: SUBJECT },
      '/internal/review/tickets': { body: { ticket_id: 't-1', decision_type: 'fact_editorial', subject_sha256: 'x',
                                           supersedes: null, min_review_seconds: 30, unmet_prerequisites: [] } },
    })
    render(<DecisionPanel kind="fact" subjectId="BUR-9001-F001" reviewer={EDITOR} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Olgunun editör onayı: karar ver' }))
    await screen.findByText(/onay en erken 30 sn/)
    expect(screen.getByRole('button', { name: 'Kararı kaydet' })).toBeEnabled()
    await userEvent.selectOptions(screen.getByLabelText('Editör kararı'), 'approved')
    expect(screen.getByRole('button', { name: 'Kararı kaydet' })).toBeDisabled()
    expect(screen.getByText(/Onay \d+ sn sonra gönderilebilir/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Editör kararı'), 'rejected')
    expect(screen.getByRole('button', { name: 'Kararı kaydet' })).toBeEnabled()
  })
})

const OVERVIEW: ReviewOverview = {
  data_version: 'V20:' + 'b'.repeat(64),
  decision_types: { fact_editorial: { label: 'Olgunun editör onayı', role: 'editor', subject_kind: 'fact' } },
  counts: { fact_editorial: { pending: 3, approved: 0, rejected: 0, needs_revision: 0, stale: 0 } },
  subjects: { facts: 3, drafts_quarantined: 2, issues: 1, images: 1, sources: 1 },
  issues: [{ issue_id: 'TEST-ISSUE-1', topic: 'Kurgusal tarih çelişkisi', status: 'unresolved', related_fact_ids: [],
             competing_years: [1700, 1705], chosen_value: null, resolution: { status: 'pending', stale: false } }],
  reviewers: 0,
  identity_policy: 'Paylaşılan anahtar kimlik kanıtlamaz.',
  rag_public_release: { status: 'blocked', reasons: ['faiss_embedding_index_mismatch'] },
}

describe('inceleme özeti ve kimlik', () => {
  it('açık sorunları, karar sayılarını ve kapalı RAG yayınını gösterir', async () => {
    stubFetch({ '/internal/review/overview': { body: OVERVIEW } })
    render(<ReviewOverviewPanel reviewer={null} />)
    expect(await screen.findByText(/Kurgusal tarih çelişkisi/)).toHaveTextContent('Çelişen yıllar: 1700, 1705')
    expect(screen.getByRole('row', { name: /Olgunun editör onayı/ })).toHaveTextContent('3')
    expect(screen.getByText(/RAG genel yayını/)).toHaveTextContent('kapalı')
  })

  it('paylaşılan anahtarın kimlik kanıtlamadığını söyler; kimlik bilgisini alan dışında tutmaz', async () => {
    const bodies: unknown[] = []
    stubFetch({
      '/internal/session': { body: { authenticated: true, session_ttl_s: 60, reviewer: null } },
      '/internal/session/reviewer': (init) => {
        bodies.push(JSON.parse(String(init?.body)))
        return { status: 401, body: { detail: 'İncelemeci kimliği veya kimlik bilgisi geçersiz.' } }
      },
    })
    render(<ReviewerBar onChange={() => {}} />)
    expect(await screen.findByText(/bir kişinin kimliğini kanıtlamaz/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('İncelemeci hesabı'), 'editor.a')
    await userEvent.type(screen.getByLabelText('Kişisel kimlik bilgisi'), 'gizli-bilgi')
    await userEvent.click(screen.getByRole('button', { name: 'İncelemeci olarak giriş yap' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('geçersiz')
    expect(bodies).toEqual([{ reviewer_id: 'editor.a', credential: 'gizli-bilgi' }])
    expect(screen.getByLabelText('Kişisel kimlik bilgisi')).toHaveValue('')
  })
})
