import 'leaflet/dist/leaflet.css'
import './research-map.css'
import L from 'leaflet'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import {
  entranceLabel,
  groupOverlapping,
  isCompeting,
  markerShape,
  markerTitle,
  REPRESENTS_LABELS,
  SOURCE_KIND_LABELS,
  UNVERIFIED_LABEL,
  type CandidateGroup,
} from './researchMapModel'
import type { LocationCandidateRow } from './types'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları'
// Bursa tarihî merkezi (Ulu Cami – Muradiye arası). Yalnızca ilk görünüm içindir; hiçbir esere konum atamaz.
const BURSA_CENTER: [number, number] = [40.1875, 29.054]
// İşaretçi 30 px genişliğinde; merkezleri bundan yakın düşen adaylar tek grup işaretçisinde toplanır.
const OVERLAP_PX = 30
// Pencere haritadan taşmasın ve yakınlaştırma düğmelerinin altına girmesin (mobil dahil).
const POPUP_PROPS = { maxWidth: 300, autoPanPaddingTopLeft: [64, 16] as [number, number], autoPanPadding: [16, 16] as [number, number] }

export interface ResearchMapProps {
  candidates: LocationCandidateRow[]
  selectedMonumentId: string | null
  onSelectMonument: (monumentId: string) => void
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

function candidateIcon(c: LocationCandidateRow, selected: boolean) {
  const classes = ['research-marker', `research-marker--${markerShape(c)}`]
  if (isCompeting(c)) classes.push('research-marker--competing')
  if (selected) classes.push('research-marker--selected')
  return L.divIcon({
    className: classes.join(' '),
    html: `<span class="research-marker__shape" aria-hidden="true">${isCompeting(c) ? '!' : ''}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  })
}

function groupIcon(g: CandidateGroup, selected: boolean) {
  const classes = ['research-marker', 'research-marker--group']
  if (g.candidates.some(isCompeting)) classes.push('research-marker--competing')
  if (selected) classes.push('research-marker--selected')
  return L.divIcon({
    className: classes.join(' '),
    html: `<span class="research-marker__shape" aria-hidden="true">${esc(String(g.candidates.length))}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  })
}

function CandidateDetails({ c, onOpen }: { c: LocationCandidateRow; onOpen: () => void }) {
  return (
    <div className="research-popup__item">
      <p className="research-popup__badge">{UNVERIFIED_LABEL}</p>
      <strong>{c.monument_name}</strong> <code>{c.monument_id}</code>
      <dl className="research-popup__fields">
        <dt>Aday</dt>
        <dd>
          <code>{c.candidate_id}</code>
          {isCompeting(c) && <> · çelişen aday ({c.competing_discrepancy_ids.join(', ')})</>}
        </dd>
        <dt>Temsil ettiği</dt>
        <dd>{REPRESENTS_LABELS[c.represents] ?? c.represents}</dd>
        <dt>Kaynak</dt>
        <dd>
          {SOURCE_KIND_LABELS[c.source_kind] ?? c.source_kind} · <code>{c.source_object}</code>
        </dd>
        <dt>Tahmini doğruluk</dt>
        <dd>±{c.estimated_accuracy_m} m</dd>
        <dt>Giriş noktası</dt>
        <dd>{entranceLabel(c)}</dd>
      </dl>
      {c.notes && <p className="research-popup__note">{c.notes}</p>}
      <button type="button" className="button button--secondary research-popup__open" onClick={onOpen}>
        Envanter ayrıntısını aç
      </button>
    </div>
  )
}

function FitAll({ candidates }: { candidates: LocationCandidateRow[] }) {
  const map = useMap()
  const key = candidates.map((c) => c.candidate_id).join('|')
  useEffect(() => {
    if (candidates.length === 0) return
    const fit = () =>
      map.fitBounds(L.latLngBounds(candidates.map((c) => [c.latitude, c.longitude])), { padding: [36, 36], maxZoom: 17 })
    fit()
    // Kapsayıcı boyutu yerleşim oturduktan sonra değişebilir (mobil, yan liste); kullanıcı haritayı oynatana kadar
    // tüm adaylar yeniden sığdırılır, böylece hiçbir işaretçi çerçevenin dışında kalmaz.
    let touched = false
    const markTouched = () => (touched = true)
    map.on('dragstart zoomstart', markTouched)
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      if (!touched) {
        map.off('zoomstart', markTouched)
        fit()
        map.on('zoomstart', markTouched)
      }
    })
    observer.observe(map.getContainer())
    return () => {
      observer.disconnect()
      map.off('dragstart zoomstart', markTouched)
    }
  }, [map, key])
  return null
}

