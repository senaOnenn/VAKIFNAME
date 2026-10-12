import type { Place } from '../api/types'
import { DemoBadge } from './DemoBadge'
import { ArchIcon, MapPinIcon } from './Icons'

interface Props {
  place: Place
  selected: boolean
  onSelect: (placeId: string) => void
}

export function cardButtonId(placeId: string) {
  return `place-card-${placeId}`
}

export function PlaceCard({ place, selected, onSelect }: Props) {
  const headingId = `place-card-title-${place.id}`
  return (
    <article className={`place-card${selected ? ' place-card--selected' : ''}`} aria-labelledby={headingId}>
      <div className="place-card__visual" aria-hidden="true">
        <ArchIcon />
      </div>
      <div className="place-card__body">
        <div className="place-card__meta">
          <span className="place-card__city">
            <MapPinIcon />
            {place.city}
          </span>
          {place.is_demo && <DemoBadge />}
        </div>
        <h3 id={headingId} className="place-card__title">
          {place.name}
        </h3>
        <p className="place-card__description">{place.description}</p>
        <button
          id={cardButtonId(place.id)}
          type="button"
          className="button button--primary place-card__action"
          aria-label={`Detayları gör: ${place.name}`}
          aria-pressed={selected}
          onClick={() => onSelect(place.id)}
        >
          Detayları gör
        </button>
      </div>
    </article>
  )
}
