import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { DecisionPanel } from './DecisionPanel'
import { getAudit, getImages, getOverview, getResearch, getSessionInfo, reviewerLogin, reviewerLogout } from './reviewClient'
import type { ReviewerInfo } from './types'

/**
 * Kişisel incelemeci girişi. Paylaşılan dahili anahtar yalnızca okuma sağlar; karar kaydı için her kişinin kendi
 * hesabı gerekir. Hesaplar sunucuda `python -m app.internal.reviewers add` ile açılır.
 */
export function ReviewerBar({ onChange }: { onChange: (reviewer: ReviewerInfo | null) => void }) {
  const [version, setVersion] = useState(0)
  const session = useApi(getSessionInfo, `session-info:${version}`)
  const [error, setError] = useState<string | null>(null)
  const credentialRef = useRef<HTMLInputElement>(null)
  const reviewer = session.status === 'success' ? session.data.reviewer : null
  useEffect(() => {
    if (session.status === 'success') onChange(session.data.reviewer)
  }, [session, onChange])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const credential = credentialRef.current?.value ?? ''
    if (credentialRef.current) credentialRef.current.value = ''
    setError(null)
    try {
      await reviewerLogin(String(data.get('reviewer_id')), credential)
      setVersion((n) => n + 1)
    } catch (e) {
      setError((e as ApiError).message)
    }
  }

  async function logout() {
    await reviewerLogout().catch(() => {})
    setVersion((n) => n + 1)
  }

  return (
    <section className="review-block reviewer-bar" aria-labelledby="reviewer-bar-title">
      <h2 id="reviewer-bar-title">İncelemeci kimliği</h2>
      <p className="inventory-muted">
        Paylaşılan erişim anahtarı bir kişinin kimliğini kanıtlamaz; bu oturum yalnızca okuma yapabilir. Karar kaydetmek
        için kişisel incelemeci hesabınızla giriş yapın. Hesap yoksa sunucu yöneticisinden isteyin.
      </p>
      {reviewer ? (
        <p>
          Giriş yapan: <strong>{reviewer.display_name}</strong> ({reviewer.roles.join(', ')}){' '}
          <button type="button" className="button button--secondary" onClick={logout}>
            İncelemeci oturumunu kapat
          </button>
        </p>
      ) : (
        <form className="reviewer-login" onSubmit={login}>
          <label htmlFor="reviewer-id">İncelemeci hesabı</label>
          <input id="reviewer-id" name="reviewer_id" autoComplete="username" required />
          <label htmlFor="reviewer-credential">Kişisel kimlik bilgisi</label>
          <input id="reviewer-credential" ref={credentialRef} type="password" autoComplete="off" required />
          <button type="submit" className="button button--primary">
            İncelemeci olarak giriş yap
          </button>
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  )
}

/** Karar türlerine göre durum sayıları, 6 açık editoryal sorun, RAG yayın durumu ve denetim günlüğü. */
export function ReviewOverviewPanel({ reviewer }: { reviewer: ReviewerInfo | null }) {
  const [version, setVersion] = useState(0)
  const overview = useApi(getOverview, `overview:${version}`)
  if (overview.status === 'loading') return <p role="status">İnceleme özeti yükleniyor…</p>
  if (overview.status === 'error') return <p role="alert">İnceleme özeti yüklenemedi: {overview.error.message}</p>
  const o = overview.data
  return (
    <section className="review-block" aria-labelledby="review-overview-title">
      <h2 id="review-overview-title">Editör inceleme durumu</h2>
      <p className="inventory-muted">
        Veri sürümü <code>{o.data_version.slice(0, 20)}…</code> · {o.subjects.facts} olgu · {o.subjects.drafts_quarantined}{' '}
        karantina adayı · {o.subjects.images} görsel · etkin incelemeci hesabı: {o.reviewers}
      </p>
      <div className="inventory-table-wrap" tabIndex={0} role="region" aria-label="Karar türlerine göre durum">
        <table className="inventory-table">
          <thead>
            <tr>
              <th scope="col">Karar</th>
              <th scope="col">Rol</th>
              <th scope="col">Bekliyor</th>
              <th scope="col">Onaylı</th>
              <th scope="col">Düzeltme</th>
              <th scope="col">Ret</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(o.counts).map(([type, c]) => (
              <tr key={type}>
                <th scope="row">{o.decision_types[type]?.label ?? type}</th>
                <td>{o.decision_types[type]?.role}</td>
                <td>{c.pending}</td>
                <td>{c.approved}</td>
                <td>{c.needs_revision}</td>
                <td>{c.rejected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Açık editoryal sorunlar ({o.issues.length})</h3>
      <ul className="review-issues">
        {o.issues.map((i) => (
          <li key={i.issue_id}>
            <details>
              <summary>
                <code>{i.issue_id}</code> {i.topic} · V20 durumu: {i.status} · karar: {i.resolution.status}
                {i.competing_years.length > 0 && <> · Çelişen yıllar: {i.competing_years.join(', ')}</>}
              </summary>
              <DecisionPanel kind="issue" subjectId={i.issue_id} reviewer={reviewer} onChanged={() => setVersion((n) => n + 1)} />
            </details>
          </li>
        ))}
      </ul>
      <p className="notice notice--warning">
        RAG genel yayını: <strong>kapalı</strong> ({o.rag_public_release.reasons.join(', ')}). Ayrı kalite ve onay aşaması
        gerekir.
      </p>
      <AuditLog key={version} />
    </section>
  )
}

function AuditLog() {
  const audit = useApi(getAudit, 'audit')
  if (audit.status !== 'success') return null
  const { verification, entries } = audit.data
  return (
    <details className="decision-history">
      <summary>
        Denetim günlüğü · zincir {verification.valid ? 'doğrulandı' : 'BOZUK'} · {verification.entries} kayıt
      </summary>
      <ol>
        {entries.map((e) => (
          <li key={e.seq}>
            {e.at} · {e.actor} · {e.action} · {e.subject}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** Kaynak doğrulaması, adres iddiaları, tutarsızlıklar ve koordinat adayları; hepsi doğrulanmamış araştırmadır. */
export function ResearchPanel({ monumentId }: { monumentId: string }) {
  const research = useApi((signal) => getResearch(monumentId, signal), `research:${monumentId}`)
  if (research.status === 'loading') return <p role="status">Araştırma yükleniyor…</p>
  if (research.status === 'error') return <p role="alert">Araştırma yüklenemedi: {research.error.message}</p>
  const r = research.data.research
  if (!r) return <p className="inventory-note">Bu eser için kaynak/konum araştırması yok.</p>
  return (
    <section className="review-block" aria-labelledby="review-research">
      <h3 id="review-research">Kaynak ve konum araştırması</h3>
      <p className="inventory-muted">
        {r.full_name}
        {r.alternative_names.length > 0 && <> · Diğer adlar: {r.alternative_names.join(', ')}</>}
      </p>
      <h4>Adres iddiaları</h4>
      <ul>
        {r.address_claims.map((a) => (
          <li key={a.value}>
            {a.value} <span className="inventory-muted">({a.source_id})</span>
          </li>
        ))}
      </ul>
      <h4>Kaynaklar</h4>
      <ul className="research-sources">
        {r.sources.map((s) => (
          <li key={s.source_id}>
            <code>{s.source_id}</code> {s.publisher} —{' '}
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            ) : (
              <>
                {s.title}, {s.pdf_file} fiziksel s.{s.pdf_physical_page}
              </>
            )}
            <span className="inventory-muted"> · Destekler: {s.supports.join(', ')} · {s.summary}</span>
          </li>
        ))}
      </ul>
      <p className="inventory-muted">{r.vgm_search}</p>
      {r.discrepancies.length > 0 && (
        <>
          <h4>Kaynaklar arası tutarsızlıklar</h4>
          <ul>
            {r.discrepancies.map((d) => (
              <li key={d.discrepancy_id}>
                <code>{d.discrepancy_id}</code> <strong>{d.topic}:</strong> {d.description}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Koordinat adayları (WGS84, doğrulanmamış)</h4>
      {r.location_candidates.length === 0 ? (
        <p>Aday yok.</p>
      ) : (
        <ul>
          {r.location_candidates.map((c) => (
            <li key={c.candidate_id}>
              <code>{c.candidate_id}</code> {c.latitude}, {c.longitude} · {c.represents} · ±{c.estimated_accuracy_m} m ·{' '}
              {c.source_object} · {c.status}
              {c.notes && <span className="inventory-muted"> · {c.notes}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="inventory-muted">
        Erişim ve saygı notu: {r.site_context.access_notes} {research.data.attribution}
      </p>
    </section>
  )
}

/** Görsel envanteri: dosyalar gösterilmez; hak/lisans kararı her görsel için ayrı verilir. */
export function ImagesPanel({ monumentId, reviewer }: { monumentId: string; reviewer: ReviewerInfo | null }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="review-block" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Görseller — hak sahibi, lisans ve eser eşleşmesi her görsel için ayrı karar</summary>
      {open && <ImageList monumentId={monumentId} reviewer={reviewer} />}
    </details>
  )
}

function ImageList({ monumentId, reviewer }: { monumentId: string; reviewer: ReviewerInfo | null }) {
  const images = useApi((signal) => getImages(monumentId, signal), `images:${monumentId}`)
  if (images.status === 'loading') return <p role="status">Görseller yükleniyor…</p>
  if (images.status === 'error') return <p role="alert">Görseller yüklenemedi: {images.error.message}</p>
  return (
    <ul className="review-drafts">
      {images.data.map((img) => (
        <li key={img.image_id}>
          <details>
            <summary>
              <code>{img.relative_path}</code> · lisans: {img.license_status} · eşleşme: {img.monument_link_status}
            </summary>
            <DecisionPanel kind="image" subjectId={img.image_id} reviewer={reviewer} />
          </details>
        </li>
      ))}
    </ul>
  )
}
