import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMonuments, getRoute, progressId, statusMap, typeLabel, useLoad, citySlug } from '../api'
import { MonumentCard } from '../components/MonumentCard'
import { GoldRule } from '../components/Ornament'
import { useAuth } from '../session'
import './discover.css'

const RouteMap = lazy(() => import('../components/RouteMap'))

/** Eserler: şehir ve türe göre filtre, liste veya harita görünümü, oyundaki durum rozetleri. */
export default function Monuments() {
  const auth = useAuth()
  const navigate = useNavigate()
  const catalog = useLoad((s) => getMonuments(s), [])
  const uid = progressId(auth)
  // Kilit durumları Bursa rotasından gelir; rota yüklenemezse eserler yine listelenir.
  const route = useLoad((s) => getRoute('bursa', uid, null, s).catch(() => null), [uid])
  const status = statusMap(route.data)
  const [type, setType] = useState('')
  const [city, setCity] = useState('')
  const [view, setView] = useState<'liste' | 'harita'>('liste')

  const all = catalog.data?.monuments ?? []
  const types = useMemo(() => [...new Set(all.map((m) => m.type))].sort((a, b) => a.localeCompare(b, 'tr')), [all])
  const cities = useMemo(() => [...new Set(all.map((m) => m.city))], [all])
  const shown = all.filter((m) => (!type || m.type === type) && (!city || citySlug(m.city) === city))

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <h1>Eserler</h1>
        <GoldRule className="vk-page__rule" />
        <p>Vakıf Eserleri Envanter Projesi'nde belgelenmiş eserler. Bir esere dokun, hikâyesini dinle.</p>
      </header>

      <div className="vk-filters">
        <label className="vk-filters__city">
          <span>Şehir</span>
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Tüm şehirler</option>
            {cities.map((c) => (
              <option key={c} value={citySlug(c)}>{c}</option>
            ))}
          </select>
        </label>
        <div className="vk-chips" role="group" aria-label="Eser türü">
          {['', ...types].map((t) => (
            <button key={t || 'tumu'} type="button" className="vk-chip" aria-pressed={type === t} onClick={() => setType(t)}>
              {t ? typeLabel(t) : 'Tümü'}
            </button>
          ))}
        </div>
        <div className="vk-chips vk-chips--view" role="group" aria-label="Görünüm">
          {(['liste', 'harita'] as const).map((v) => (
            <button key={v} type="button" className="vk-chip" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'liste' ? 'Liste' : 'Harita'}
            </button>
          ))}
        </div>
      </div>

      {catalog.loading && <p className="vk-page__state" role="status">Eserler yükleniyor…</p>}
      {catalog.error && (
        <p className="vk-page__state vk-page__state--error" role="alert">
          Eserler yüklenemedi: {catalog.error} <button type="button" className="vk-link-btn" onClick={catalog.reload}>Tekrar dene</button>
        </p>
      )}
      {catalog.data && (
        <>
          <p className="vk-page__count" aria-live="polite">{shown.length} eser</p>
          {view === 'liste' ? (
            <div className="vk-grid">
              {shown.map((m) => (
                <MonumentCard key={m.monument_id} m={m} status={status[m.monument_id]} />
              ))}
            </div>
          ) : (
            <Suspense fallback={<p className="vk-page__state" role="status">Harita yükleniyor…</p>}>
              <RouteMap
                points={shown.filter((m) => m.location).map((m) => ({
                  id: m.monument_id, name: m.name, lat: m.location!.latitude, lng: m.location!.longitude, status: status[m.monument_id],
                }))}
                onSelect={(id) => navigate(`/eser/${encodeURIComponent(id)}`)}
              />
            </Suspense>
          )}
        </>
      )}
    </main>
  )
}