/** Seçilen eserin adaylarına yakınlaşır; aynı eserin çelişen adayları ayrı işaretçiler olarak görünür. */
function FocusSelected({ candidates, selectedMonumentId }: Pick<ResearchMapProps, 'candidates' | 'selectedMonumentId'>) {
  const map = useMap()
  useEffect(() => {
    const own = candidates.filter((c) => c.monument_id === selectedMonumentId)
    if (own.length === 0) return
    // Başka esere ait açık pencere kalmasın; seçilen eserin işaretçileri yeniden gruplanır.
    map.closePopup()
    map.fitBounds(L.latLngBounds(own.map((c) => [c.latitude, c.longitude])), { padding: [60, 60], maxZoom: 18 })
  }, [map, candidates, selectedMonumentId])
  return null
}

function Markers({ candidates, selectedMonumentId, onSelectMonument }: ResearchMapProps) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const groups = useMemo(
    () => groupOverlapping(candidates, (lat, lon) => map.project([lat, lon], zoom), OVERLAP_PX),
    [candidates, map, zoom],
  )
  return (
    <>
      {groups.map((g) => {
        const selected = g.candidates.some((c) => c.monument_id === selectedMonumentId)
        if (g.candidates.length === 1) {
          const c = g.candidates[0]
          return (
            <Marker
              key={g.key}
              position={[c.latitude, c.longitude]}
              icon={candidateIcon(c, selected)}
              title={markerTitle(c)}
              alt={markerTitle(c)}
              eventHandlers={{ click: () => onSelectMonument(c.monument_id) }}
            >
              <Popup {...POPUP_PROPS}>
                <CandidateDetails c={c} onOpen={() => onSelectMonument(c.monument_id)} />
              </Popup>
            </Marker>
          )
        }
        const title = `${g.candidates.length} ${UNVERIFIED_LABEL.toLocaleLowerCase('tr')} üst üste: ${[
          ...new Set(g.candidates.map((c) => c.monument_name)),
        ].join(', ')}`
        return (
          <Marker key={g.key} position={[g.latitude, g.longitude]} icon={groupIcon(g, selected)} title={title} alt={title}>
            <Popup {...POPUP_PROPS} maxHeight={Math.min(320, Math.round(window.innerHeight * 0.45))}>
              <p className="research-popup__group-title">
                Bu noktada {g.candidates.length} aday üst üste düşüyor. Yakınlaştırın veya aşağıdan seçin.
              </p>
              <button
                type="button"
                className="button button--secondary research-popup__open"
                onClick={() =>
                  map.fitBounds(L.latLngBounds(g.candidates.map((c) => [c.latitude, c.longitude])), {
                    padding: [80, 80],
                    maxZoom: 19,
                  })
                }
              >
                Bu adaylara yakınlaştır
              </button>
              <ul className="research-popup__list" aria-label="Üst üste binen adaylar">
                {g.candidates.map((c) => (
                  <li key={c.candidate_id}>
                    <CandidateDetails c={c} onOpen={() => onSelectMonument(c.monument_id)} />
                  </li>
                ))}
              </ul>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}

/** Bursa araştırma haritası: 15 doğrulanmamış koordinat adayı. Yalnızca dahili envanter ekranında yüklenir. */
export default function ResearchMap(props: ResearchMapProps) {
  return (
    <MapContainer className="research-map" center={BURSA_CENTER} zoom={14} maxZoom={19} scrollWheelZoom={false}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
      <Markers {...props} />
      <FitAll candidates={props.candidates} />
      <FocusSelected candidates={props.candidates} selectedMonumentId={props.selectedMonumentId} />
    </MapContainer>
  )
}
