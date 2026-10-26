import './identity-fields.css'
import type { MonumentResearch } from './types'

/**
 * Temel kimlik kararı (`catalog_identity`) için yapılandırılmış alanlar. Editör JSON yazmaz; yalnızca araştırmadaki
 * değerlerden seçer. Hiçbir alan önceden seçilmez. Buradaki uyarılar yalnızca yol göstericidir: ön koşulları
 * (resmî kaynak, kaynak kitap kullanım hakkı, tutarsızlıkların okunması) sunucu ayrıca denetler.
 *
 * Bu karar olgu, fotoğraf, harita ve GPS kararlarından ayrıdır; onlardan hiçbirini açmaz.
 */

export interface IdentitySubject {
  monument_id: string
  v20_name: string
  type: string
  city: string
  district: string
  research: Omit<MonumentResearch, 'location_candidates'> | null
}

export interface IdentityPayload {
  display_name: string
  display_address: string
  identity_source_ids: string[]
  published_alternative_names: string[]
  public_site_notice: string | null
  acknowledged_discrepancy_ids: string[]
}

export const EMPTY_IDENTITY: IdentityPayload = {
  display_name: '',
  display_address: '',
  identity_source_ids: [],
  published_alternative_names: [],
  public_site_notice: null,
  acknowledged_discrepancy_ids: [],
}

// Sunucudaki `INDEPENDENT_IDENTITY_SOURCE_KINDS` ile aynı: kimliği tek başına doğrulayabilen resmî kaynaklar.
const OFFICIAL_KINDS = new Set(['official_portal', 'municipal_heritage', 'vgm', 'cadastral'])
const KIND_LABELS: Record<string, string> = {
  official_portal: 'Resmî portal',
  municipal_heritage: 'Belediye / alan başkanlığı',
  vgm: 'VGM',
  cadastral: 'Kadastro',
  v20_source_pdf: 'Kaynak kitap (Vakıf Katılım)',
  open_map_data: 'Açık harita verisi',
  open_knowledge_base: 'Açık bilgi tabanı',
}

const toggle = (list: string[], value: string, on: boolean) =>
  on ? [...new Set([...list, value])] : list.filter((v) => v !== value)

/** Seçimlere göre eksik veya ek onay gerektiren durumlar (sunucunun yerine geçmez). */
export function identityHints(subject: IdentitySubject, p: IdentityPayload): string[] {
  const r = subject.research
  if (!r) return ['Bu eser için araştırma kaydı yok; kimlik onaylanamaz.']
  const hints: string[] = []
  const sources = new Map(r.sources.map((s) => [s.source_id, s]))
  if (!p.display_name) hints.push('Yayında görünecek adı seçin.')
  if (!p.display_address) hints.push('Bir adres adayı seçin.')
  const chosen = p.identity_source_ids.map((id) => sources.get(id)).filter((s) => s !== undefined)
  if (chosen.length === 0) hints.push('Kimliği doğruladığınız kaynağı işaretleyin.')
  else if (!chosen.some((s) => OFFICIAL_KINDS.has(s.kind))) {
    hints.push('Resmî kaynak seçilmedi: kaynak kitap tek başına ancak kullanım hakkı onayıyla yeterlidir.')
  }
  const claim = r.address_claims.find((a) => a.value === p.display_address)
  const pdfs = new Set(
    [...chosen, claim ? sources.get(claim.source_id) : undefined]
      .filter((s) => s?.kind === 'v20_source_pdf')
      .map((s) => s!.pdf_file),
  )
  for (const pdf of pdfs) {
    hints.push(`Kaynak kitap kullanılıyor (${pdf}): "rights" rolünden kaynak kullanım hakkı onayı gerekir.`)
  }
  const unacked = r.discrepancies.filter((d) => !p.acknowledged_discrepancy_ids.includes(d.discrepancy_id))
  if (unacked.length > 0) hints.push(`${unacked.length} tutarsızlık henüz okundu olarak işaretlenmedi.`)
  return hints
}

