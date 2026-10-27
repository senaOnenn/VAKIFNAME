import '../styles.css'
import { forwardRef, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiErrorMessage } from '../components/ApiErrorMessage'
import { ArchitectureDrawing, drawingVariantFor } from '../components/ArchitectureDrawing'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Header, type NavLink } from '../components/Header'
import { PassportIntro, StorySection } from '../components/HomeSections'
import { HowItWorks, type Step } from '../components/HowItWorks'
import { AlertIcon, MapPinIcon } from '../components/Icons'
import { VideoHero } from '../components/VideoHero'
import { useApi } from '../hooks/useApi'
import { useSelectedPlace } from '../hooks/useSelectedPlace'
import { getVisitorId } from '../visitor'
import { getMonument, getMonuments, getSeals, mediaUrl, PROGRESS_EVENT } from './catalogClient'
import type { LocatedMonument } from './MonumentMap'
import { licenseName, MonumentStory } from './MonumentStory'
import './monument-story.css'
import type { MonumentDetail, MonumentSummary } from './types'

// Leaflet ayrı parçada yüklenir; harita yüklenemezse liste ve ayrıntılar çalışmaya devam eder.
const MonumentMap = lazy(() => import('./MonumentMap'))

const HOME_LINKS: NavLink[] = [
  { href: '#katalog', label: 'Eserler' },
  { href: '#katalog-harita', label: 'Harita' },
  { href: '#hikaye', label: 'Hikâye' },
  { href: '#pasaport-tanitim', label: 'Pasaport' },
]

// Genel platformun akışı: yalnızca onaylı içerik; görev ve mühür ancak konum görevi onaylanan eserlerde.
const PLATFORM_STEPS: Step[] = [
  {
    title: 'Bir eser keşfet.',
    text: 'Yayın onaylı Bursa eserlerini listeden ya da haritadan seç. Kimliği resmî kaynaklarla doğrulanmış eserler gösterilir.',
  },
  {
    title: 'Kaynağıyla oku.',
    text: 'Tarihî bilgiler bağımsız resmî ve bilimsel kaynaklarla doğrulanıp editör onayıyla, kaynak bağlantılarıyla eklenir.',
  },
  {
    title: 'Mührünü topla.',
    text: 'Keşif sorularını çöz, bilgi mührünü kazan. Ziyaret mührü ise yalnızca GPS noktası onaylı eserlerde yerinde verilir.',
  },
]

const isLocated = (m: MonumentSummary): m is LocatedMonument => m.location !== null

function MapPlaceholder({ children }: { children: ReactNode }) {
  return <div className="place-map place-map--placeholder">{children}</div>
}

/**
 * Onaylı harita kaydı yokken büyük boş harita kutusu yerine gösterilir. Haritanın neden boş olduğunu anlatır ve
 * kataloğa döndürür. Doğrulanmamış hiçbir konum (tahmini nokta, araştırma adayı) burada gösterilmez.
 */
function MapEmptyState({ monumentCount }: { monumentCount: number }) {
  return (
    <div className="map-empty" role="status" aria-labelledby="map-empty-title">
      <MapPinIcon className="map-empty__icon" />
      <div>
        <p id="map-empty-title" className="map-empty__title">
          Haritada henüz onaylı konum yok
        </p>
        <p>
          Bir eser haritaya ancak konumu kaynaklarla karşılaştırılıp bir konum incelemecisi tarafından doğrulandıktan ve
          haritada gösterilmesi ayrıca onaylandıktan sonra eklenir. Bursa’daki eserlerin koordinatları şu anda bu
          incelemeden geçiyor; yanlış yere işaret koymamak için tahmini nokta gösterilmez.
        </p>
        <p>
          {monumentCount > 0
            ? `${monumentCount} yayımlanmış eser kataloğda konumsuz olarak listeleniyor.`
            : 'Yayımlanan eserler önce katalogda görünür; konumu onaylananlar haritaya da eklenir.'}{' '}
          <a href="#katalog">Keşif kataloğuna dön</a>
        </p>
      </div>
    </div>
  )
}

function EmptyCatalog() {
  return (
    <div className="notice notice--warning" role="status">
      <AlertIcon className="notice__icon" />
      <div>
        <p className="notice__title">Henüz yayımlanmış gerçek eser yok</p>
        <p>
          Bir eser, yetkili bir editör kimliğini (ad, tür, adres) resmî kaynaklarla doğrulayıp yayın kararı verdiğinde
          burada görünür. Tarihî bilgiler, fotoğraflar ve harita konumu ayrı onaylarla eklenir. Şu anda bu onayı almış
          eser yok; inceleme bekleyen kayıtlar bu sayfaya alınmaz.
        </p>
      </div>
    </div>
  )
}

