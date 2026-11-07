import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatDistance, getRoute, progressId, typeLabel, useLoad } from '../api'
import { CITIES } from '../cities'
import { RouteLedger, SealTally } from '../components/GameParts'
import { nameOf } from '../contentLang'
import { gamePath, rememberGameCity } from '../gameCity'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import './discover.css'
import './route-page.css'

const RouteMap = lazy(() => import('../components/RouteMap'))

const START_LABEL = { user: 'Konumun', last_completed: 'Son tamamladığın eser', city_center: 'Şehir merkezi' } as const
// Sıradaki durağın uzaklığı hangi noktadan ölçüldü (çevrilebilir tam cümle parçası).
const START_FROM = {
  user: 'konumun noktasından {d}',
  last_completed: 'son tamamladığın eser noktasından {d}',
  city_center: 'şehir merkezi noktasından {d}',
} as const

/**
 * Şehir rotası (R6.5, R6.7): harita ve parşömen üzerinde eserler defteri. Kilit yok: bütün eserler seçilebilir; en yakın
 * eser yalnızca öneridir. Her satır eserin görev ekranına gider. Kurallar sunucudadır.
 */
export default function RoutePage() {
  const { city = '' } = useParams()
  const auth = useAuth()
  const navigate = useNavigate()
  const { t, lang } = useLang()
  const uid = progressId(auth)
  const [pos, setPos] = useState<{ latitude: number; longitude: number } | null>(null)
  const [geoNote, setGeoNote] = useState('')
  const route = useLoad((s) => getRoute(city, uid, pos, s), [city, uid, pos?.latitude, pos?.longitude])
  const cityName = CITIES.find((c) => c.slug === city)?.name ?? city
  // Oyun girişi ve oyun menüsü son açılan rotaya döner.
  useEffect(() => {
    if (city) rememberGameCity(city)
  }, [city])

  function locate() {
    if (!('geolocation' in navigator)) return setGeoNote(t('Tarayıcın konum paylaşmayı desteklemiyor.'))
    setGeoNote(t('Konum alınıyor…'))
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ latitude: p.coords.latitude, longitude: p.coords.longitude })
        setGeoNote(t('Rota konumuna göre güncellendi.'))
      },
      () => setGeoNote(t('Konum alınamadı; rota şehir merkezine göre gösteriliyor.')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  const r = route.data
  const next = r?.stops.find((s) => s.monument_id === r.next)
  return (
    <main className="vk-routepage">
      <header className="vk-routepage__head">
        <p className="vk-routepage__eyebrow">{t('Kayıp Vakfiye')} · {cityName}</p>
        <h1>{t('{city} rotası', { city: cityName })}</h1>
        {r && (
          <p className="vk-routepage__count" aria-label={t('Kayıp Vakfiye: {total} parçadan {found} parça bulundu', { total: r.total, found: r.completed_count })}>
            {t('{found} / {total} vakfiye parçası', { found: r.completed_count, total: r.total })}
          </p>
        )}
      </header>

      {route.loading && !r && <p className="vk-page__state" role="status">{t('Rota hazırlanıyor…')}</p>}
      {route.error && (
        <p className="vk-page__state vk-page__state--error" role="alert">
          {t('Rota yüklenemedi:')} {route.error} <button type="button" className="vk-link-btn" onClick={route.reload}>{t('Tekrar dene')}</button>
        </p>
      )}

      {r && (
        <div className="vk-routepage__grid">
          <div className="vk-routepage__map">
            <Suspense fallback={<p className="vk-page__state" role="status">{t('Harita yükleniyor…')}</p>}>
              <RouteMap
                points={r.stops.map((s) => ({ id: s.monument_id, name: nameOf(s, lang), lat: s.latitude, lng: s.longitude, status: s.state, order: s.order, next: s.monument_id === r.next }))}
                path={[[r.start.latitude, r.start.longitude], ...r.stops.map((s) => [s.latitude, s.longitude] as [number, number])]}
                start={{ lat: r.start.latitude, lng: r.start.longitude, label: t(START_LABEL[r.start.source]) }}
                onSelect={(id) => navigate(gamePath.monument(id))}
              />
            </Suspense>
            <div className="vk-routepage__geo">
              <button type="button" className="vk-btn vk-btn--ghost" onClick={locate}>{t('Konumumu kullan')}</button>
              {geoNote && <p role="status">{geoNote}</p>}
            </div>
          </div>

          <article className="vk-folio vk-routepage__folio">
            {next ? (
              <section className="vk-routepage__next" aria-labelledby="siradaki">
                <p id="siradaki" className="vk-folio__eyebrow">{t('Sıradaki durak')}</p>
                <h2 className="vk-folio__h">{nameOf(next, lang)}</h2>
                <p className="vk-routepage__meta">{typeLabel(next.type)} · {t(START_FROM[r.start.source], { d: formatDistance(next.distance_m) })}</p>
                <div className="vk-routepage__actions">
                  <Link to={gamePath.monument(next.monument_id)} className="vk-waxbtn">{t('Göreve Başla')}</Link>
                  <Link to={`/eser/${encodeURIComponent(next.monument_id)}`} className="vk-routepage__link">{t('Eseri aç')}</Link>
                </div>
              </section>
            ) : (
              r.completed_count === r.total && (
                <section className="vk-routepage__next">
                  <h2 className="vk-folio__h">{t('Kayıp Vakfiye tamamlandı')}</h2>
                  <p>{t('Bu şehirdeki bütün vakfiye parçalarını buldun.')}</p>
                </section>
              )
            )}
            <section className="vk-routepage__ledger" aria-labelledby="duraklar">
              <h2 id="duraklar" className="vk-folio__h">{t('Rota defteri')}</h2>
              <p className="vk-folio__note">
                {t('Bütün eserler açık. Önerilen sıra en yakın eserden başlar; dilediğin eserle başlayabilirsin.')}
              </p>
              <RouteLedger route={r} label={t('Rota durakları')} />
            </section>
            <section className="vk-routepage__seals" aria-labelledby="muhurler-r">
              <h2 id="muhurler-r" className="vk-folio__h">{t('Mühür Defteri')}</h2>
              <SealTally knowledge={r.completed_count} gold={r.completed.filter((c) => c.visit).length} total={r.total} />
            </section>
          </article>
        </div>
      )}
    </main>
  )
}
