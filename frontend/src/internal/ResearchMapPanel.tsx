import { lazy, Suspense } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useApi } from '../hooks/useApi'
import { isCompeting, markerShape, REPRESENTS_LABELS, SOURCE_KIND_LABELS, UNVERIFIED_LABEL } from './researchMapModel'
import { getLocationCandidates } from './reviewClient'
import type { LocationCandidateRow, MonumentSummary } from './types'

// Leaflet ayrı parçada yüklenir; harita açılamazsa liste ve ayrıntı paneli çalışmaya devam eder.
const ResearchMap = lazy(() => import('./ResearchMap'))

function MapFallback({ children }: { children: string }) {
  return <div className="research-map research-map--placeholder">{children}</div>
}

const LEGEND: [string, string][] = [
  ['building', 'Bina izi merkezi (OSM)'],
  ['area', 'Kullanım alanı merkezi — bina değil'],
  ['point', 'Nokta nesnesi, yapı izi yok'],
  ['crosscheck', 'Wikidata — yalnızca çapraz kontrol'],
]

interface Props {
  monuments: MonumentSummary[]
  selectedId: string | null
  onSelect: (monumentId: string) => void
}

/**
 * Dahili Bursa araştırma haritası ve eser/aday listesi. Hiçbir aday doğrulanmış değildir; koordinatı olmayan eser
 * listede kalır ama haritaya konmaz. Harita yalnızca geliştirme sunucusundaki envanter ekranında vardır.
 */
export function ResearchMapPanel({ monuments, selectedId, onSelect }: Props) {
  const data = useApi(getLocationCandidates, 'research-map-candidates')
  return (
    <section className="review-block research-map-panel" aria-labelledby="research-map-title">
      <h2 id="research-map-title">Bursa araştırma haritası</h2>
      <p className="notice notice--warning research-map-panel__warning">
        Haritadaki her işaret <strong>{UNVERIFIED_LABEL.toLocaleLowerCase('tr')}</strong>dır. Konum incelemecisi
        doğrulamadan genel haritaya geçmez ve GPS check-in açmaz. Bina veya alan merkezi bir giriş noktası değildir.
      </p>
      {data.status === 'loading' && <p role="status">Koordinat adayları yükleniyor…</p>}
      {data.status === 'error' && <p role="alert">Koordinat adayları yüklenemedi: {data.error.message}</p>}
      {data.status === 'success' && (
        <Body
          candidates={data.data.candidates}
          attribution={data.data.attribution}
          monuments={monuments}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </section>
  )
}

function Body({
  candidates,
  attribution,
  monuments,
  selectedId,
  onSelect,
}: Props & { candidates: LocationCandidateRow[]; attribution: string }) {
  const byMonument = new Map<string, LocationCandidateRow[]>()
  for (const c of candidates) byMonument.set(c.monument_id, [...(byMonument.get(c.monument_id) ?? []), c])
  const withCandidates = monuments.filter((m) => byMonument.has(m.monument_id)).length
  return (
    <>
      <p className="inventory-muted">
        {monuments.length} eser · {withCandidates} eserde toplam {candidates.length} aday ·{' '}
        {monuments.length - withCandidates} eserde aday yok (haritaya konmaz).
      </p>
      <ul className="research-legend" aria-label="Harita açıklaması">
        {LEGEND.map(([shape, label]) => (
          <li key={shape}>
            <span className={`research-marker research-marker--${shape} research-legend__swatch`} aria-hidden="true">
              <span className="research-marker__shape" />
            </span>
            {label}
          </li>
        ))}
        <li>
          <span className="research-marker research-marker--point research-marker--competing research-legend__swatch" aria-hidden="true">
            <span className="research-marker__shape">!</span>
          </span>
          Çelişen aday (aynı eser için rakip yapı)
        </li>
        <li>
          <span className="research-marker research-marker--group research-legend__swatch" aria-hidden="true">
            <span className="research-marker__shape">2</span>
          </span>
          Üst üste binen adaylar — tıklayınca hepsi listelenir
        </li>
      </ul>
      <div className="research-map-layout">
        <div className="research-map-frame" role="region" aria-label="Bursa araştırma haritası (doğrulanmamış adaylar)">
          <ErrorBoundary fallback={<MapFallback>Harita şu anda gösterilemiyor; aşağıdaki liste kullanılabilir.</MapFallback>}>
            <Suspense fallback={<MapFallback>Harita yükleniyor…</MapFallback>}>
              <ResearchMap candidates={candidates} selectedMonumentId={selectedId} onSelectMonument={onSelect} />
            </Suspense>
          </ErrorBoundary>
        </div>
        <ol className="research-monuments" aria-label="Gerçek eserler ve konum adayları">
          {monuments.map((m) => {
            const own = byMonument.get(m.monument_id) ?? []
            const selected = m.monument_id === selectedId
            return (
              <li key={m.monument_id} className={`research-monument${selected ? ' research-monument--selected' : ''}`}>
                <button
                  type="button"
                  className="research-monument__open"
                  aria-pressed={selected}
                  onClick={() => onSelect(m.monument_id)}
                >
                  <code>{m.monument_id}</code> {m.name}
                </button>
                {own.length === 0 ? (
                  <p className="inventory-muted">Koordinat adayı yok; haritada gösterilmez.</p>
                ) : (
                  <ul className="research-monument__candidates" aria-label={`${m.name} konum adayları`}>
                    {own.map((c) => (
                      <li key={c.candidate_id}>
                        <span className={`research-marker research-marker--${markerShape(c)}${isCompeting(c) ? ' research-marker--competing' : ''} research-legend__swatch`} aria-hidden="true">
                          <span className="research-marker__shape">{isCompeting(c) ? '!' : ''}</span>
                        </span>
                        <span>
                          <code>{c.candidate_id}</code> · {UNVERIFIED_LABEL} · {REPRESENTS_LABELS[c.represents] ?? c.represents}{' '}
                          · {SOURCE_KIND_LABELS[c.source_kind] ?? c.source_kind} <code>{c.source_object}</code> · ±
                          {c.estimated_accuracy_m} m
                          {c.represents !== 'entrance' && <> · giriş noktası değil</>}
                          {isCompeting(c) && <strong> · çelişen aday ({c.competing_discrepancy_ids.join(', ')})</strong>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      </div>
      <p className="inventory-muted">{attribution}</p>
    </>
  )
}
