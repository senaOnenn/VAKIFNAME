import './demo.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPassport, getPlaces } from '../api/client'
import type { Place } from '../api/types'
import { describeApiError } from '../components/ApiErrorMessage'
import { Header } from '../components/Header'
import { Hero } from '../components/Hero'
import { HowItWorks, type Step } from '../components/HowItWorks'
import { MapSection } from '../components/MapSection'
import { cardButtonId } from '../components/PlaceCard'
import { PlaceDetail } from '../components/PlaceDetail'
import { PlaceList } from '../components/PlaceList'
import { PassportSection } from '../components/PassportSection'
import { QuestSection } from '../components/QuestSection'
import { checkInOutcome, type CheckInOutcome } from '../components/questStatus'
import { getDemoUserId } from '../demoUser'
import { useApi } from '../hooks/useApi'
import { useCheckIn, type CheckInState } from '../hooks/useCheckIn'
import { useSelectedPlace } from '../hooks/useSelectedPlace'

/*
 * Demo Keşif Oyunu (kurgusal test mekânları). Yalnızca geliştirme sunucusunda ve otomatik testlerde yüklenir
 * (`dev/DevModes.tsx`); üretim derlemesine girmez ve genel platformun parçası değildir.
 */

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

/** Check-in sonucu için ekran okuyucu metni; paneldeki uzlaştırılmış sonuçla aynı durumu bildirir. */
function checkInMessage(place: Place, outcome: CheckInOutcome, result?: CheckInState): string {
  const reason = result?.status === 'error' ? ` ${describeApiError(result.error)}` : ''
  switch (outcome) {
    case 'pending':
      return ''
    case 'verifying':
      return `${place.name}: check-in yanıtı alınamadı. İşlem sonucu doğrulanamadı, pasaport kontrol ediliyor.${reason}`
    case 'unknown':
      return `${place.name}: işlem sonucu doğrulanamadı. Check-in yanıtı alınamadı ve pasaport yüklenemedi; mührün eklenip eklenmediği bilinmiyor.${reason}`
    case 'not-earned':
      return `${place.name}: check-in tamamlanamadı. Pasaport kontrol edildi, bu eser için mühür yok.${reason}`
    case 'confirmed':
      return `${place.name}: check-in yanıtı alınamadı, ancak pasaport görevin tamamlandığını doğruladı.`
    case 'earned':
      return `${place.name} görevi tamamlandı. Pasaportuna mühür eklendi.`
    case 'already':
      return `${place.name} görevi daha önce tamamlanmıştı. Yeni mühür eklenmedi.`
    case 'earned-unverified':
      return `${place.name}: check-in onaylandı, ancak pasaport yenilenemedi.`
    case 'stale':
      return `${place.name}: check-in onaylanmıştı, ancak güncel pasaportta bu mühür görünmüyor.`
    case 'out-of-range':
      return `${place.name}: konum görev alanı dışında. Görev tamamlanmadı, mühür kazanılmadı.`
  }
}

/** Demo Keşif Oyunu: kurgusal test mekânları, harita, check-in, görevler, mühür ve pasaport. */
const DEMO_STEPS: Step[] = [
  {
    title: 'Bir eser keşfet.',
    text: 'Listeden ya da haritadan bir eser seç; ayrıntılarını ve görev alanını incele.',
  },
  {
    title: 'Görevini tamamla.',
    text: 'Eserin görev alanında demo check-in yap. Sonuç yalnızca backend onaylarsa kabul edilir.',
  },
  {
    title: 'Mührünü topla.',
    text: 'Kazandığın her mühür dijital pasaportuna eklenir; kayıp vakfiyenin izini mühür mühür sür.',
  },
]

export default function DemoGame() {
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

  // Sonucu duyurulmayı bekleyen check-in'ler. Son durum, check-in'den sonra yeniden yüklenen pasaportla birlikte duyurulur.
  const [awaitingAnnouncement, setAwaitingAnnouncement] = useState<string[]>([])
  const announceQuest = useCallback(
    (text: string) => setQuestAnnouncement((prev) => ({ id: (prev?.id ?? 0) + 1, text })),
    [],
  )

  const onCheckInSettled = useCallback(
    (placeId: string, result: CheckInState) => {
      // Pasaport her denemeden sonra backend'den yeniden okunur; mühür arayüzde tahminle eklenmez.
      reloadPassport()
      setAwaitingAnnouncement((ids) => (ids.includes(placeId) ? ids : [...ids, placeId]))
      const place = places.status === 'success' ? places.data.find((p) => p.id === placeId) : undefined
      if (place && result.status === 'error') announceQuest(checkInMessage(place, 'verifying', result))
    },
    [reloadPassport, places, announceQuest],
  )
  const checkIns = useCheckIn(userId, onCheckInSettled)

  useEffect(() => {
    if (awaitingAnnouncement.length === 0 || passport.status === 'loading' || places.status !== 'success') return
    const messages = awaitingAnnouncement.flatMap((placeId) => {
      const place = places.data.find((p) => p.id === placeId)
      const result = checkIns.states[placeId]
      if (!place || !result || result.status === 'pending') return []
      return [checkInMessage(place, checkInOutcome(placeId, passport, result), result)]
    })
    setAwaitingAnnouncement([])
    if (messages.length) announceQuest(messages.join(' '))
  }, [awaitingAnnouncement, passport, places, checkIns.states, announceQuest])

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
        <HowItWorks steps={DEMO_STEPS} lead="VAKIFNAME nasıl oynanır?" />
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
          onReloadPassport={reloadPassport}
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
        <div className="container site-footer__grid">
          <div>
            <p className="site-footer__brand">VAKIFNAME</p>
            <p>Geçmişin İzinde, Bilginin Işığında.</p>
            <p className="site-footer__note">Team HisGuard · KÖK &amp; KOD Hackathonu</p>
          </div>
          <nav aria-label="Alt menü">
            <p className="site-footer__heading">Keşfetmeye devam et</p>
            <ul className="site-footer__links">
              <li>
                <a href="#kesfet">Eserler</a>
              </li>
              <li>
                <a href="#gorevler">Görevler</a>
              </li>
              <li>
                <a href="#pasaport">Dijital pasaport</a>
              </li>
            </ul>
          </nav>
          <div>
            <p className="site-footer__heading">Bilgi, kaynağıyla değerlidir.</p>
            <p className="site-footer__note">
              Kurgusal demo kayıtları arayüzde açıkça etiketlenir. Çizimler temsilidir, eser fotoğrafı değildir. Harita
              verileri © OpenStreetMap katkıcıları.
            </p>
          </div>
          <p className="site-footer__wordmark" aria-hidden="true">
            VAKIFNAME
          </p>
        </div>
      </footer>
    </>
  )
}
