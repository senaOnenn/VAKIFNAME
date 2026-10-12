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
  const loaded = places.status === 'success' ? places.data : []
  const demoCount = loaded.filter((p) => p.is_demo).length
  const realCount = loaded.length - demoCount

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

        {demoCount > 0 && (
          <p className="notice notice--warning" role="note">
            <AlertIcon className="notice__icon" />
            {realCount === 0 ? (
              <span>
                <strong>Kurgusal demo konumları.</strong> Haritadaki tüm işaretler test amaçlıdır ve gerçek bir eserin
                konumunu göstermez.
              </span>
            ) : (
              <span>
                <strong>Bazı konumlar kurgusal.</strong> Haritadaki {loaded.length} işaretten {demoCount} tanesi
                kurgusal demo kaydıdır ve gerçek bir eserin konumunu göstermez. Bu işaretler kesikli çerçeveli, içi
                boş simgeyle gösterilir; diğer {realCount} işaret backend’de gerçek eser kaydı olarak işaretlidir.
              </span>
            )}
          </p>
        )}

        {demoCount > 0 && (
          <ul className="map-legend" aria-label="Harita işaretlerinin açıklaması">
            {realCount > 0 && (
              <li>
                <span className="map-legend__swatch map-marker" aria-hidden="true">
                  <span className="map-marker__pin" />
                </span>
                Gerçek eser kaydı
              </li>
            )}
            <li>
              <span className="map-legend__swatch map-marker map-marker--demo" aria-hidden="true">
                <span className="map-marker__pin" />
              </span>
              Kurgusal demo konumu (kesikli çerçeve, içi boş)
            </li>
          </ul>
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