/** Ziyaretçinin mühürleri; keşif sorusu çözüldüğünde (PROGRESS_EVENT) yenilenir. */
function useSeals() {
  const [visitorId] = useState(getVisitorId)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    window.addEventListener(PROGRESS_EVENT, bump)
    return () => window.removeEventListener(PROGRESS_EVENT, bump)
  }, [])
  return useApi((signal) => getSeals(visitorId, signal), `seals:${visitorId}:${version}`)
}

function MonumentCard({
  monument,
  index,
  selected,
  onSelect,
  sealed,
}: {
  monument: MonumentSummary
  index: number
  selected: boolean
  onSelect: (id: string) => void
  sealed: boolean
}) {
  const headingId = `monument-title-${monument.monument_id}`
  const cover = monument.cover
  return (
    <article className={`place-card${selected ? ' place-card--selected' : ''}`} aria-labelledby={headingId}>
      {cover ? (
        <div className="place-card__photo">
          <img src={mediaUrl(cover.file)} alt={`${monument.name} fotoğrafı`} loading="lazy" decoding="async" />
          <span className="place-card__credit">
            {cover.attribution ?? `Fotoğraf · ${licenseName(cover.license)}`}
          </span>
        </div>
      ) : (
        <div className="place-card__visual">
          <ArchitectureDrawing variant={drawingVariantFor(index)} />
          <span className="art-label">Temsilî çizim · Eser fotoğrafı değildir</span>
        </div>
      )}
      <div className="place-card__body">
        <div className="place-card__meta">
          <span className="place-card__city">
            <MapPinIcon />
            {monument.district}, {monument.city}
          </span>
          <span className="badge">{monument.type}</span>
        </div>
        <h3 id={headingId} className="place-card__title">
          {monument.name}
        </h3>
        <p className="place-card__description">{monument.address}</p>
        {monument.lead && <p className="place-card__lead">{monument.lead}</p>}
        <p className="place-card__chips">
          <span>{monument.fact_count} onaylı bilgi</span>
          {(monument.quest_count ?? 0) > 0 && <span>{monument.quest_count} keşif sorusu</span>}
          {monument.image_count > 0 && <span>{monument.image_count} fotoğraf</span>}
          {monument.location === null && <span>Konum henüz haritada yok</span>}
          {sealed && <span className="chip--seal">Bilgi mührü kazanıldı</span>}
        </p>
        <button
          id={`monument-card-${monument.monument_id}`}
          type="button"
          className="button button--primary place-card__action"
          aria-label={`Ayrıntıları gör: ${monument.name}`}
          aria-pressed={selected}
          onClick={() => onSelect(monument.monument_id)}
        >
          Hikâyeyi ve görevi aç <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  )
}

function QuestStatus({ m }: { m: MonumentDetail }) {
  const quests = m.quests?.length ?? 0
  if (!m.checkin_available) {
    return (
      <p className="catalog-detail__quest">
        {quests > 0 ? `Uzaktan keşif görevi açık: ${quests} soru. ` : ''}
        Fiziksel ziyaret mührü bu eserde henüz açık değil; güvenli ve herkese açık bir giriş noktası sahada doğrulanınca
        açılır.
      </p>
    )
  }
  return (
    <p className="catalog-detail__quest">
      Konum görevi onaylı: herkese açık nokta, {Math.round(m.checkin!.radius_m)} m yarıçap.{' '}
      {m.checkin!.access_hours_note} {m.checkin!.safety_note}
    </p>
  )
}

const MonumentDetailPanel = forwardRef<
  HTMLElement,
  { monumentId: string | null; onClose: () => void; onOpenStory: () => void; onAsk: () => void }
