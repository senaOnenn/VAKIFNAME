import { useCallback, useRef } from 'react'
import { getPlaces } from './api/client'
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

export default function App() {
  const places = useApi(getPlaces, 'places')
  const [selectedId, select] = useSelectedPlace()
  const detailRef = useRef<HTMLElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)

  const selectFromCard = useCallback(
    (placeId: string) => {
      select(placeId)
      focusAndReveal(detailRef.current)
    },
    [select],
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
          onSelect={select}
          detail={
            <PlaceDetail
              ref={detailRef}
              selectedId={selectedId}
              onClose={closeDetail}
              onShowOnMap={() => focusAndReveal(mapRef.current)}
            />
          }
        />
      </main>
      <footer className="site-footer">
        <div className="container">
          <p>
            <strong>VAKIFNAME</strong> · Team HisGuard · KÖK &amp; KOD Hackathonu
          </p>
          <p className="site-footer__note">
            Bu sürümdeki tüm eser kayıtları kurgusal demo verisidir. Harita verileri © OpenStreetMap katkıcıları.
          </p>
        </div>
      </footer>
    </>
  )
}
