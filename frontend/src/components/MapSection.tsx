import { forwardRef, lazy, Suspense, useState, type ReactNode } from 'react'
import type { Place } from '../api/types'
import type { ApiState } from '../hooks/useApi'
import { ErrorBoundary } from './ErrorBoundary'
import { AlertIcon } from './Icons'

// Leaflet ayrı bir parçada yüklenir; harita çökerse veya yüklenemezse eser listesi etkilenmez.
const PlaceMap = lazy(() => import('./PlaceMap'))

interface Props {
  places: ApiState<Place[]>
  selectedId: string | null
  onSelect: (placeId: string) => void
  detail: ReactNode
}

function MapPlaceholder({ children }: { children: ReactNode }) {
  return <div className="place-map place-map--placeholder">{children}</div>
}

export const MapSection = forwardRef<HTMLDivElement, Props>(function MapSection(
  { places, selectedId, onSelect, detail },
  mapRef,
) {
  const [tileError, setTileError] = useState(false)
  const hasDemo = places.status === 'success' && places.data.some((p) => p.is_demo)

  let map: ReactNode
  if (places.status === 'loading') {
    map = <MapPlaceholder>Harita, eserler yüklendikten sonra gösterilecek…</MapPlaceholder>
  } else if (places.status === 'error') {
    map = <MapPlaceholder>Eser verisi alınamadığı için harita işaretleri gösterilemiyor.</MapPlaceholder>
  } else {
    map = (
      <ErrorBoundary fallback={<MapPlaceholder>Harita şu anda gösterilemiyor. Eser listesini kullanmaya devam edebilirsin.</MapPlaceholder>}>
        <Suspense fallback={<MapPlaceholder>Harita yükleniyor…</MapPlaceholder>}>
          <PlaceMap
            places={places.data}
            selectedId={selectedId}
            onSelect={onSelect}
            onTileError={() => setTileError(true)}
          />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <section id="harita" className="section section--alt" aria-labelledby="harita-title">
      <div className="container">
        <header className="section__header">
          <h2 id="harita-title" className="section__title">
            Keşif Haritası
          </h2>
          <p className="section__lead">
            İşaretleyicilere dokunarak ya da Tab ile ulaşıp Enter’a basarak eser seçebilirsin.
          </p>
        </header>

        {hasDemo && (
          <p className="notice notice--warning" role="note">
            <AlertIcon className="notice__icon" />
            <span>
              <strong>Kurgusal demo konumları.</strong> Haritadaki işaretler test amaçlıdır ve gerçek bir eserin
              konumunu göstermez.
            </span>
          </p>
        )}

        {tileError && (
          <p className="notice" role="status">
            Harita altlığı yüklenemedi; internet bağlantısı gerekebilir. Eser listesi ve ayrıntılar çalışmaya devam
            ediyor.
          </p>
        )}

        <div className="map-layout">
          <div ref={mapRef} className="map-frame" role="region" aria-label="Eser haritası" tabIndex={-1}>
            {map}
          </div>
          {detail}
        </div>
      </div>
    </section>
  )
})