>(
  function MonumentDetailPanel({ monumentId, onClose, onOpenStory, onAsk }, ref) {
    const detail = useApi(
      (signal) => (monumentId ? getMonument(monumentId, signal) : Promise.resolve(null)),
      `monument:${monumentId}`,
    )
    return (
      <aside ref={ref} tabIndex={-1} className="detail-panel" aria-label="Eser ayrıntıları">
        {!monumentId && (
          <div className="detail-panel__empty">
            <p>Ayrıntılarını görmek için listeden ya da haritadan bir eser seç.</p>
          </div>
        )}
        {monumentId && detail.status === 'loading' && <p role="status">Eser yükleniyor…</p>}
        {monumentId && detail.status === 'error' && (
          <ApiErrorMessage
            title={detail.error.status === 404 ? 'Eser bulunamadı veya yayımlanmadı' : 'Eser yüklenemedi'}
            error={detail.error}
            onRetry={detail.reload}
          />
        )}
        {monumentId && detail.status === 'success' && detail.data && (
          <div className="detail catalog-detail">
            {detail.data.images[0] && (
              <figure className="detail-panel__cover">
                <img src={mediaUrl(detail.data.images[0].card_file ?? detail.data.images[0].file)} alt={`${detail.data.name} fotoğrafı`} />
                <figcaption>{detail.data.images[0].attribution}</figcaption>
              </figure>
            )}
            <div className="detail__header">
              <h3 className="detail__title">{detail.data.name}</h3>
              <button type="button" className="button button--secondary" onClick={onClose}>
                Kapat
              </button>
            </div>
            <p className="catalog-detail__meta">
              {detail.data.type} · {detail.data.address} · {detail.data.district}, {detail.data.city}
            </p>
            {detail.data.site_notice && <p className="notice">{detail.data.site_notice}</p>}
            <p className="catalog-detail__meta">
              {detail.data.location
                ? `Haritadaki nokta doğrulanmış yapı konumudur (yaklaşık ±${Math.round(detail.data.location.accuracy_m)} m).`
                : 'Konum henüz doğrulanmadı; eser haritada gösterilmiyor.'}
            </p>
            <QuestStatus m={detail.data} />
            <p className="catalog-detail__meta">
              {detail.data.facts.length} kaynaklı bilgi · {detail.data.quests?.length ?? 0} keşif sorusu ·{' '}
              {detail.data.images.length} lisanslı fotoğraf
            </p>
            <div className="catalog-detail__actions">
              <button type="button" className="button button--primary" onClick={onOpenStory}>
                Hikâyeyi ve keşif görevini aç
              </button>
              <button type="button" className="button button--secondary" onClick={onAsk}>
                Esere sor
              </button>
            </div>
          </div>
        )}
      </aside>
    )
  },
)

