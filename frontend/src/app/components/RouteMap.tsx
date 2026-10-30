import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { MonumentStatus } from '../api'
import './route-map.css'
import { useLang } from '../i18n'
import { loadOfflineRoads, type OfflineRoads } from './offline-map/roads'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> {contributors}'

export interface MapPoint {
  id: string
  name: string
  lat: number
  lng: number
  status?: MonumentStatus
  /** Rota sırası (yalnızca açık/kilitli duraklarda). */
  order?: number
  next?: boolean
}

export interface RouteMapProps {
  points: MapPoint[]
  /** Rota çizgisi: başlangıç + duraklar sırayla. */
  path?: [number, number][]
  start?: { lat: number; lng: number; label: string } | null
  onSelect?: (id: string) => void
  className?: string
}

const icon = (p: MapPoint) =>
  L.divIcon({
    className: `vk-pin vk-pin--${p.status ?? 'plain'}${p.next ? ' vk-pin--next' : ''}`,
    html: `<span class="vk-pin__body">${p.status === 'locked' ? '' : p.status === 'completed' || p.status === 'gold' ? '✓' : p.order ?? ''}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
const START_ICON = L.divIcon({ className: 'vk-pin vk-pin--start', html: '<span class="vk-pin__body"></span>', iconSize: [18, 18], iconAnchor: [9, 9] })

function Fit({ points }: { points: MapPoint[] }) {
  const map = useMap()
  const key = points.map((p) => `${p.id}:${p.lat},${p.lng}`).join('|')
  useEffect(() => {
    if (!points.length) return
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 17 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/** Bağlantı yokken altlık: önceden çıkarılmış ana yollar ve nehir (yalnızca gerektiğinde indirilir). */
function OfflineBase() {
  const [roads, setRoads] = useState<OfflineRoads | null>(null)
  useEffect(() => {
    let alive = true
    loadOfflineRoads().then((r) => alive && setRoads(r), () => undefined)
    return () => {
      alive = false
    }
  }, [])
  if (!roads) return null
  return (
    <>
      {(['river', 'minor', 'major'] as const).map((cls) =>
        roads[cls].map((line, i) => (
          <Polyline key={`${cls}-${i}`} positions={line} interactive={false} pathOptions={{ className: `vk-rmap__road vk-rmap__road--${cls}` }} />
        )),
      )}
    </>
  )
}

/** Art arda bu kadar karo yüklenemezse bağlantı yok sayılır ve önceden hazırlanmış altlık çizilir. */
const TILE_FAILURES_OFFLINE = 3

/** Koyu tonlu OSM haritası: durum renkli işaretler, rota sırası ve kesikli altın rota çizgisi. */
export default function RouteMap({ points, path, start, onSelect, className = '' }: RouteMapProps) {
  const { lang, t } = useLang()
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const failures = useRef(0)
  return (
    <MapContainer className={`vk-rmap ${className}`} center={[40.1885, 29.061]} zoom={14} scrollWheelZoom={false}>
      {/* Atıf metni katman kurulurken okunur; dil değişince katman yeniden kurulur. */}
      <TileLayer
        key={lang}
        url={TILE_URL}
        attribution={TILE_ATTRIBUTION.replace('{contributors}', t('katkıcıları'))}
        eventHandlers={{
          tileerror: () => {
            failures.current += 1
            if (failures.current >= TILE_FAILURES_OFFLINE) setOffline(true)
          },
          tileload: () => {
            failures.current = 0
          },
        }}
      />
      {offline && <OfflineBase />}
      {offline && (
        <p className="vk-rmap__offline" role="status">
          {t('Bağlantı yok: harita yerine ana yollar gösteriliyor.')}
        </p>
      )}
      {path && path.length > 1 && <Polyline positions={path} pathOptions={{ className: 'vk-rmap__path' }} />}
      {start && (
        <Marker position={[start.lat, start.lng]} icon={START_ICON} keyboard={false}>
          <Tooltip direction="top">{start.label}</Tooltip>
        </Marker>
      )}
      {points.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={icon(p)}
          title={p.name}
          alt={p.name}
          // Yakın eserlerde (ör. Osman/Orhan Gazi türbeleri 28 m) sıradaki ve açık duraklar üstte kalır.
          zIndexOffset={p.next ? 1000 : p.status === 'unlocked' ? 500 : 0}
          eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -14]}>{p.name}</Tooltip>
        </Marker>
      ))}
      <Fit points={points} />
    </MapContainer>
  )
}
