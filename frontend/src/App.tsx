import { useCallback, useRef, useState } from 'react'
import { getPassport, getPlaces } from './api/client'
import type { Place } from './api/types'
import { describeApiError } from './components/ApiErrorMessage'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { MapSection } from './components/MapSection'
import { cardButtonId } from './components/PlaceCard'
import { PlaceDetail } from './components/PlaceDetail'
import { PlaceList } from './components/PlaceList'
import { PassportSection } from './components/PassportSection'
import { QuestSection } from './components/QuestSection'
import { getDemoUserId } from './demoUser'
import { useApi } from './hooks/useApi'
import { useCheckIn, type CheckInState } from './hooks/useCheckIn'
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

/** Check-in sonucu için ekran okuyucu metni. Başarı yalnızca backend onayıyla bildirilir. */
function checkInMessage(place: Place, result: CheckInState): string {
  if (result.status === 'error') return `${place.name}: check-in tamamlanamadı, mühür eklenmedi. ${describeApiError(result.error)}`
  if (result.status !== 'done') return ''
  switch (result.response.status) {
    case 'completed':
      return `${place.name} görevi tamamlandı. Pasaportuna mühür eklendi.`
    case 'already_completed':
      return `${place.name} görevi daha önce tamamlanmıştı. Yeni mühür eklenmedi.`
    case 'out_of_range':
      return `${place.name}: konum görev alanı dışında. Görev tamamlanmadı, mühür kazanılmadı.`
  }
}

export default function App() {
  const places = useApi(getPlaces, 'places')
  // Demo kimliği oturum boyunca sabittir; gerçek hesap değildir (bkz. demoUser.ts).
  const [userId] = useState(getDemoUserId)
  const passport = useApi((signal) => getPassport(userId, signal), `passport:${userId}`)
  const reloadPassport = passport.reload
  const [selectedId, select] = useSelectedPlace()
  const detailRef = useRef<HTMLElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const questPanelRef = useRef<HTMLElement>(null)
  const [activeQuestId, setActiveQuestId] = useState<string | null>(null)
  // Her yeni sonuç ayrı bir düğümle yazılır; aynı metin art arda gelse de ekran okuyucu yeniden duyurur.
  const [questAnnouncement, setQuestAnnouncement] = useState<{ id: number; text: string } | null>(null)

  const onCheckInSettled = useCallback(
    (placeId: string, result: CheckInState) => {
      // Pasaport her denemeden sonra backend'den yeniden okunur; mühür arayüzde tahminle eklenmez.
      reloadPassport()
      const place = places.status === 'success' ? places.data.find((p) => p.id === placeId) : undefined
      if (place) setQuestAnnouncement((prev) => ({ id: (prev?.id ?? 0) + 1, text: checkInMessage(place, result) }))
    },
    [reloadPassport, places],
  )
  const checkIns = useCheckIn(userId, onCheckInSettled)

  const startQuest = useCallback((placeId: string) => {
    setActiveQuestId(placeId)
    // Panel öğesi kalıcıdır (yalnızca içeriği değişir), bu yüzden odak hemen taşınabilir.
    focusAndReveal(questPanelRef.current)
  }, [])
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
              onGoToQuest={startQuest}
            />
          }
        />
        <QuestSection
          ref={questPanelRef}
          places={places}
          passport={passport}
          checkIns={checkIns.states}
          activeId={activeQuestId}
          onStart={startQuest}
          onCheckIn={checkIns.run}
        />
        <PassportSection userId={userId} passport={passport} />
        <p id="map-selection-status" className="visually-hidden" role="status" aria-atomic="true">
          {mapAnnouncement?.text}
        </p>
        <p id="quest-status" className="visually-hidden" role="status" aria-atomic="true">
          {questAnnouncement && <span key={questAnnouncement.id}>{questAnnouncement.text}</span>}
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
