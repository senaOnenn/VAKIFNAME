import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import type { MonumentLocation, MonumentSummary } from './types'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları'

export type LocatedMonument = MonumentSummary & { location: MonumentLocation }

export interface MonumentMapProps {
  /** Yalnızca haritada gösterilmesi onaylanmış, doğrulanmış konumlu eserler. */
  monuments: LocatedMonument[]
  selectedId: string | null
  onSelect: (monumentId: string) => void
  onTileError: () => void
}

const icon = (selected: boolean) =>
  L.divIcon({
    className: ['map-marker', selected && 'map-marker--selected'].filter(Boolean).join(' '),
    html: '<span class="map-marker__pin"></span>',
    iconSize: [44, 44],
    iconAnchor: [22, 42],
    popupAnchor: [0, -36],
  })
const ICONS = { idle: icon(false), selected: icon(true) }

function Fit({ monuments }: { monuments: LocatedMonument[] }) {
  const map = useMap()
  const key = monuments.map((m) => `${m.monument_id}:${m.location.latitude},${m.location.longitude}`).join('|')
  useEffect(() => {
    if (monuments.length === 0) return
    map.fitBounds(L.latLngBounds(monuments.map((m) => [m.location.latitude, m.location.longitude])), {
      padding: [48, 48],
      maxZoom: 16,
    })
  }, [map, key])
  return null
}

export default function MonumentMap({ monuments, selectedId, onSelect, onTileError }: MonumentMapProps) {
  return (
    <MapContainer className="place-map" center={[40.1885, 29.061]} zoom={14} scrollWheelZoom={false}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} eventHandlers={{ tileerror: onTileError }} />
      {monuments.map((m) => (
        <Marker
          key={m.monument_id}
          position={[m.location.latitude, m.location.longitude]}
          icon={ICONS[m.monument_id === selectedId ? 'selected' : 'idle']}
          title={m.name}
          alt={m.name}
          eventHandlers={{
            click: () => onSelect(m.monument_id),
            keypress: (event: L.LeafletKeyboardEvent) => {
              if (event.originalEvent.key !== 'Enter' && event.originalEvent.key !== ' ') return
              event.originalEvent.preventDefault()
              onSelect(m.monument_id)
            },
          }}
        >
          <Popup>
            <strong>{m.name}</strong>
            <br />
            {m.district}, {m.city}
            <br />
            <em>Doğruluk yaklaşık ±{Math.round(m.location.accuracy_m)} m</em>
          </Popup>
        </Marker>
      ))}
      <Fit monuments={monuments} />
    </MapContainer>
  )
}
