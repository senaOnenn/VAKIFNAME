import { useEffect, useMemo, useState } from 'react'
import type { ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import './batch-review.css'
import { getBatch, getReviewMedia, openBatchTicket, submitBatch } from './reviewClient'
import type { BatchDecision, BatchItem, BatchResult, BatchRevision, BatchTicket, ImageFacts, ReviewerInfo } from './types'

/**
 * Toplu inceleme: yetkili incelemeci önerili kayıtları tek ekranda inceler ve her biri için **ayrı** bir karar verir.
 *
 * - Hiçbir satır önceden seçili değildir. "Önerilenleri seç" düğmesi yalnızca incelemecinin açık eylemiyle seçer.
 * - Öneriler (yayın metni, soru, lisans, kimlik alanları) formu doldurur; incelemeci düzenleyebilir, sunucu yeniden denetler.
 * - Kararlar sunucuda bağımlılık sırasıyla ve her biri ayrı denetim kaydıyla yazılır. Ret ve düzeltmede ayrıntı gönderilmez.
 * - GPS check-in ve kaynak kitap kullanım hakkı bu ekrana alınmaz.
 */

const DECISIONS: [BatchDecision, string][] = [
  ['approved', 'Onayla'],
  ['needs_revision', 'Düzeltme gerekli'],
  ['rejected', 'Reddet'],
]
const SOURCE_CHECKS: [string, string][] = [
  ['verified_on_page', 'Kaynak sayfasında doğrulandı'],
  ['verified_with_discrepancy', 'Doğrulandı, tutarsızlık not edildi'],
  ['not_supported', 'Kaynak desteklemiyor'],
  ['not_checked', 'Kontrol edilmedi'],
]
const LICENSES = ['CC0-1.0', 'public_domain', 'CC-BY-2.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-2.0', 'CC-BY-SA-2.5', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0']
const ANGLES: [string, string][] = [
  ['genel_gorunum', 'Genel görünüm'],
  ['dis_cephe', 'Dış cephe'],
  ['ic_mekan', 'İç mekân'],
  ['kubbe_minare', 'Kubbe / minare'],
  ['kapi_kitabe', 'Kapı / kitabe'],
  ['mimari_ayrinti', 'Mimari ayrıntı'],
]
const PEOPLE: [string, string][] = [
  ['none', 'İnsan yok'],
  ['incidental', 'Uzak / küçük insan'],
  ['prominent', 'Belirgin insan'],
]
const VISIBLE_TEXT: [string, string][] = [
  ['none', 'Yazı / tabela yok'],
  ['incidental', 'Küçük, okunmaz yazı veya dükkân tabelası'],
  ['readable_name', 'Eser adı okunuyor'],
]
const LEVEL_PEOPLE = ['İnsan yok', 'Uzak / küçük insan', 'Belirgin insan']
const LEVEL_TEXT = ['Yazı / tabela yok', 'Küçük / okunmaz yazı', 'Eser adı okunuyor']
const STATUS: Record<string, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylı',
  rejected: 'Reddedildi',
  needs_revision: 'Düzeltme gerekli',
}
const VERDICT: Record<string, string> = {
  corroborated: 'Bağımsız kaynakla doğrulandı',
  corroborated_with_discrepancy: 'Doğrulandı · tutarsızlık var',
  partially_corroborated: 'Kısmen doğrulandı',
  source_book_only: 'Yalnızca kaynak kitapta',
  conflicting: 'Resmî kaynakla çelişiyor',
}

interface Draft {
  decision: BatchDecision
  source_check: string
  note: string
  payload: Record<string, unknown>
}

const draftFor = (item: BatchItem): Draft => ({
  decision: item.default_decision ?? (item.recommended ? 'approved' : 'needs_revision'),
  source_check: item.source_check,
  note: '',
  payload: structuredClone(item.payload),
})

/** Satır şu anda seçilebilir mi? Rolü yoksa, zaten onaylıysa veya bu gönderimde çözülemeyecek bir engel varsa hayır. */
export function selectable(item: BatchItem, selected: Set<string>): boolean {
  if (!item.allowed || item.done) return false
  return item.blockers.every((b) => b.resolved_in_batch) && item.depends_on.every((k) => selected.has(k))
}

/** Seçimden çıkarılan kayda bağlı satırları da (zincirleme) seçimden çıkarır. */
export function withoutDependents(selected: Set<string>, removed: string, items: BatchItem[]): Set<string> {
  const next = new Set(selected)
  const queue = [removed]
  while (queue.length) {
    const k = queue.pop()!
    next.delete(k)
    for (const i of items) if (next.has(i.key) && i.depends_on.includes(k)) queue.push(i.key)
  }
  return next
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="batch-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function PayloadFields({ item, draft, onChange }: { item: BatchItem; draft: Draft; onChange: (p: Record<string, unknown>) => void }) {
  const p = draft.payload
  const set = (k: string, v: unknown) => onChange({ ...p, [k]: v })
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')
  if (draft.decision !== 'approved') {
    return <p className="inventory-muted">Ret ve düzeltme kararında ek ayrıntı gönderilmez; yalnızca gerekçe yazılır.</p>
  }
  switch (item.decision_type) {
    case 'fact_publication':
      return (
        <>
          <Field label="Yayın başlığı">
            <input value={str('title')} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Yayın metni (özgün; kaynak kitabın cümlesini kopyalamaz)">
            <textarea rows={3} value={str('public_text')} onChange={(e) => set('public_text', e.target.value)} />
          </Field>
          <p className="inventory-muted">
            Dayanak: bağımsız kaynak · Kaynaklar: {((p.corroboration_source_ids as string[]) ?? []).join(', ')}
          </p>
        </>
      )
    case 'fact_game_use': {
      const choices = (p.choices as string[]) ?? []
      return (
        <>
          <Field label="Soru">
            <input value={str('question')} onChange={(e) => set('question', e.target.value)} />
          </Field>
          <div className="batch-choices">
            {choices.map((c, i) => (
              <label key={i} className="batch-choice">
                <input
                  type="radio"
                  name={`${item.key}-answer`}
                  checked={p.answer_index === i}
                  onChange={() => set('answer_index', i)}
                  aria-label={`Doğru cevap: seçenek ${i + 1}`}
                />
                <input
                  value={c}
                  aria-label={`Seçenek ${i + 1}`}
                  onChange={(e) => set('choices', choices.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </label>
            ))}
          </div>
          <Field label="Doğru cevapta gösterilecek açıklama">
            <input value={str('explanation')} onChange={(e) => set('explanation', e.target.value)} />
          </Field>
        </>
      )
    }
    case 'catalog_identity':
      return (
        <>
          <dl className="batch-dl">
            <dt>Yayın adı</dt>
            <dd>{str('display_name')}</dd>
            <dt>Adres</dt>
            <dd>{str('display_address')}</dd>
            <dt>Kimlik kaynakları</dt>
            <dd>{((p.identity_source_ids as string[]) ?? []).join(', ')}</dd>
            <dt>Okunan tutarsızlıklar</dt>
            <dd>{((p.acknowledged_discrepancy_ids as string[]) ?? []).join(', ') || '—'}</dd>
          </dl>
          <Field label="Ziyaretçi notu (isteğe bağlı)">
            <textarea
              rows={2}
              value={str('public_site_notice')}
              onChange={(e) => set('public_site_notice', e.target.value.trim() ? e.target.value : null)}
            />
          </Field>
        </>
      )
    case 'image_rights':
      return (
        <>
          <Field label="Hak sahibi (yazar)">
            <input value={str('rights_holder')} onChange={(e) => set('rights_holder', e.target.value)} />
          </Field>
          <Field label="Lisans">
            <select value={str('license')} onChange={(e) => set('license', e.target.value)}>
              {LICENSES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Atıf metni">
            <input value={str('attribution')} onChange={(e) => set('attribution', e.target.value || null)} />
          </Field>
          <label className="batch-check">
            <input
              type="checkbox"
              checked={p.monument_match === 'confirmed'}
              onChange={(e) => set('monument_match', e.target.checked ? 'confirmed' : '')}
            />
            Fotoğrafın bu eseri gösterdiğini kontrol ettim
          </label>
        </>
      )
    case 'image_reference_index': {
      const angles = (p.angle_classes as string[]) ?? []
      return (
        <>
          <p className="inventory-muted">
            Bu karar fotoğrafı yalnızca yerel görsel tanıma referansı yapar; ziyaretçilere yayımlamaz. Açı ve içerik sınıfları masa
            başı incelemeden önerildi, düzeltebilirsiniz.
          </p>
          <fieldset className="batch-angles">
            <legend>Görsel açı sınıfı (en az biri)</legend>
            {ANGLES.map(([v, l]) => (
              <label key={v} className="batch-check">
                <input
                  type="checkbox"
                  checked={angles.includes(v)}
                  onChange={(e) => set('angle_classes', e.target.checked ? [...angles, v] : angles.filter((a) => a !== v))}
                />
                {l}
              </label>
            ))}
          </fieldset>
          <Field label="İnsan">
            <select value={str('people')} onChange={(e) => set('people', e.target.value || null)}>
              <option value="">Seçin</option>
              {PEOPLE.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Yazı / tabela">
            <select value={str('visible_text')} onChange={(e) => set('visible_text', e.target.value || null)}>
              <option value="">Seçin</option>
              {VISIBLE_TEXT.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <label className="batch-check">
            <input
              type="checkbox"
              checked={p.monument_match === 'confirmed'}
              onChange={(e) => set('monument_match', e.target.checked ? 'confirmed' : '')}
            />
            Fotoğrafın bu eseri gösterdiğini referans kullanımı için ayrıca kontrol ettim
          </label>
        </>
      )
    }
    case 'location_verification':
      return (
        <>
          <dl className="batch-dl">
            <dt>Aday</dt>
            <dd>{str('candidate_id')}</dd>
            <dt>Yöntem</dt>
            <dd>{str('method') === 'editor_map_review' ? 'Editör harita incelemesi' : str('method')}</dd>
          </dl>
          <Field label="Doğruluk (m; adayın tahmininden küçük olamaz)">
            <input
              type="number"
              min={1}
              value={typeof p.accuracy_m === 'number' ? p.accuracy_m : ''}
              onChange={(e) => set('accuracy_m', Number(e.target.value))}
            />
          </Field>
          <Field label="Doğrulama kaydı">
            <textarea rows={3} value={str('verification_reference')} onChange={(e) => set('verification_reference', e.target.value)} />
          </Field>
        </>
      )
    case 'issue_resolution':
      return (
        <>
          <Field label="Çözüm">
            <textarea rows={3} value={str('resolution')} onChange={(e) => set('resolution', e.target.value)} />
          </Field>
          <Field label="Seçilen değer">
            <input value={str('chosen_value')} onChange={(e) => set('chosen_value', e.target.value || null)} />
          </Field>
        </>
      )
    default:
      return null
  }
}

/** Saklanan dosyayı oturumla alıp gösterir; dahili yol yoksa Commons küçük görseline düşer. */
function ReviewImage({ item }: { item: BatchItem }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!item.media_url) return
    const controller = new AbortController()
    let url: string | null = null
    getReviewMedia(item.media_url, controller.signal)
      .then((blob) => {
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [item.media_url])
  if (item.media_url && failed) return <p className="batch-blockers">Saklanan fotoğraf doğrulanamadı veya alınamadı; onay vermeyin.</p>
  const shown = item.media_url ? src : item.preview_url
  if (!shown) return null
  return <img className="batch-preview" src={shown} alt={`Önizleme: ${item.title}`} loading="lazy" referrerPolicy="no-referrer" />
}

/** Fotoğraf künyesi: kaynak, yazar, tam lisans, atıf, çözünürlük, açı sınıfı, kimlik kanıtı ve şüpheler. */
function ImageFactsPanel({ facts, monumentId }: { facts: ImageFacts; monumentId: string | null }) {
  const angleLabel = (a: string) => ANGLES.find(([v]) => v === a)?.[1] ?? a
  const [w, h] = facts.stored_size
  const [ow, oh] = facts.original_size
  return (
    <section className="batch-image-facts" aria-label="Fotoğraf künyesi">
      {facts.candidate_batch && (
        <p className="batch-badge batch-badge--candidate">Yeni aday ({facts.candidate_batch}) · masa başı ön inceleme, onay değildir</p>
      )}
      <dl className="batch-dl">
        <dt>Önerilen eser</dt>
        <dd>
          {monumentId} · {facts.monument_name ?? '—'} <em>(editör doğrulayana kadar öneridir)</em>
        </dd>
        <dt>Kaynak</dt>
        <dd>
          {facts.file_page_url ? (
            <a href={facts.file_page_url} target="_blank" rel="noopener noreferrer">
              Wikimedia Commons dosya sayfası
            </a>
          ) : (
            '—'
          )}
        </dd>
        <dt>Fotoğrafçı</dt>
        <dd>{facts.artist ?? '—'}</dd>
        <dt>Lisans</dt>
        <dd>
          {facts.license_url ? (
            <a href={facts.license_url} target="_blank" rel="noopener noreferrer">
              {facts.license_short_name}
            </a>
          ) : (
            facts.license_short_name ?? '—'
          )}
          {facts.license_obligations && <span className="inventory-muted"> — {facts.license_obligations}</span>}
        </dd>
        <dt>Gerekli atıf</dt>
        <dd>{facts.attribution ?? '—'}</dd>
        <dt>Çözünürlük</dt>
        <dd>
          Saklanan {w}×{h} px{ow && oh ? ` · özgün ${ow}×${oh} px` : ''}
        </dd>
        <dt>Açı sınıfı</dt>
        <dd>{facts.angle_classes.length ? facts.angle_classes.map(angleLabel).join(', ') : '—'}</dd>
        {facts.people !== null && (
          <>
            <dt>İçerik</dt>
            <dd>
              {LEVEL_PEOPLE[facts.people] ?? facts.people} · {LEVEL_TEXT[facts.sign_or_text ?? 0]}
            </dd>
          </>
        )}
        {facts.confusion_risk && (
          <>
            <dt>Karışma riski</dt>
            <dd>{facts.confusion_risk}</dd>
          </>
        )}
      </dl>
      {facts.doubts.length > 0 && (
        <ul className="batch-doubts" aria-label="Kimlik veya telif şüpheleri">
          {facts.doubts.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Editörün "düzeltme gerekli" kararına verilen yanıtın özeti: ne değişti, ne çıkarıldı, ne hâlâ kanıt bekliyor. */
function RevisionNote({ revision }: { revision: BatchRevision }) {
  const parts: [string, string[]][] = [
    ['Yapılan düzeltmeler', revision.changes],
    ['Yayın metninden çıkarılanlar', revision.removed_details],
    ['Hâlâ kanıt bekleyenler', revision.pending_evidence],
  ]
  return (
    <section className="batch-revision" aria-label="Düzeltme özeti">
      <p>
        <strong>Düzeltme gerekli kararınıza yanıt</strong> <span className="inventory-muted">({revision.addresses_decision_id})</span>
      </p>
      {parts
        .filter(([, list]) => list.length > 0)
        .map(([heading, list]) => (
          <div key={heading}>
            <h5>{heading}</h5>
            <ul>
              {list.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  )
}

function ItemRow({
  item,
  checked,
  canSelect,
  draft,
  onToggle,
  onDraft,
  locked,
}: {
  item: BatchItem
  checked: boolean
  canSelect: boolean
  draft: Draft
  onToggle: (on: boolean) => void
  onDraft: (d: Draft) => void
  locked: boolean
}) {
  const [open, setOpen] = useState(false)
  const id = `batch-${item.key.replace(/[^\w-]/g, '_')}`
  return (
    <li className={`batch-item${checked ? ' batch-item--selected' : ''}${item.done ? ' batch-item--done' : ''}`}>
      <div className="batch-item__head">
        {item.allowed && !item.done ? (
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={(!canSelect && !checked) || locked}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label={`Seç: ${item.label} — ${item.title}`}
          />
        ) : (
          <span className="batch-item__lock" aria-hidden="true">
            {item.done ? '✓' : '–'}
          </span>
        )}
        <label htmlFor={id} className="batch-item__title">
          <strong>{item.title}</strong>{' '}
          <span className="inventory-muted">
            {item.monument_id && item.monument_id !== item.subject_id ? `${item.monument_id} · ` : ''}
            {item.subject_id}
          </span>
        </label>
        <span className={`batch-badge batch-badge--${item.status}`}>
          {STATUS[item.status] ?? item.status}
          {item.stale ? ' (eski)' : ''}
        </span>
        {item.verdict && <span className={`batch-badge batch-verdict--${item.verdict}`}>{VERDICT[item.verdict] ?? item.verdict}</span>}
        {item.revision?.open && <span className="batch-badge batch-badge--revised">Düzeltildi · yeniden incelemede</span>}
        <button type="button" className="button button--light batch-item__more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Kanıtı gizle' : 'Kanıt ve ayrıntı'}
        </button>
      </div>
      {!item.allowed && !item.done && <p className="inventory-muted">Bu karar “{item.role}” rolündeki hesapla verilir.</p>}
      {item.blockers.length > 0 && !item.done && (
        <ul className="batch-blockers" aria-label="Engeller">
          {item.blockers.map((b) => (
            <li key={b.code} className={b.resolved_in_batch ? 'batch-blocker--soft' : ''}>
              {b.text}
              {b.resolved_in_batch && ' (aynı gönderimde önce onaylanırsa açılır)'}
            </li>
          ))}
        </ul>
      )}
      {(open || checked) && (
        <div className="batch-item__body">
          <ReviewImage item={item} />
          {item.image_facts && <ImageFactsPanel facts={item.image_facts} monumentId={item.monument_id} />}
          <ul className="batch-evidence" aria-label="Kanıtlar">
            {item.evidence.map((e, i) => (
              <li key={i}>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer">
                    {e.label}
                  </a>
                ) : (
                  <strong>{e.label}</strong>
                )}
                {e.text && <q>{e.text}</q>}
              </li>
            ))}
          </ul>
          {item.notes && <p className="batch-notes">Not: {item.notes}</p>}
          {item.revision?.open && <RevisionNote revision={item.revision} />}
          {checked && (
            <div className="batch-form">
              <Field label="Karar">
                <select value={draft.decision} onChange={(e) => onDraft({ ...draft, decision: e.target.value as BatchDecision })} disabled={locked}>
                  {DECISIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              {item.source_check_required && (
                <Field label="Kaynak kontrolü">
                  <select value={draft.source_check} onChange={(e) => onDraft({ ...draft, source_check: e.target.value })} disabled={locked}>
                    {SOURCE_CHECKS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <fieldset disabled={locked} className="batch-payload">
                <PayloadFields item={item} draft={draft} onChange={(payload) => onDraft({ ...draft, payload })} />
              </fieldset>
              <Field label="Bu kayda özel not (isteğe bağlı)">
                <input value={draft.note} onChange={(e) => onDraft({ ...draft, note: e.target.value })} disabled={locked} />
              </Field>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function BatchReviewPanel({ reviewer }: { reviewer: ReviewerInfo | null }) {
  const [version, setVersion] = useState(0)
  const listing = useApi(getBatch, `batch:${reviewer?.reviewer_id ?? 'anonim'}:${version}`)
  const [stage, setStage] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [rationale, setRationale] = useState('')
  const [ticket, setTicket] = useState<BatchTicket | null>(null)
  const [waitLeft, setWaitLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)

  const items = useMemo(() => (listing.status === 'success' ? listing.data.stages.flatMap((s) => s.items) : []), [listing])
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items])

  useEffect(() => {
    if (listing.status !== 'success' || stage) return
    const roles = new Set(listing.data.reviewer_roles)
    const first = listing.data.stages.find((s) => roles.has(s.role) && s.counts.done < s.counts.total)
    setStage(first?.decision_type ?? listing.data.stages[0]?.decision_type ?? null)
  }, [listing, stage])

  useEffect(() => {
    if (!ticket) return
    const until = Date.now() + ticket.min_review_seconds * 1000
    const tick = () => setWaitLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [ticket])

  const toggle = (item: BatchItem, on: boolean) => {
    setSelected((prev) => {
      if (!on) return withoutDependents(prev, item.key, items)
      const next = new Set(prev)
      next.add(item.key)
      return next
    })
    if (on && !drafts[item.key]) setDrafts((d) => ({ ...d, [item.key]: draftFor(item) }))
  }

  const selectRecommended = (stageType: string) => {
    const stageItems = items.filter((i) => i.decision_type === stageType)
    const next = new Set(selected)
    const newDrafts: Record<string, Draft> = {}
    // Önceki aşamalardan seçilmiş olanlar bağımlılıkları çözer; bu yüzden seçim mevcut seçimle birlikte değerlendirilir.
    for (const i of stageItems) {
      if (i.recommended && selectable(i, next)) {
        next.add(i.key)
        if (!drafts[i.key]) newDrafts[i.key] = draftFor(i)
      }
    }
    setSelected(next)
    setDrafts((d) => ({ ...d, ...newDrafts }))
  }

  const reset = () => {
    setTicket(null)
    setSelected(new Set())
    setDrafts({})
    setError(null)
  }

  async function start() {
    setError(null)
    setResult(null)
    try {
      const t = await openBatchTicket([...selected])
      // Geri sayım, önceki gönderimden kalan değerle değil bu biletin süresiyle başlar.
      setWaitLeft(Math.ceil(t.min_review_seconds))
      setTicket(t)
    } catch (e) {
      setError((e as ApiError).message)
    }
  }

  async function submit() {
    if (!ticket) return
    setBusy(true)
    setError(null)
    try {
      const res = await submitBatch({
        ticket_id: ticket.ticket_id,
        rationale,
        items: ticket.keys.map((key) => {
          const d = drafts[key] ?? draftFor(byKey.get(key)!)
          return {
            key,
            decision: d.decision,
            source_check: d.source_check,
            note: d.note || undefined,
            payload: d.decision === 'approved' ? d.payload : undefined,
          }
        }),
      })
      setResult(res)
      reset()
      setVersion((v) => v + 1)
    } catch (e) {
      // Bilet sunucuda tüketildi; seçim ve düzenlemeler korunur, yeni bilet açılabilir.
      setError(`${(e as ApiError).message} Seçiminiz korundu; incelemeyi yeniden başlatabilirsiniz.`)
      setTicket(null)
    } finally {
      setBusy(false)
    }
  }

  if (listing.status === 'loading') return <p>Toplu inceleme listesi yükleniyor…</p>
  if (listing.status === 'error') {
    return (
      <p className="notice notice--error" role="alert">
        Toplu inceleme listesi yüklenemedi: {listing.error.message}
      </p>
    )
  }
  const data = listing.data
  const current = data.stages.find((s) => s.decision_type === stage) ?? data.stages[0]
  const roles = new Set(data.reviewer_roles)
  const selectedCount = selected.size
  const locked = ticket !== null

  return (
    <section className="review-block batch" aria-labelledby="batch-title">
      <h2 id="batch-title">Toplu inceleme</h2>
      <p>
        Önerili kayıtları kanıtlarıyla birlikte tek ekranda inceleyin. Her satır ayrı bir karar olarak kaydedilir; hiçbir satır
        siz seçmeden gönderilmez. Kararlar sunucuda doğru sırayla (önce doğruluk ve kimlik, sonra yayın ve oyun) yazılır.
      </p>
      {!reviewer && (
        <p className="notice notice--warning">Karar vermek için yukarıdan kişisel incelemeci hesabınızla giriş yapın.</p>
      )}
      {reviewer && (
        <p className="inventory-muted">
          Rolleriniz: <strong>{data.reviewer_roles.join(', ')}</strong>. Diğer rollerin kararları burada salt okunur görünür. Toplu
          incelemeye alınmayanlar: {data.excluded.join('; ')}.
        </p>
      )}
      {result && (
        <div className={`notice ${result.failed ? 'notice--warning' : ''}`} role="status">
          <div>
            <p className="notice__title">
              {result.recorded} karar kaydedildi{result.failed ? `, ${result.failed} kayıt reddedildi` : ''}.
            </p>
            {result.publication && (
              <p>
                {result.publication.published
                  ? `Genel katalog güncellendi: ${result.publication.monuments} eser, ${result.publication.facts} bilgi, ${result.publication.images} fotoğraf yayında.`
                  : `Genel katalog güncellenmedi: ${result.publication.reason}`}
              </p>
            )}
            {result.failed > 0 && (
              <ul>
                {result.results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <li key={r.key}>
                      <code>{r.key}</code>: {r.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <nav className="batch-tabs" aria-label="İnceleme aşamaları">
        {data.stages.map((s) => (
          <button
            key={s.decision_type}
            type="button"
            className={`batch-tab${s.decision_type === current.decision_type ? ' batch-tab--active' : ''}${roles.has(s.role) ? '' : ' batch-tab--other'}`}
            onClick={() => setStage(s.decision_type)}
            aria-pressed={s.decision_type === current.decision_type}
          >
            {s.label}
            <span className="batch-tab__count">
              {s.counts.done}/{s.counts.total}
            </span>
          </button>
        ))}
      </nav>
      <div className="batch-stage-actions">
        <span>
          <strong>{current.label}</strong> · rol: {current.role}
        </span>
        {roles.has(current.role) && !locked && (
          <>
            <button type="button" className="button button--secondary" onClick={() => selectRecommended(current.decision_type)}>
              Bu aşamada önerilenleri seç
            </button>
            <button
              type="button"
              className="button button--light"
              onClick={() =>
                setSelected((prev) =>
                  [...prev]
                    .filter((k) => byKey.get(k)?.decision_type === current.decision_type)
                    .reduce((acc, k) => withoutDependents(acc, k, items), prev),
                )
              }
            >
              Bu aşamanın seçimini temizle
            </button>
          </>
        )}
      </div>
      <ul className="batch-list">
        {current.items.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            checked={selected.has(item.key)}
            canSelect={selectable(item, selected)}
            draft={drafts[item.key] ?? draftFor(item)}
            onToggle={(on) => toggle(item, on)}
            onDraft={(d) => setDrafts((all) => ({ ...all, [item.key]: d }))}
            locked={locked}
          />
        ))}
      </ul>
      {reviewer && (
        <div className="batch-footer" role="region" aria-label="Toplu karar gönderimi">
          <p>
            <strong>{selectedCount}</strong> kayıt seçili (en fazla {data.max_items}).
          </p>
          <label className="batch-field">
            <span>Toplu karar gerekçesi (en az 15 karakter; her kayda yazılır)</span>
            <textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} disabled={locked && busy} />
          </label>
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
          {!ticket ? (
            <button
              type="button"
              className="button button--primary"
              disabled={selectedCount === 0 || selectedCount > data.max_items || rationale.trim().length < 15}
              onClick={start}
            >
              Seçili {selectedCount} kaydı incelemeye başla
            </button>
          ) : (
            <div className="batch-footer__actions">
              <span role="status">
                {waitLeft > 0
                  ? `Seçili kayıtları gözden geçirin; onay ${waitLeft} sn sonra gönderilebilir.`
                  : 'Kararlar gönderilmeye hazır.'}
              </span>
              <button type="button" className="button button--primary" disabled={busy || waitLeft > 0} onClick={submit}>
                {busy ? 'Kaydediliyor…' : `${ticket.keys.length} kararı kaydet`}
              </button>
              <button type="button" className="button button--light" disabled={busy} onClick={() => setTicket(null)}>
                Seçime dön
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
