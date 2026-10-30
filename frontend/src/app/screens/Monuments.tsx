import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMonuments, getRoute, progressId, statusMap, typeLabel, useLoad, citySlug } from '../api'
import { MonumentCard } from '../components/MonumentCard'
import { GoldRule } from '../components/Ornament'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import './discover.css'

const RouteMap = lazy(() => import('../components/RouteMap'))

/** Eserler: şehir ve türe göre filtre, liste veya harita görünümü, oyundaki durum rozetleri. */
export default function Monuments() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { t } = useLang()
  const catalog = useLoad((s) => getMonuments(s), [])
  const uid = progressId(auth)
  const [type, setType] = useState('')
  const [city, setCity] = useState('')
  const [view, setView] = useState<'liste' | 'harita'>('liste')

  const all = catalog.data?.monuments ?? []
  // Kilit durumları her şehrin kendi rotasından gelir; bir rota yüklenemezse o şehrin eserleri yine listelenir.
  const slugs = [...new Set(all.map((m) => citySlug(m.city)))].sort().join(',')
  const routes = useLoad(
    (s) => Promise.all((slugs ? slugs.split(',') : []).map((c) => getRoute(c, uid, null, s).catch(() => null))),
    [uid, slugs],
  )
  const status = Object.assign({}, ...(routes.data ?? []).map(statusMap)) as ReturnType<typeof statusMap>
  const types = useMemo(() => [...new Set(all.map((m) => m.type))].sort((a, b) => a.localeCompare(b, 'tr')), [all])
  const cities = useMemo(() => [...new Set(all.map((m) => m.city))], [all])
  const shown = all.filter((m) => (!type || m.type === type) && (!city || citySlug(m.city) === city))

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <h1>{t('Eserler')}</h1>
        <GoldRule className="vk-page__rule" />
        <p>{t("Vakıf Eserleri Envanter Projesi'nde belgelenmiş eserler. Bir esere dokun, hikâyesini dinle.")}</p>
      </header>

      <div className="vk-filters">
        <label className="vk-filters__city">
          <span>{t('Şehir')}</span>
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">{t('Tüm şehirler')}</option>
            {cities.map((c) => (
              <option key={c} value={citySlug(c)}>{c}</option>
            ))}
          </select>
        </label>
        <div className="vk-chips" role="group" aria-label={t('Eser türü')}>
          {['', ...types].map((ty) => (
            <button key={ty || 'tumu'} type="button" className="vk-chip" aria-pressed={type === ty} onClick={() => setType(ty)}>
              {ty ? typeLabel(ty) : t('Tümü')}
            </button>
          ))}
        </div>
        <div className="vk-chips vk-chips--view" role="group" aria-label={t('Görünüm')}>
          {(['liste', 'harita'] as const).map((v) => (
            <button key={v} type="button" className="vk-chip" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'liste' ? t('Liste') : t('Harita')}
            </button>
          ))}
        </div>
      </div>

      {catalog.loading && <p className="vk-page__state" role="status">{t('Eserler yükleniyor…')}</p>}
      {catalog.error && (
        <p className="vk-page__state vk-page__state--error" role="alert">
          {t('Eserler yüklenemedi:')} {catalog.error} <button type="button" className="vk-link-btn" onClick={catalog.reload}>{t('Tekrar dene')}</button>
        </p>
      )}
      {catalog.data && (
        <>
          <h2 className="vk-sr-only">{t('Eser listesi')}</h2>
          <p className="vk-page__count" aria-live="polite">{t('{n} eser', { n: shown.length })}</p>
          {view === 'liste' ? (
            <div className="vk-grid">
              {shown.map((m) => (
                <MonumentCard key={m.monument_id} m={m} status={status[m.monument_id]} />
              ))}
            </div>
          ) : (
            <Suspense fallback={<p className="vk-page__state" role="status">{t('Harita yükleniyor…')}</p>}>
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