export function IdentityDecisionFields({
  formId,
  subject,
  value,
  onChange,
}: {
  formId: string
  subject: IdentitySubject
  value: IdentityPayload
  onChange: (next: IdentityPayload) => void
}) {
  const r = subject.research
  if (!r) return <p className="notice notice--warning">Bu eser için kaynak araştırması yok; kimlik onaylanamaz.</p>
  const set = (patch: Partial<IdentityPayload>) => onChange({ ...value, ...patch })
  const names = [...new Set([r.full_name, subject.v20_name, ...r.alternative_names])]
  const identitySources = r.sources.filter((s) => s.supports.includes('identity'))
  const sourceById = new Map(r.sources.map((s) => [s.source_id, s]))
  const hints = identityHints(subject, value)

  return (
    <fieldset className="identity-fields">
      <legend>Temel kimlik (yalnızca onayda gönderilir; olgu, görsel, harita ve GPS kararlarından ayrıdır)</legend>
      <dl className="review-fields review-fields--compact">
        <div>
          <dt>BUR kimliği</dt>
          <dd>
            <code>{subject.monument_id}</code>
          </dd>
        </div>
        <div>
          <dt>Tür (V20)</dt>
          <dd>{subject.type}</dd>
        </div>
        <div>
          <dt>İl / ilçe (V20)</dt>
          <dd>
            {subject.city} / {subject.district}
          </dd>
        </div>
      </dl>

      <label htmlFor={`${formId}-name`}>Eser adı (yayında görünecek)</label>
      <select id={`${formId}-name`} value={value.display_name} onChange={(e) => set({ display_name: e.target.value })}>
        <option value="">Seçin…</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <fieldset>
        <legend>Adres adayı</legend>
        {r.address_claims.map((a) => {
          const s = sourceById.get(a.source_id)
          return (
            <label key={a.value} className="identity-fields__choice">
              <input
                type="radio"
                name={`${formId}-address`}
                checked={value.display_address === a.value}
                onChange={() => set({ display_address: a.value })}
              />
              <span>
                {a.value}{' '}
                <span className="inventory-muted">
                  ({a.source_id} · {KIND_LABELS[s?.kind ?? ''] ?? s?.kind})
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <fieldset>
        <legend>Kimliği doğruladığım kaynaklar</legend>
        {identitySources.map((s) => (
          <label key={s.source_id} className="identity-fields__choice">
            <input
              type="checkbox"
              checked={value.identity_source_ids.includes(s.source_id)}
              onChange={(e) => set({ identity_source_ids: toggle(value.identity_source_ids, s.source_id, e.target.checked) })}
            />
            <span>
              <code>{s.source_id}</code> {KIND_LABELS[s.kind] ?? s.kind}
              {OFFICIAL_KINDS.has(s.kind) && <strong> · resmî</strong>} —{' '}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              ) : (
                <>
                  {s.title}, {s.pdf_file} fiziksel s.{s.pdf_physical_page}
                </>
              )}
              <span className="inventory-muted"> · {s.summary}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Açık tutarsızlıklar ({r.discrepancies.length})</legend>
        {r.discrepancies.length === 0 && <p className="inventory-muted">Kayıtlı tutarsızlık yok.</p>}
        {r.discrepancies.map((d) => (
          <label key={d.discrepancy_id} className="identity-fields__choice">
            <input
              type="checkbox"
              checked={value.acknowledged_discrepancy_ids.includes(d.discrepancy_id)}
              onChange={(e) =>
                set({
                  acknowledged_discrepancy_ids: toggle(value.acknowledged_discrepancy_ids, d.discrepancy_id, e.target.checked),
                })
              }
            />
            <span>
              Okudum, kararımda dikkate aldım: <code>{d.discrepancy_id}</code> <strong>{d.topic}</strong> — {d.description}
            </span>
          </label>
        ))}
      </fieldset>

      {names.length > 1 && (
        <fieldset>
          <legend>Yayında gösterilecek diğer adlar (isteğe bağlı)</legend>
          {names
            .filter((n) => n !== value.display_name)
            .map((n) => (
              <label key={n} className="identity-fields__choice">
                <input
                  type="checkbox"
                  checked={value.published_alternative_names.includes(n)}
                  onChange={(e) =>
                    set({ published_alternative_names: toggle(value.published_alternative_names, n, e.target.checked) })
                  }
                />
                <span>{n}</span>
              </label>
            ))}
        </fieldset>
      )}

      <label htmlFor={`${formId}-notice`}>Ziyaretçi notu (isteğe bağlı; araştırma notu otomatik kopyalanmaz)</label>
      <textarea
        id={`${formId}-notice`}
        rows={2}
        value={value.public_site_notice ?? ''}
        onChange={(e) => set({ public_site_notice: e.target.value.trim() ? e.target.value : null })}
      />

      {hints.length > 0 && (
        <div className="notice notice--warning">
          <div>
            <p className="notice__title">Onaydan önce</p>
            <ul aria-label="Kimlik onayı için eksikler">
              {hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </fieldset>
  )
}
