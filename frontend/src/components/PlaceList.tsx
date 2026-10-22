import type { ApiState } from '../hooks/useApi'
import type { Place } from '../api/types'
import { ApiErrorMessage } from './ApiErrorMessage'
import { drawingVariantFor } from './ArchitectureDrawing'
import { PlaceCard } from './PlaceCard'

interface Props {
  places: ApiState<Place[]>
  selectedId: string | null
  onSelect: (placeId: string) => void
  onRetry: () => void
}

export function PlaceList({ places, selectedId, onSelect, onRetry }: Props) {
  return (
    <section id="kesfet" className="section" aria-labelledby="kesfet-title">
      <div className="container">
        <header className="section__header">
          <h2 id="kesfet-title" className="section__title">
            Eserleri Keşfet
          </h2>
          <p className="section__lead">Bir eser seçerek ayrıntılarını ve haritadaki yerini incele.</p>
        </header>

        {places.status === 'loading' && (
          <p className="notice" role="status">
            Eserler yükleniyor…
          </p>
        )}

        {places.status === 'error' && (
          <ApiErrorMessage title="Eserler yüklenemedi" error={places.error} onRetry={onRetry} />
        )}

        {places.status === 'success' && places.data.length === 0 && (
          <p className="notice" role="status">
            Henüz listelenecek eser yok. Eser verisi eklendiğinde burada görünecek.
          </p>
        )}

        {places.status === 'success' && places.data.length > 0 && (
          <>
            <p className="visually-hidden" role="status">
              {places.data.length} eser listelendi.
            </p>
            <ul className="card-grid" aria-label="Eser listesi">
              {places.data.map((place, index) => (
                <li key={place.id}>
                  <PlaceCard
                    place={place}
                    selected={place.id === selectedId}
                    drawing={drawingVariantFor(index)}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