/** Gerçek Bursa Eserleri: yalnızca yayın onaylı kayıtlar. Ana uygulamanın hedeflenen kataloğu. */
export default function CatalogApp() {
  const catalog = useApi(getMonuments, 'monuments')
  const seals = useSeals()
  const sealed = new Set(seals.status === 'success' ? seals.data.knowledge_seals.map((s) => s.monument_id) : [])
  const [selectedId, select] = useSelectedPlace()
  const [storyOpen, setStoryOpen] = useState(false)
  const [tileError, setTileError] = useState(false)
  const detailRef = useRef<HTMLElement>(null)
  const located = catalog.status === 'success' ? catalog.data.monuments.filter(isLocated) : []
  const unlocated = catalog.status === 'success' ? catalog.data.monuments.length - located.length : 0

  const choose = useCallback(
    (id: string) => {
      select(id)
      detailRef.current?.focus({ preventScroll: true })
    },
    [select],
  )
  const openStory = useCallback(
    (id: string, target: 'eser-hikayesi' | 'esere-sor' = 'eser-hikayesi') => {
      select(id)
      setStoryOpen(true)
      // Hikâye bölümü eser yüklenince oluşur; hedef görünene kadar kısa aralıklarla denenir.
      let tries = 0
      const scroll = () => {
        const el = document.getElementById(target)
        if (el) {
          el.scrollIntoView?.({ behavior: 'smooth' })
          if (target === 'esere-sor') el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
        } else if (tries++ < 40) window.setTimeout(scroll, 100)
      }
      window.setTimeout(scroll, 50)
    },
    [select],
  )
  const close = useCallback(() => {
    const previous = selectedId
    select(null)
    setStoryOpen(false)
    if (previous) document.getElementById(`monument-card-${previous}`)?.focus()
  }, [select, selectedId])
  useEffect(() => {
    if (selectedId) detailRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  let map: ReactNode
  if (catalog.status !== 'success') {
    map = <MapPlaceholder>Harita, eserler yüklendikten sonra gösterilecek…</MapPlaceholder>
  } else if (located.length === 0) {
    map = null
  } else {
    map = (
      <ErrorBoundary fallback={<MapPlaceholder>Harita şu anda gösterilemiyor.</MapPlaceholder>}>
        <Suspense fallback={<MapPlaceholder>Harita yükleniyor…</MapPlaceholder>}>
          <MonumentMap monuments={located} selectedId={selectedId} onSelect={choose} onTileError={() => setTileError(true)} />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <>
      <a className="skip-link" href="#katalog">
        İçeriğe geç
      </a>
      <Header links={HOME_LINKS} subtitle="Gerçek Bursa Eserleri" />
      <main id="top">
        <VideoHero />
        <HowItWorks steps={PLATFORM_STEPS} lead="VAKIFNAME nasıl çalışır?" />
        <section id="katalog" className="section" aria-labelledby="katalog-title">
          <div className="container">
            <header className="section__header">
              <h2 id="katalog-title" className="section__title">
                Gerçek Bursa Eserleri
              </h2>
              <p className="section__lead">
                Kimliği resmî kaynaklarla doğrulanmış, editör onaylı eserler. Her bilgi bağımsız kaynak bağlantısıyla, her
                fotoğraf yazarı ve lisansıyla gösterilir.
              </p>
            </header>
            {catalog.status === 'loading' && (
              <p className="notice" role="status">
                Katalog yükleniyor…
              </p>
            )}
            {catalog.status === 'error' && (
              <ApiErrorMessage title="Katalog yüklenemedi" error={catalog.error} onRetry={catalog.reload} />
            )}
            {catalog.status === 'success' && catalog.data.monuments.length === 0 && <EmptyCatalog />}
            {catalog.status === 'success' && catalog.data.monuments.length > 0 && (
              <ul className="card-grid" aria-label="Gerçek eser listesi">
                {catalog.data.monuments.map((m, i) => (
                  <li key={m.monument_id}>
                    <MonumentCard
                      monument={m}
                      index={i}
                      selected={m.monument_id === selectedId}
                      onSelect={openStory}
                      sealed={sealed.has(m.monument_id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section id="katalog-harita" className="section section--alt" aria-labelledby="katalog-harita-title">
          <div className="container">
            <header className="section__header">
              <h2 id="katalog-harita-title" className="section__title">
                Bursa Keşif Haritası
              </h2>
              <p className="section__lead">Yalnızca konumu doğrulanmış ve haritada gösterilmesi onaylanmış eserler.</p>
            </header>
            {unlocated > 0 && located.length > 0 && (
              <p className="notice" role="note">
                {unlocated} eserin konumu henüz doğrulanmadığı için haritada işaretlenmedi; tahmini nokta gösterilmez.
              </p>
            )}
            {tileError && (
              <p className="notice" role="status">
                Harita altlığı yüklenemedi; eser listesi ve ayrıntılar çalışmaya devam ediyor.
              </p>
            )}
            {map === null ? (
              <div className={catalog.status === 'success' && catalog.data.monuments.length > 0 ? 'map-layout' : undefined}>
                <MapEmptyState monumentCount={catalog.status === 'success' ? catalog.data.monuments.length : 0} />
                {catalog.status === 'success' && catalog.data.monuments.length > 0 && (
                  <MonumentDetailPanel
                    ref={detailRef}
                    monumentId={selectedId}
                    onClose={close}
                    onOpenStory={() => selectedId && openStory(selectedId)}
                    onAsk={() => selectedId && openStory(selectedId, 'esere-sor')}
                  />
                )}
              </div>
            ) : (
              <div className="map-layout">
                <div className="map-frame" role="region" aria-label="Gerçek eser haritası">
                  {map}
                </div>
                <MonumentDetailPanel
                    ref={detailRef}
                    monumentId={selectedId}
                    onClose={close}
                    onOpenStory={() => selectedId && openStory(selectedId)}
                    onAsk={() => selectedId && openStory(selectedId, 'esere-sor')}
                  />
              </div>
            )}
          </div>
        </section>
        {storyOpen && selectedId && catalog.status === 'success' && (
          <MonumentStory
            key={selectedId}
            monumentId={selectedId}
            index={Math.max(0, catalog.data.monuments.findIndex((m) => m.monument_id === selectedId))}
            onClose={close}
          />
        )}
        <StorySection />
        <PassportIntro />
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
              {HOME_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="site-footer__heading">Bilgi, kaynağıyla değerlidir.</p>
            <p className="site-footer__note">
              Giriş videosu ve çizimler temsilîdir, eser fotoğrafı değildir. Yalnızca yayın onaylı kayıtlar gösterilir.
              Harita verileri © OpenStreetMap katkıcıları.
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
