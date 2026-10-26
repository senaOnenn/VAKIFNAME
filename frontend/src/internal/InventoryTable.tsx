import { blockerLabel, statusLabel } from './labels'
import type { MonumentSummary } from './types'

function SourceReviewCell({ m }: { m: MonumentSummary }) {
  const found = m.review.source_audit.quote_found_on_page ?? 0
  return (
    <>
      <span>
        {found}/{m.review.facts_total} alıntı sayfada bulundu
      </span>
      <span className="inventory-muted">{m.review.facts_awaiting_editor} olgu editör onayı bekliyor</span>
    </>
  )
}

interface Props {
  monuments: MonumentSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function InventoryTable({ monuments, selectedId, onSelect }: Props) {
  return (
    <div className="inventory-table-wrap" tabIndex={0} role="region" aria-label="Eser tablosu (yatay kaydırılabilir)">
      <table className="inventory-table">
        <caption className="visually-hidden">Gerçek Bursa eserleri ve inceleme durumları</caption>
        <thead>
          <tr>
            <th scope="col">Kimlik</th>
            <th scope="col">Eser</th>
            <th scope="col">Kayıt durumu</th>
            <th scope="col">Koordinat</th>
            <th scope="col">Kaynak incelemesi</th>
            <th scope="col">Görseller</th>
            <th scope="col">Yayın engelleri</th>
          </tr>
        </thead>
        <tbody>
          {monuments.map((m) => (
            <tr
              key={m.monument_id}
              className={`inventory-row${m.monument_id === selectedId ? ' inventory-row--selected' : ''}`}
            >
              <td>
                <code>{m.monument_id}</code>
              </td>
              <th scope="row">
                <button
                  type="button"
                  className="inventory-row__open"
                  aria-pressed={m.monument_id === selectedId}
                  onClick={() => onSelect(m.monument_id)}
                >
                  {m.name}
                </button>
                <span className="inventory-muted">
                  {m.type} · {m.district}, {m.city}
                </span>
              </th>
              <td>
                <span>{statusLabel(m.review_status)}</span>
                <span className="inventory-muted">{statusLabel(m.publication_status)}</span>
              </td>
              <td>
                <span className={`inventory-pill inventory-pill--${m.location.status}`}>{statusLabel(m.location.status)}</span>
                {!m.map_eligible && <span className="inventory-muted">Haritada gösterilmez · check-in kapalı</span>}
              </td>
              <td>
                <SourceReviewCell m={m} />
              </td>
              <td>
                <span>{m.image_count} görsel</span>
                <span className="inventory-muted">
                  {m.review.images_license_pending} lisans bekliyor · {m.review.images_publishable} yayınlanabilir
                </span>
              </td>
              <td>
                <ul className="inventory-blockers" aria-label={`${m.name} yayın engelleri`}>
                  {m.review.public_release_blockers.map((b) => (
                    <li key={b}>{blockerLabel(b)}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
