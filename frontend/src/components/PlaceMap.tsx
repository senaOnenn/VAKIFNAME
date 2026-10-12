import 'leaflet/dist/leaflet.css'
import L, { type Marker as LeafletMarker } from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import type { Place } from '../api/types'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları'
const MAX_FIT_ZOOM = 15

export interface PlaceMapProps {
  places: Place[]
  selectedId: string | null
  onSelect: (placeId: string) => void
  onTileError: () => void
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

// Görsel dosyası gerektirmeyen işaretleyiciler; paketleyicide eksik ikon sorununu da önler.
// Bir kez oluşturulur; her render'da yeni ikon verilseydi Leaflet gereksiz yere setIcon çağırırdı.
const createMarkerIcon = (selected: boolean) =>
  L.divIcon({
    className: `map-marker${selected ? ' map-marker--selected' : ''}`,
    html: '<span class="map-marker__pin"></span>',
    // 44x44 dokunma alanı; görünen iğne bunun içinde çizilir ve ucu (22, 42) noktasındadır.
    iconSize: [44, 44],
    iconAnchor: [22, 42],
    popupAnchor: [0, -36],
  })
const MARKER_ICON = createMarkerIcon(false)
const SELECTED_MARKER_ICON = createMarkerIcon(true)

function FitToPlaces({ places }: { places: Place[] }) {
  const map = useMap()
  const key = places.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|')
  useEffect(() => {
    if (places.length === 0) return
    const bounds = L.latLngBounds(places.map((p) => [p.latitude, p.longitude]))
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: MAX_FIT_ZOOM })
    // Yalnızca konumlar değiştiğinde yeniden sığdır.
  }, [map, key])
  return null
}

function FollowSelection({ place, markers }: { place: Place | undefined; markers: Map<string, LeafletMarker> }) {
  const map = useMap()
  useEffect(() => {
    if (!place) {
      map.closePopup()
      return
    }
    const target: [number, number] = [place.latitude, place.longitude]
    const zoom = Math.max(map.getZoom(), 13)
    if (prefersReducedMotion()) map.setView(target, zoom)
    else map.flyTo(target, zoom, { duration: 0.6 })
    markers.get(place.id)?.openPopup()
  }, [map, place, markers])
  return null
}

export default function PlaceMap({ places, selectedId, onSelect, onTileError }: PlaceMapProps) {
  const markers = useRef(new Map<string, LeafletMarker>()).current
  const selectedPlace = useMemo(() => places.find((p) => p.id === selectedId), [places, selectedId])

  return (
    <MapContainer className="place-map" center={[0, 0]} zoom={2} scrollWheelZoom={false}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} eventHandlers={{ tileerror: onTileError }} />
      {places.map((place) => (
        <Marker
          key={place.id}
          position={[place.latitude, place.longitude]}
          icon={place.id === selectedId ? SELECTED_MARKER_ICON : MARKER_ICON}
          title={place.name}
          alt={place.name}
          riseOnHover
          zIndexOffset={place.id === selectedId ? 1000 : 0}
          eventHandlers={{
            click: () => onSelect(place.id),
            // Leaflet klavyede Enter ile yalnızca açılır pencereyi açar, `click` tetiklemez.
            keypress: (event: L.LeafletKeyboardEvent) => {
              const { key } = event.originalEvent
              if (key !== 'Enter' && key !== ' ') return
              event.originalEvent.preventDefault()
              onSelect(place.id)
            },
          }}
          ref={(marker) => {
            if (marker) markers.set(place.id, marker)
            else markers.delete(place.id)
          }}
        >
          <Popup>
            <strong>{place.name}</strong>
            <br />
            {place.city}
            {place.is_demo && (
              <>
                <br />
                <em>Kurgusal demo konumu</em>
              </>
            )}
          </Popup>
        </Marker>
      ))}
      <FitToPlaces places={places} />
      <FollowSelection place={selectedPlace} markers={markers} />
    </MapContainer>
  )
}
