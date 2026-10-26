import { useEffect, useState, type FormEvent } from 'react'
import type { ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { EMPTY_IDENTITY, IdentityDecisionFields, type IdentityPayload, type IdentitySubject } from './IdentityDecisionFields'
import { getSubject, openTicket, submitDecision } from './reviewClient'
import type { DecisionState, ReviewerInfo, ReviewTicket, SubjectKind } from './types'

const DECISION_LABELS: Record<string, string> = {
  pending: 'Karar bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  needs_revision: 'Düzeltme gerekli',
}

const SOURCE_CHECKS: [string, string][] = [
  ['not_checked', 'Kaynak kontrol edilmedi'],
  ['verified_on_page', 'Kaynak sayfasında doğrulandı'],
  ['verified_with_discrepancy', 'Doğrulandı, tutarsızlık not edildi'],
  ['not_supported', 'Kaynak ifadeyi desteklemiyor'],
  ['not_applicable', 'Uygulanamaz'],
]

/**
 * Onay için gereken ayrıntıların boş şablonları. Değerler bilerek boş/`false` bırakılır: hiçbir izin önceden doldurulmaz.
 * Ayrıntılar yalnızca "Onayla" seçildiğinde gönderilir.
 */
const PAYLOAD_TEMPLATES: Record<string, Record<string, unknown>> = {
  issue_resolution: { resolution: '', chosen_value: null },
  source_usage_rights: { rights_holder: '', permission_reference: '', permitted_uses: [] },
  image_rights: {
    rights_holder: '',
    license: '',
    attribution: null,
    permission_reference: null,
    monument_match: '',
    source_url: null,
  },
  location_verification: {
    candidate_id: '',
    method: '',
    verification_reference: '',
    accuracy_m: null,
    acknowledged_discrepancy_ids: [],
  },
  gps_checkin: {
    latitude: null,
    longitude: null,
    radius_m: null,
    point_accuracy_m: null,
    point_kind: '',
    public_access_confirmed: false,
    outside_worship_and_burial_areas: false,
    access_hours_note: '',
    safety_note: '',
  },
}

function DecisionForm({
  kind,
  subjectId,
  decisionType,
  content,
  onDone,
  onCancel,
}: {
  kind: SubjectKind
  subjectId: string
  decisionType: string
  content: Record<string, unknown>
  onDone: () => void
  onCancel: () => void
}) {
  const [ticket, setTicket] = useState<ReviewTicket | null>(null)
  // Bilet tek kullanımlıktır; her başarısız gönderimden sonra yeni bilet istenir (form içeriği korunur).
  const [ticketRound, setTicketRound] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [decision, setDecision] = useState<'approved' | 'rejected' | 'needs_revision'>('needs_revision')
  const [waitLeft, setWaitLeft] = useState(0)
  const template = PAYLOAD_TEMPLATES[decisionType]
  // Temel kimlik kararı serbest JSON yerine yapılandırılmış alanlarla girilir.
  const identity = decisionType === 'catalog_identity'
  const [identityPayload, setIdentityPayload] = useState<IdentityPayload>(EMPTY_IDENTITY)
  const formId = `decision-${kind}-${subjectId}-${decisionType}`.replace(/[^\w-]/g, '_')

  useEffect(() => {
    let cancelled = false
    openTicket(kind, subjectId, decisionType).then(
      (t) => !cancelled && setTicket(t),
      (e: ApiError) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [kind, subjectId, decisionType, ticketRound])

  // Sunucudaki asgari inceleme süresi dolmadan onay gönderilmez; erken gönderim bileti boşa harcamasın diye geri sayım
  // gösterilir. Süreyi sunucu da ayrıca denetler.
  useEffect(() => {
    if (!ticket) return
    const until = Date.now() + ticket.min_review_seconds * 1000
    const tick = () => setWaitLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [ticket])
  const approvalLocked = decision === 'approved' && waitLeft > 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ticket) return
    if (approvalLocked) return
    const data = new FormData(event.currentTarget)
    let payload: Record<string, unknown> = {}
    if (decision === 'approved' && identity) {
      payload = { ...identityPayload }
    } else if (decision === 'approved' && template) {
      try {
        payload = JSON.parse(String(data.get('payload') || '{}'))
      } catch {
        setError('Ek ayrıntılar geçerli JSON değil.')
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      await submitDecision({
        ticket_id: ticket.ticket_id,
        decision,
        source_check: String(data.get('source_check')),
        rationale: String(data.get('rationale') ?? ''),
        payload,
      })
      onDone()
    } catch (e) {
      // Bilet sunucuda tüketildi; aynı biletle yeniden gönderilmez. Yeni bilet istenir, yazılanlar korunur.
      setError(`${(e as ApiError).message} Yeni inceleme bileti açıldı; düzeltip yeniden gönderebilirsiniz.`)
      setTicket(null)
      setBusy(false)
      setTicketRound((n) => n + 1)
    }
  }

  return (
    <form className="decision-form" onSubmit={submit} aria-labelledby={`${formId}-title`}>
      <p id={`${formId}-title`} className="decision-form__title">
        Karar kaydı · <code>{subjectId}</code>
      </p>
      {!ticket && !error && <p role="status">İnceleme bileti açılıyor…</p>}
      {ticket && (
        <p className="inventory-muted">
          Kaydı ve kaynağını okuyun; onay en erken {ticket.min_review_seconds} sn sonra kabul edilir. Bilet tek
          kullanımlıktır ve yalnızca bu kayıt içindir.
          {ticket.unmet_prerequisites.length > 0 && <> Eksik ön koşullar: {ticket.unmet_prerequisites.join(', ')}.</>}
        </p>
      )}
      <label htmlFor={`${formId}-decision`}>Editör kararı</label>
      <select
        id={`${formId}-decision`}
        name="decision"
        value={decision}
        onChange={(e) => setDecision(e.target.value as typeof decision)}
        required
      >
        <option value="approved">Onayla</option>
        <option value="needs_revision">Düzeltme gerekli</option>
        <option value="rejected">Reddet</option>
      </select>
      <label htmlFor={`${formId}-source`}>Kaynak kontrolü</label>
      <select id={`${formId}-source`} name="source_check" defaultValue="not_checked" required>
        {SOURCE_CHECKS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor={`${formId}-rationale`}>Karar gerekçesi (en az 15 karakter)</label>
      <textarea id={`${formId}-rationale`} name="rationale" rows={3} minLength={15} required />
      {identity && (
        <IdentityDecisionFields
          formId={formId}
          subject={content as unknown as IdentitySubject}
          value={identityPayload}
          onChange={setIdentityPayload}
        />
      )}
      {template && (
        <>
          <label htmlFor={`${formId}-payload`}>Onay ayrıntıları (JSON; yalnızca onayda gönderilir)</label>
          <textarea
            id={`${formId}-payload`}
            name="payload"
            rows={6}
            className="decision-form__payload"
            defaultValue={JSON.stringify(template, null, 2)}
            spellCheck={false}
          />
        </>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <div className="decision-form__actions">
        <button type="submit" className="button button--primary" disabled={!ticket || busy || approvalLocked}>
          {busy ? 'Kaydediliyor…' : 'Kararı kaydet'}
        </button>
        {ticket && approvalLocked && (
          <span className="inventory-muted" role="status">
            Onay {waitLeft} sn sonra gönderilebilir.
          </span>
        )}
        <button type="button" className="button button--secondary" onClick={onCancel}>
          Vazgeç
        </button>
      </div>
    </form>
  )
}

function DecisionRow({
  state,
  canDecide,
  onDecide,
}: {
  state: DecisionState
  canDecide: boolean
  onDecide: () => void
}) {
  const d = state.decision
  return (
    <li className="decision-row">
      <div className="decision-row__head">
        <span>{state.label}</span>
        <span className={`inventory-pill inventory-pill--${state.status === 'approved' ? 'verified' : 'blocked'}`}>
          {DECISION_LABELS[state.status]}
          {state.stale && ' · eski sürüm'}
        </span>
      </div>
      {d && (
        <p className="inventory-muted">
          {d.reviewer_name} ({d.reviewer_role}) · {d.reviewed_at} · {d.decision_id} · {d.source_check}
          <br />
          {d.rationale}
        </p>
      )}
      {state.unmet_prerequisites.length > 0 && (
        <p className="inventory-muted">Onay için önce: {state.unmet_prerequisites.join(', ')}</p>
      )}
      {canDecide ? (
        <button type="button" className="button button--secondary" onClick={onDecide} aria-label={`${state.label}: karar ver`}>
          Karar ver
        </button>
      ) : (
        <p className="inventory-muted">Karar için “{state.role}” rolündeki kişisel hesap gerekir.</p>
      )}
    </li>
  )
}

/** Bir kaydın ayrı ayrı yayın kararları, geçmişi ve (yetkili incelemeci için) tek kayıtlık karar formu. */
export function DecisionPanel({
  kind,
  subjectId,
  reviewer,
  onChanged,
}: {
  kind: SubjectKind
  subjectId: string
  reviewer: ReviewerInfo | null
  onChanged?: () => void
}) {
  const [version, setVersion] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const subject = useApi((signal) => getSubject(kind, subjectId, signal), `subject:${kind}:${subjectId}:${version}`)

  if (subject.status === 'loading') return <p role="status">Karar durumu yükleniyor…</p>
  if (subject.status === 'error') return <p role="alert">Karar durumu yüklenemedi: {subject.error.message}</p>
  const { decisions, history } = subject.data
  return (
    <div className="decision-panel">
      <ul className="decision-rows" aria-label={`${subjectId} kararları`}>
        {Object.entries(decisions).map(([type, state]) => (
          <DecisionRow
            key={type}
            state={state}
            canDecide={!!reviewer?.roles.includes(state.role)}
            onDecide={() => setActive(type)}
          />
        ))}
      </ul>
      {active && (
        <DecisionForm
          key={active}
          kind={kind}
          subjectId={subjectId}
          decisionType={active}
          content={subject.data.content}
          onCancel={() => setActive(null)}
          onDone={() => {
            setActive(null)
            setVersion((n) => n + 1)
            onChanged?.()
          }}
        />
      )}
      {history.length > 0 && (
        <details className="decision-history">
          <summary>Karar geçmişi ({history.length})</summary>
          <ol>
            {history.map((h) => (
              <li key={h.decision_id}>
                {h.reviewed_at} · {h.decision_type} · {DECISION_LABELS[h.decision]} · {h.reviewer_name} — {h.rationale}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
