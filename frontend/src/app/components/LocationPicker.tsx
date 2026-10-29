import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import './route-map.css'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları'
const PIN = L.divIcon({ className: 'vk-pin vk-pin--next', html: '<span class="vk-pin__body"></span>', iconSize: [34, 34], iconAnchor: [17, 17] })

export interface LocationPickerProps {
  value: { lat: number; lng: number } | null
  /** Konum yokken haritanın açılacağı yer (ör. seçili şehrin merkezi). */
  center: { lat: number; lng: number }
  onPick: (pos: { lat: number; lng: number }) => void
}

function Clicks({ onPick }: { onPick: LocationPickerProps['onPick'] }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

function Follow({ value, center }: Pick<LocationPickerProps, 'value' | 'center'>) {
  const map = useMap()
  const key = value ? `${value.lat},${value.lng}` : `c${center.lat},${center.lng}`
  useEffect(() => {
    map.setView(value ? [value.lat, value.lng] : [center.lat, center.lng], value ? Math.max(map.getZoom(), 16) : 12)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/**
 * Yönetimde eser konumu seçimi: haritaya tıklamak konumu koyar. Erişilebilir yol, yanındaki enlem/boylam alanlarıdır;
 * harita yalnızca kolaylıktır.
 */
export default function LocationPicker({ value, center, onPick }: LocationPickerProps) {
  return (
    <MapContainer className="vk-rmap vk-locpick" center={[center.lat, center.lng]} zoom={12} scrollWheelZoom={false} keyboard>
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      {value && <Marker position={[value.lat, value.lng]} icon={PIN} keyboard={false} />}
      <Clicks onPick={onPick} />
      <Follow value={value} center={center} />
    </MapContainer>
  )
}
