import { forwardRef, useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { DecisionPanel } from './DecisionPanel'
import { blockerLabel, statusLabel } from './labels'
import { getDrafts, getMonument } from './reviewClient'
import { ImagesPanel, ResearchPanel } from './ReviewWorkflow'
import type { HistoricalFact, LocationRecord, MonumentDetail, PublicationGates, ReviewerInfo } from './types'

function LocationPanel({ location }: { location: LocationRecord }) {
  const rows: [string, string | number | null][] = [
    ['Durum', statusLabel(location.status)],
    ['Enlem / boylam', location.latitude === null ? null : `${location.latitude}, ${location.longitude}`],
    ['Koordinat kaynağı', location.source],
    ['Kaynak belgesi', location.source_reference],
    ['Doğruluk (m)', location.accuracy_m],
    ['Doğrulayan', location.verified_by],
    ['Doğrulama tarihi', location.verified_at],
  ]
  return (
    <section className="review-block" aria-labelledby="review-location">
      <h3 id="review-location">Konum</h3>
      {location.status !== 'verified' && (
        <p className="inventory-note">
          Doğrulanmış koordinat yok. Eser haritada işaretlenmez ve konum tabanlı check-in kapalıdır. Koordinat tahmin
          edilmez.
        </p>
      )}
      <dl className="review-fields">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function FactItem({ fact, reviewer }: { fact: HistoricalFact; reviewer: ReviewerInfo | null }) {
  const { source } = fact
  return (
    <li className="review-fact">
      <div className="review-fact__head">
        <code>{fact.fact_id}</code>
        <span className="inventory-pill inventory-pill--blocked">
          {fact.publicly_usable ? 'Yayına uygun' : 'Yayına kapalı'}
        </span>
      </div>
      <p className="review-fact__title">{fact.title}</p>
      <p>{fact.text}</p>
      <dl className="review-fields review-fields--compact">
        <div>
          <dt>Editör</dt>
          <dd>{statusLabel(fact.review_status)}</dd>
        </div>
        <div>
          <dt>Lisans</dt>
          <dd>{statusLabel(fact.access.license_review_status)}</dd>
        </div>
        <div>
          <dt>Kesinlik</dt>
          <dd>{fact.certainty}</dd>
        </div>
      </dl>
      <figure className="review-source">
        <blockquote>{source.evidence_quote}</blockquote>
        <figcaption>
          <span>{source.source_file}</span>
          <span>
            Fiziksel PDF sayfası {source.pdf_physical_page} / {source.pdf_physical_page_count}
          </span>
          <span>Sayfa kimliği {source.source_page_id}</span>
          <span>Denetim: {statusLabel(source.page_audit)}</span>
        </figcaption>
      </figure>
      {fact.open_issue_ids.length > 0 && (
        <p className="inventory-muted">Açık sorunlar: {fact.open_issue_ids.join(', ')}</p>
      )}
      <details className="review-fact__decisions">
        <summary>Editör, yayın ve oyun kararları</summary>
        <DecisionPanel kind="fact" subjectId={fact.fact_id} reviewer={reviewer} />
      </details>
    </li>
  )
}

function QuarantinedDrafts({ monumentId, count, reviewer }: { monumentId: string; count: number; reviewer: ReviewerInfo | null }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="review-block review-quarantine" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Karantinadaki aday kayıtlar ({count}) — onaysız; RAG'de ve yayında kullanılmaz
      </summary>
      {open && <DraftList monumentId={monumentId} reviewer={reviewer} />}
    </details>
  )
}

function DraftList({ monumentId, reviewer }: { monumentId: string; reviewer: ReviewerInfo | null }) {
  const drafts = useApi((signal) => getDrafts(monumentId, signal), `drafts:${monumentId}`)
  if (drafts.status === 'loading') return <p>Aday kayıtlar yükleniyor…</p>
  if (drafts.status === 'error') return <p role="alert">Aday kayıtlar yüklenemedi: {drafts.error.message}</p>
  return (
    <ul className="review-drafts">
      {drafts.data.map((d) => (
        <li key={d.draft_id}>
          <code>{d.draft_id}</code> <span className="inventory-pill inventory-pill--blocked">Karantina</span>
          <p>{d.statement}</p>
          <p className="inventory-muted">
            {d.source_file} · Fiziksel PDF sayfası {d.pdf_physical_page} · Denetim: {statusLabel(d.page_audit)}
          </p>
          <details>
            <summary>Triyaj kararı (onay yalnızca sonraki veri sürümüne öneridir; yayına etkisi yok)</summary>
            <DecisionPanel kind="draft" subjectId={d.draft_id} reviewer={reviewer} />
          </details>
        </li>
      ))}
    </ul>
  )
}

const GATE_ROWS: [keyof PublicationGates, string][] = [
  ['catalog_identity', 'Eser kimliği ve katalog meta verisi yayında'],
  ['map_display', 'Konum haritada gösterilebilir'],
  ['gps_checkin', 'GPS check-in açık'],
]

function GatesPanel({ gates }: { gates: PublicationGates }) {
  return (
    <section className="review-block" aria-labelledby="review-gates">
      <h3 id="review-gates">Yayın kapıları (ayrı kararlar)</h3>
      <ul className="inventory-blockers">
        {GATE_ROWS.map(([key, label]) => (
          <li key={key}>
            {label}: <strong>{gates[key] ? 'evet' : 'hayır'}</strong>
          </li>
        ))}
        <li>
          Olgular: {gates.facts_editor_approved}/{gates.facts_total} editör onaylı · {gates.facts_published.length} yayında ·{' '}
          {gates.facts_game_use.length} oyunda
        </li>
        <li>
          Görseller: {gates.images_rights_recorded}/{gates.images_total} hak kaydı · {gates.images_published.length} yayında ·{' '}
          {gates.images_game_use.length} oyunda
        </li>
      </ul>
    </section>
  )
}

function DetailBody({ m, reviewer }: { m: MonumentDetail; reviewer: ReviewerInfo | null }) {
  return (
    <>
      <p className="inventory-muted">
        <code>{m.monument_id}</code> · {m.type} · {m.district}, {m.city}
      </p>
      <section className="review-block" aria-labelledby="review-blockers">
        <h3 id="review-blockers">Yayın öncesi gereken onaylar</h3>
        <ul className="inventory-blockers">
          {m.review.public_release_blockers.map((b) => (
            <li key={b}>{blockerLabel(b)}</li>
          ))}
        </ul>
        <p className="inventory-muted">
          Kayıt: {statusLabel(m.review_status)} · {statusLabel(m.publication_status)} ·{' '}
          {statusLabel(m.license_review_status)}. Görseller: {m.image_count} (lisans ve eser eşleşmesi onay bekliyor,
          arayüzde gösterilmez).
        </p>
      </section>
      {m.review.gates && <GatesPanel gates={m.review.gates} />}
      <section className="review-block" aria-labelledby="review-identity">
        <h3 id="review-identity">Eser kimliği kararı</h3>
        <DecisionPanel kind="monument" subjectId={m.monument_id} reviewer={reviewer} />
      </section>
      <ResearchPanel monumentId={m.monument_id} />
      <LocationPanel location={m.location} />
      <section className="review-block" aria-labelledby="review-location-decisions">
        <h3 id="review-location-decisions">Konum, harita ve check-in kararları</h3>
        <p className="inventory-muted">
          Harita gösterimi ve GPS check-in ayrı kararlardır. Check-in için herkese açık, ibadet ve kabir alanı dışında
          bir giriş noktası ile yarıçap ayrıca onaylanmalıdır.
        </p>
        <DecisionPanel kind="location" subjectId={m.monument_id} reviewer={reviewer} />
      </section>
      <section className="review-block" aria-labelledby="review-source-rights">
        <h3 id="review-source-rights">Kaynak metin kullanım hakkı</h3>
        {(m.source_files ?? []).map((file) => (
          <details key={file}>
            <summary>{file}</summary>
            <DecisionPanel kind="source" subjectId={file} reviewer={reviewer} />
          </details>
        ))}
      </section>
      <ImagesPanel monumentId={m.monument_id} reviewer={reviewer} />
      {m.open_issues.length > 0 && (
        <section className="review-block" aria-labelledby="review-issues">
          <h3 id="review-issues">Açık editoryal sorunlar</h3>
          <ul className="review-issues">
            {m.open_issues.map((i) => (
              <li key={i.issue_id}>
                <code>{i.issue_id}</code> {i.topic} ({i.status})
                {i.competing_years.length > 0 && <> · Çelişen yıllar: {i.competing_years.join(', ')}</>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="review-block" aria-labelledby="review-facts">
        <h3 id="review-facts">Tarihî olgular ve kaynak sayfaları ({m.facts.length})</h3>
        <ol className="review-facts">
          {m.facts.map((f) => (
            <FactItem key={f.fact_id} fact={f} reviewer={reviewer} />
          ))}
        </ol>
      </section>
      {m.quarantined_draft_count > 0 && (
        <QuarantinedDrafts monumentId={m.monument_id} count={m.quarantined_draft_count} reviewer={reviewer} />
      )}
    </>
  )
}

interface Props {
  monumentId: string
  reviewer: ReviewerInfo | null
  onClose: () => void
  onUnauthorized: () => void
}

export const MonumentReview = forwardRef<HTMLElement, Props>(function MonumentReview(
  { monumentId, reviewer, onClose, onUnauthorized },
  ref,
) {
  const detail = useApi((signal) => getMonument(monumentId, signal), `monument:${monumentId}`)
  const unauthorized = detail.status === 'error' && detail.error.status === 401
  useEffect(() => {
    if (unauthorized) onUnauthorized()
  }, [unauthorized, onUnauthorized])
  const title = detail.status === 'success' ? detail.data.name : monumentId
  return (
    <article ref={ref} tabIndex={-1} className="review-panel" aria-labelledby="review-title">
      <header className="review-panel__head">
        <h2 id="review-title">{title}</h2>
        <button type="button" className="button button--secondary" onClick={onClose}>
          Kapat
        </button>
      </header>
      {detail.status === 'loading' && <p>Eser kaydı yükleniyor…</p>}
      {detail.status === 'error' && <p role="alert">Eser kaydı yüklenemedi: {detail.error.message}</p>}
      {detail.status === 'success' && <DetailBody m={detail.data} reviewer={reviewer} />}
    </article>
  )
})
