import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatDistance, getRoute, progressId, typeLabel, useLoad } from '../api'
import { CITIES } from '../cities'
import { GoldRule } from '../components/Ornament'
import { StatusBadge } from '../components/StatusBadge'
import { useAuth } from '../session'
import './discover.css'

const RouteMap = lazy(() => import('../components/RouteMap'))

const START_LABEL = { user: 'Konumun', last_completed: 'Son tamamladığın eser', city_center: 'Şehir merkezi' } as const

/** Şehir rotası: en yakın rozetsiz eser önerilir; 3 eser açık, her bilgi mührü bir kilit açar. Kayıp Vakfiye ilerlemesi. */
export default function RoutePage() {
  const { city = '' } = useParams()
  const auth = useAuth()
  const navigate = useNavigate()
  const uid = progressId(auth)
  const [pos, setPos] = useState<{ latitude: number; longitude: number } | null>(null)
  const [geoNote, setGeoNote] = useState('')
  const route = useLoad((s) => getRoute(city, uid, pos, s), [city, uid, pos?.latitude, pos?.longitude])
  const cityName = CITIES.find((c) => c.slug === city)?.name ?? city

  function locate() {
    if (!('geolocation' in navigator)) return setGeoNote('Tarayıcın konum paylaşmayı desteklemiyor.')
    setGeoNote('Konum alınıyor…')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ latitude: p.coords.latitude, longitude: p.coords.longitude })
        setGeoNote('Rota konumuna göre güncellendi.')
      },
      () => setGeoNote('Konum alınamadı; rota şehir merkezine göre gösteriliyor.'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  const r = route.data
  const next = r?.stops.find((s) => s.monument_id === r.next)
  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">Kayıp Vakfiye · {cityName}</p>
        <h1>{cityName} rotası</h1>
        <GoldRule className="vk-page__rule" />
        {r && (
          <div className="vk-progress" aria-label={`Kayıp Vakfiye: ${r.total} parçadan ${r.completed_count} parça bulundu`}>
            <div className="vk-progress__pieces" aria-hidden="true">
              {Array.from({ length: r.total }, (_, i) => (
                <span key={i} className={i < r.completed_count ? 'is-found' : ''} />
              ))}
            </div>
            <span>{r.completed_count} / {r.total} vakfiye parçası</span>
          </div>
        )}
      </header>

      {route.loading && !r && <p className="vk-page__state" role="status">Rota hazırlanıyor…</p>}
      {route.error && (
        <p className="vk-page__state vk-page__state--error" role="alert">
          Rota yüklenemedi: {route.error} <button type="button" className="vk-link-btn" onClick={route.reload}>Tekrar dene</button>
        </p>
      )}

      {r && (
        <>
          {next ? (
            <section className="vk-next" aria-labelledby="siradaki">
              <p id="siradaki" className="vk-next__label">Sıradaki durak</p>
              <h2>{next.name}</h2>
              <p className="vk-next__meta">{typeLabel(next.type)} · {START_LABEL[r.start.source].toLocaleLowerCase('tr')} noktasından {formatDistance(next.distance_m)}</p>
              <Link to={`/eser/${encodeURIComponent(next.monument_id)}`} className="vk-btn">Eseri aç</Link>
            </section>
          ) : (
            r.completed_count === r.total && (
              <section className="vk-next">
                <h2>Kayıp Vakfiye tamamlandı</h2>
                <p>Bu şehirdeki bütün vakfiye parçalarını buldun.</p>
              </section>
            )
          )}

          <div className="vk-route">
            <div className="vk-route__map">
              <Suspense fallback={<p className="vk-page__state" role="status">Harita yükleniyor…</p>}>
                <RouteMap
                  points={[
                    ...r.stops.map((s) => ({ id: s.monument_id, name: s.name, lat: s.latitude, lng: s.longitude, status: s.state, order: s.order, next: s.monument_id === r.next })),
                  ]}
                  path={[[r.start.latitude, r.start.longitude], ...r.stops.map((s) => [s.latitude, s.longitude] as [number, number])]}
                  start={{ lat: r.start.latitude, lng: r.start.longitude, label: START_LABEL[r.start.source] }}
                  onSelect={(id) => navigate(`/eser/${encodeURIComponent(id)}`)}
                />
              </Suspense>
              <div className="vk-route__geo">
                <button type="button" className="vk-btn vk-btn--ghost" onClick={locate}>Konumumu kullan</button>
                {geoNote && <p role="status">{geoNote}</p>}
              </div>
            </div>

            <ol className="vk-stops" aria-label="Rota durakları">
              {r.stops.map((s) => (
                <li key={s.monument_id} className={`vk-stop vk-stop--${s.state}${s.monument_id === r.next ? ' vk-stop--next' : ''}`}>
                  <span className="vk-stop__order" aria-hidden="true">{s.order}</span>
                  <Link to={`/eser/${encodeURIComponent(s.monument_id)}`} className="vk-stop__link">
                    <span className="vk-stop__name">{s.name}</span>
                    <span className="vk-stop__meta">{typeLabel(s.type)} · {formatDistance(s.distance_m)}</span>
                  </Link>
                  <StatusBadge status={s.state} />
                </li>
              ))}
            </ol>
          </div>

          {r.completed.length > 0 && (
            <section className="vk-done" aria-labelledby="tamamlanan">
              <h2 id="tamamlanan">Bulunan parçalar</h2>
              <ul>
                {r.completed.map((c) => (
                  <li key={c.monument_id}>
                    <Link to={`/eser/${encodeURIComponent(c.monument_id)}`}>{c.name}</Link>
                    <StatusBadge status={c.visit ? 'gold' : 'completed'} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
