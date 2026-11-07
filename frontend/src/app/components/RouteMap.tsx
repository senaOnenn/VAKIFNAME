import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
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
  /** R4 keşif rotası: ziyaretçinin kendi planındaki sıra (oyun rotasından bağımsız). Varsa işaretin içinde bu yazar. */
  planned?: number
  /** Ekran okuyucu ve ipucu için işaretin adı (yoksa `name`). */
  label?: string
}

export interface RouteMapProps {
  points: MapPoint[]
  /** Rota çizgisi: başlangıç + duraklar sırayla. */
  path?: [number, number][]
  start?: { lat: number; lng: number; label: string } | null
  onSelect?: (id: string) => void
  className?: string
  /** R4: seçili eser (işaret vurgulanır, en üstte durur). */
  selectedId?: string | null
  /** R4: harita bu esere odaklanır (eser sayfasındaki "Haritada gör"). Değişince yeniden odaklanır. */
  focusId?: string | null
}

// Aynı görünüm aynı simge nesnesini alır: simge değişmedikçe Leaflet işaret öğesini yeniden kurmaz (klavye odağı korunur).
const ICONS = new Map<string, L.DivIcon>()
const icon = (p: MapPoint) => {
  const className = `vk-pin vk-pin--${p.status ?? 'plain'}${p.next ? ' vk-pin--next' : ''}${p.planned ? ' vk-pin--planned' : ''}`
  const html = `<span class="vk-pin__body">${p.planned ?? (p.status === 'locked' ? '' : p.status === 'completed' || p.status === 'gold' ? '✓' : p.order ?? '')}</span>`
  const key = `${className}|${html}`
  let i = ICONS.get(key)
  if (!i) ICONS.set(key, (i = L.divIcon({ className, html, iconSize: [34, 34], iconAnchor: [17, 17] })))
  return i
}
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

/** Seçilen esere odaklanır (hareket azaltılmışsa animasyonsuz). Sığdırmadan sonra çalışır, onu ezer. */
function Focus({ point }: { point: MapPoint | undefined }) {
  const map = useMap()
  const key = point ? `${point.id}:${point.lat},${point.lng}` : ''
  useEffect(() => {
    if (!point) return
    const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16), { animate: !still })
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
export default function RouteMap({ points, path, start, onSelect, className = '', selectedId = null, focusId = null }: RouteMapProps) {
  const { lang, t } = useLang()
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const failures = useRef(0)
  const selected = selectedId ? points.find((p) => p.id === selectedId) : undefined
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
      {/* Seçili eser: işaretin çevresinde fildişi halka (simge değişmez; odak kaybolmaz). */}
      {selected && (
        <CircleMarker center={[selected.lat, selected.lng]} radius={24} interactive={false} pathOptions={{ className: 'vk-rmap__halo' }} />
      )}
      {points.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={icon(p)}
          title={p.label ?? p.name}
          alt={p.label ?? p.name}
          // Yakın eserlerde (ör. Osman/Orhan Gazi türbeleri 28 m) seçili, sıradaki ve açık duraklar üstte kalır.
          zIndexOffset={p.id === selectedId ? 2000 : p.next ? 1000 : p.status === 'unlocked' || p.planned ? 500 : 0}
          eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -14]}>{p.name}</Tooltip>
        </Marker>
      ))}
      <Fit points={points} />
      <Focus point={focusId ? points.find((p) => p.id === focusId) : undefined} />
    </MapContainer>
  )
}
