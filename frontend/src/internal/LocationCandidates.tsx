import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { statusLabel } from './labels'
import { getLocationCandidates } from './reviewClient'

const REPRESENTS: Record<string, string> = {
  building_footprint_centroid: 'Bina izi merkezi',
  area_centroid: 'Kullanım alanı merkezi',
  point_feature: 'Nokta nesnesi',
  entrance: 'Giriş noktası',
  parcel_centroid: 'Parsel merkezi',
}

// Karar gerektiren belirsizlikler önce; ibadet/kabir bayrakları her satırda tekrarlanır, ayrı sütunda gösterilir.
const SITE_FLAGS = new Set(['worship_site', 'burial_site'])

/**
 * Tüm koordinat adaylarının karşılaştırmalı tablosu. Hiçbir aday doğrulanmış değildir; tablo yalnızca konum
 * incelemecisinin çözmesi gereken belirsizlikleri gösterir. Doğrulama tek tek `location_verification` kararıyla yapılır.
 */
export function LocationCandidatesPanel() {
  const [open, setOpen] = useState(false)
  return (
    <details className="review-block" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Koordinat adayları — karşılaştırmalı inceleme tablosu (hepsi doğrulanmamış)</summary>
      {open && <CandidateTable />}
    </details>
  )
}

function CandidateTable() {
  const data = useApi(getLocationCandidates, 'location-candidates')
  if (data.status === 'loading') return <p role="status">Koordinat adayları yükleniyor…</p>
  if (data.status === 'error') return <p role="alert">Koordinat adayları yüklenemedi: {data.error.message}</p>
  const { candidates, flag_labels, monuments_with_candidates, verified, entry_points_available, attribution } = data.data
  return (
    <>
      <p className="inventory-note">
        {monuments_with_candidates} eser için {candidates.length} aday · doğrulanmış konum: {verified} · güvenli giriş
        noktası: {entry_points_available}. Bina veya alan merkezi bir giriş noktası değildir; GPS check-in için ayrıca
        kaynaklı bir giriş noktası gerekir.
      </p>
      <div className="inventory-table-wrap" tabIndex={0} role="region" aria-label="Koordinat adayları karşılaştırması">
        <table className="inventory-table">
          <thead>
            <tr>
              <th scope="col">Eser</th>
              <th scope="col">Aday</th>
              <th scope="col">Enlem, boylam</th>
              <th scope="col">Neyi temsil ediyor</th>
              <th scope="col">±m</th>
              <th scope="col">Kaynak</th>
              <th scope="col">Diğer aday</th>
              <th scope="col">En yakın başka eser</th>
              <th scope="col">Belirsizlik</th>
              <th scope="col">Alan</th>
              <th scope="col">Durum</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const issues = c.flags.filter((f) => !SITE_FLAGS.has(f))
              const site = c.flags.filter((f) => SITE_FLAGS.has(f))
              return (
                <tr key={c.candidate_id}>
                  <th scope="row">
                    <code>{c.monument_id}</code> {c.monument_name}
                  </th>
                  <td>
                    <code>{c.candidate_id}</code>
                  </td>
                  <td>
                    {c.latitude}, {c.longitude}
                  </td>
                  <td>{REPRESENTS[c.represents] ?? c.represents}</td>
                  <td>{c.estimated_accuracy_m}</td>
                  <td>
                    {c.source_object}
                    {c.notes && <span className="inventory-muted"> · {c.notes}</span>}
                  </td>
                  <td>
                    {c.other_candidates.length === 0
                      ? '—'
                      : c.other_candidates.map((o) => `${o.candidate_id}: ${o.distance_m} m`).join(', ')}
                  </td>
                  <td>
                    {c.nearest_other_monument
                      ? `${c.nearest_other_monument.monument_id}: ${c.nearest_other_monument.distance_m} m`
                      : '—'}
                  </td>
                  <td>
                    <ul className="inventory-blockers">
                      {issues.map((f) => (
                        <li key={f}>
                          {flag_labels[f] ?? f}
                          {f === 'competing_candidate' && c.competing_discrepancy_ids.length > 0 && (
                            <> ({c.competing_discrepancy_ids.join(', ')})</>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{site.length === 0 ? '—' : site.map((f) => flag_labels[f] ?? f).join(' ')}</td>
                  <td>
                    <span className="inventory-pill inventory-pill--blocked">{statusLabel(c.status)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="inventory-muted">{attribution}</p>
    </>
  )
}
