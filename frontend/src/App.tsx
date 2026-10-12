import { useCallback, useRef, useState } from 'react'
import { getPlaces } from './api/client'
import type { Place } from './api/types'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { MapSection } from './components/MapSection'
import { cardButtonId } from './components/PlaceCard'
import { PlaceDetail } from './components/PlaceDetail'
import { PlaceList } from './components/PlaceList'
import { useApi } from './hooks/useApi'
import { useSelectedPlace } from './hooks/useSelectedPlace'

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Elemana odaklanır ve görünür alana kaydırır (jsdom'da scrollIntoView yoktur). */
function focusAndReveal(element: HTMLElement | null) {
  if (!element) return
  element.focus({ preventScroll: true })
  element.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' })
}

/** Haritadan yapılan seçim için ekran okuyucu metni. */
function selectionMessage(place: Place) {
  const demo = place.is_demo ? ' Kurgusal demo kaydı.' : ''
  return `${place.name} seçildi, ${place.city}.${demo} Ayrıntılar eser ayrıntıları panelinde.`
}

export default function App() {
  const places = useApi(getPlaces, 'places')
  const [selectedId, select] = useSelectedPlace()
  const detailRef = useRef<HTMLElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  // Haritadan seçimde odak işaretleyicide kalır; değişiklik bu canlı bölgeyle duyurulur. Karttan seçimde odak
  // panele taşındığı için duyuru yapılmaz. Seçim başka yoldan (kart, geri/ileri) değişince duyuru temizlenir,
  // böylece canlı bölge hiçbir zaman paneldeki eserden farklı bir eseri göstermez.
  const [mapAnnouncement, setMapAnnouncement] = useState<{ placeId: string; text: string } | null>(null)
  if (mapAnnouncement && mapAnnouncement.placeId !== selectedId) setMapAnnouncement(null)

  const selectFromCard = useCallback(
    (placeId: string) => {
      select(placeId)
      focusAndReveal(detailRef.current)
    },
    [select],
  )

  const selectFromMap = useCallback(
    (placeId: string) => {
      select(placeId)
      const place = places.status === 'success' ? places.data.find((p) => p.id === placeId) : undefined
      if (place) setMapAnnouncement({ placeId, text: selectionMessage(place) })
    },
    [select, places],
  )

  const closeDetail = useCallback(() => {
    const previous = selectedId
    select(null)
    if (previous) document.getElementById(cardButtonId(previous))?.focus()
  }, [select, selectedId])

  return (
    <>
      <a className="skip-link" href="#kesfet">
        İçeriğe geç
      </a>
      <Header />
      <main id="top">
        <Hero />
        <PlaceList places={places} selectedId={selectedId} onSelect={selectFromCard} onRetry={places.reload} />
        <MapSection
          ref={mapRef}
          places={places}
          selectedId={selectedId}
          onSelect={selectFromMap}
          detail={
            <PlaceDetail
              ref={detailRef}
              selectedId={selectedId}
              onClose={closeDetail}
              onShowOnMap={() => focusAndReveal(mapRef.current)}
            />
          }
        />
        <p id="map-selection-status" className="visually-hidden" role="status" aria-atomic="true">
          {mapAnnouncement?.text}
        </p>
      </main>
      <footer className="site-footer">
        <div className="container">
          <p>
            <strong>VAKIFNAME</strong> · Team HisGuard · KÖK &amp; KOD Hackathonu
          </p>
          <p className="site-footer__note">
            Kurgusal demo kayıtları arayüzde açıkça etiketlenir. Harita verileri © OpenStreetMap katkıcıları.
          </p>
        </div>
      </footer>
    </>
  )
}
