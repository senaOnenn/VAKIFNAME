import { forwardRef } from 'react'
import type { Passport, Place } from '../api/types'
import type { ApiState } from '../hooks/useApi'
import type { CheckInState } from '../hooks/useCheckIn'
import { DemoBadge } from './DemoBadge'
import { MapPinIcon } from './Icons'
import { QuestPanel } from './QuestPanel'
import { QuestStatusBadge } from './QuestStatusBadge'
import { questStatus } from './questStatus'

interface Props {
  places: ApiState<Place[]>
  passport: ApiState<Passport>
  checkIns: Record<string, CheckInState>
  activeId: string | null
  onStart: (placeId: string) => void
  onCheckIn: (place: Place) => void
}

export function questButtonId(placeId: string) {
  return `quest-start-${placeId}`
}

export const QuestSection = forwardRef<HTMLElement, Props>(function QuestSection(
  { places, passport, checkIns, activeId, onStart, onCheckIn },
  panelRef,
) {
  const loaded = places.status === 'success' ? places.data : []
  const active = loaded.find((p) => p.id === activeId) ?? null

  return (
    <section id="gorevler" className="section" aria-labelledby="gorevler-title">
      <div className="container">
        <header className="section__header">
          <h2 id="gorevler-title" className="section__title">
            Görevler
          </h2>
          <p className="section__lead">
            Her eser için bir keşif görevi var. Görevi tamamla, dijital mührünü kazan ve pasaportunda biriktir.
          </p>
        </header>

        {/* Eser listesi hatası Keşfet bölümünde duyurulur; burada ikinci kez alarm verilmez. */}
        {places.status === 'loading' && <p className="notice">Görevler, eserler yüklendikten sonra gösterilecek…</p>}
        {places.status === 'error' && (
          <p className="notice">Eser verisi alınamadığı için görevler şu anda gösterilemiyor.</p>
        )}
        {places.status === 'success' && loaded.length === 0 && (
          <p className="notice">Henüz görev yok. Eser verisi eklendiğinde her eser için bir görev açılacak.</p>
        )}

        {loaded.length > 0 && (
          <div className="quest-layout">
            <ul className="quest-list" aria-label="Görev listesi">
              {loaded.map((place) => {
                const isActive = place.id === activeId
                const headingId = `quest-card-title-${place.id}`
                return (
                  <li key={place.id} className={`quest-card${isActive ? ' quest-card--active' : ''}`}>
                    <div className="quest-card__meta">
                      <span className="place-card__city">
                        <MapPinIcon />
                        {place.city}
                      </span>
                      {place.is_demo && <DemoBadge />}
                    </div>
                    <h3 id={headingId} className="quest-card__title">
                      {place.name}
                    </h3>
                    <p className="quest-card__description">{place.description}</p>
                    <div className="quest-card__footer">
                      <QuestStatusBadge status={questStatus(place.id, passport, checkIns[place.id])} />
                      <button
                        id={questButtonId(place.id)}
                        type="button"
                        className="button button--primary"
                        aria-label={`Göreve başla: ${place.name}`}
                        aria-pressed={isActive}
                        onClick={() => onStart(place.id)}
                      >
                        Göreve başla
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <QuestPanel
              ref={panelRef}
              place={active}
              status={active ? questStatus(active.id, passport, checkIns[active.id]) : null}
              checkIn={active ? checkIns[active.id] : undefined}
              onCheckIn={onCheckIn}
            />
          </div>
        )}
      </div>
    </section>
  )
})
