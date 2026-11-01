import { Link } from 'react-router-dom'
import { citySlug, getGame, getMonuments, getRoute, progressId, typeLabel, useLoad, type GameState } from '../api'
import { CITIES, withCatalog } from '../cities'
import { GoldRule } from '../components/Ornament'
import { Seal } from '../components/Seal'
import { nameOf } from '../contentLang'
import { gamePath, lastGameCity } from '../gameCity'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import './discover.css'
import './game-home.css'

/** Eserin mühür yolunda sıradaki adım (kurallar sunucudadır; burada yalnızca durum okunur). */
function stepOf(g: GameState): { n: string; label: string } {
  if (g.visit) return { n: '✓', label: 'Altın mühür alındı' }
  if (g.knowledge) return { n: 'III', label: 'Eseri ziyaret et, altın mühür al' }
  if (g.ready_for_quiz) return { n: 'II', label: 'Rozeti Al soruları seni bekliyor' }
  return { n: 'I', label: 'Rehberin anlatımını dinle ve bir soru sor' }
}

/**
 * Oyun girişi: oyunun ne olduğu, devam eden görev, Kayıp Vakfiye ilerlemesi ve mevcut oyunlara erişim. Yeni kural
 * yoktur; rota, mühür yolu ve sorular aynen kullanılır.
 */
export default function GameHome() {
  const auth = useAuth()
  const { t, lang } = useLang()
  const uid = progressId(auth)
  const catalog = useLoad((s) => getMonuments(s), [])
  const cities = withCatalog(CITIES, catalog.data ? catalog.data.monuments.map((m) => m.city) : null, citySlug).filter((c) => c.open)
  const remembered = lastGameCity()
  const city = catalog.data ? (cities.find((c) => c.slug === remembered) ?? cities[0])?.slug ?? '' : ''
  const route = useLoad((s) => (city ? getRoute(city, uid, null, s) : Promise.resolve(null)), [city, uid])
  const r = route.data
  const next = r?.stops.find((s) => s.monument_id === r.next)
  const game = useLoad((s) => (next ? getGame(next.monument_id, uid, s).catch(() => null) : Promise.resolve(null)), [next?.monument_id, uid])
  const cityName = cities.find((c) => c.slug === city)?.name ?? city
  const started = !!r && (r.completed_count > 0 || remembered === city)
  const step = game.data ? stepOf(game.data) : null

  return (
    <main className="vk-page vk-ghome">
      <header className="vk-page__head">
        <h1>{t('Kayıp Vakfiye')}</h1>
        <GoldRule className="vk-page__rule" />
        <p>{t('Vakfiyenin kayıp parçaları eserlerde saklı. Eseri dinle, soruları yanıtla, yerinde ziyaret et; her mühür bir parçayı yerine oturtur.')}</p>
      </header>

      {(catalog.loading || route.loading) && !r && <p className="vk-page__state" role="status">{t('Oyun hazırlanıyor…')}</p>}
      {(catalog.error || route.error) && (
        <p className="vk-page__state vk-page__state--error" role="alert">
          {t('Oyun bilgisi yüklenemedi.')}{' '}
          <button type="button" className="vk-link-btn" onClick={catalog.error ? catalog.reload : route.reload}>{t('Tekrar dene')}</button>
        </p>
      )}

      {r && (
        <section className="vk-ghome__current" aria-labelledby="devam-eden">
          <div className="vk-ghome__current-head">
            <p id="devam-eden" className="vk-ghome__label">{started ? t('Devam eden görev') : t('İlk görevin')}</p>
            <p className="vk-ghome__city">{t('{city} rotası', { city: cityName })}</p>
          </div>
          {next ? (
            <>
              <h2>{nameOf(next, lang)}</h2>
              <p className="vk-ghome__meta">{typeLabel(next.type)}</p>
              {step && (
                <p className="vk-ghome__step">
                  <span className="vk-ghome__step-n" aria-hidden="true">{step.n}</span>
                  <span><span className="vk-sr-only">{t('Sıradaki adım:')} </span>{t(step.label)}</span>
                </p>
              )}
              <div className="vk-ghome__actions">
                <Link to={gamePath.monument(next.monument_id)} className="vk-btn">{started ? t('Göreve devam et') : t('Göreve başla')}</Link>
                <Link to={gamePath.route(city)} className="vk-btn vk-btn--ghost">{t('Rotayı gör')}</Link>
              </div>
            </>
          ) : (
            <>
              <h2>{t('Kayıp Vakfiye tamamlandı')}</h2>
              <p className="vk-ghome__meta">{t('Bu şehirdeki bütün vakfiye parçalarını buldun.')}</p>
              <div className="vk-ghome__actions">
                <Link to={gamePath.route(city)} className="vk-btn vk-btn--ghost">{t('Rotayı gör')}</Link>
              </div>
            </>
          )}
        </section>
      )}

      {r && (
        <Link to="/pasaport" className="vk-ghome__progress">
          <span className="vk-ghome__label">{t('Rozet ilerlemen')}</span>
          <span className="vk-ghome__pieces" aria-hidden="true">
            {Array.from({ length: r.total }, (_, i) => (
              <span key={i} className={i < r.completed_count ? 'is-found' : ''} />
            ))}
          </span>
          <span className="vk-ghome__progress-text">
            {t('{found} / {total} vakfiye parçası', { found: r.completed_count, total: r.total })}
            <span className="vk-ghome__more">{t('Rozetlerime bak')} →</span>
          </span>
        </Link>
      )}

      <section aria-labelledby="oyunlar">
        <h2 id="oyunlar" className="vk-ghome__h">{t('Oyunlar')}</h2>
        <ul className="vk-ghome__games">
          <li>
            <Link to={city ? gamePath.route(city) : gamePath.cities} className="vk-ghome__game">
              <span className="vk-ghome__game-n" aria-hidden="true">I</span>
              <span className="vk-ghome__game-title">{t('Şehir rotası')}</span>
              <span className="vk-ghome__game-text">{t('En yakın açık eserden başla. Başta 3 eser açık; her bilgi mührü yeni bir eserin kilidini açar.')}</span>
            </Link>
          </li>
          <li>
            <Link to={next ? gamePath.monument(next.monument_id) : gamePath.cities} className="vk-ghome__game">
              <span className="vk-ghome__game-n" aria-hidden="true">II</span>
              <span className="vk-ghome__game-title">{t('Mühür yolu ve Rozeti Al')}</span>
              <span className="vk-ghome__game-text">{t('Rehberi dinle, bir soru sor; ardından 5 kısa soru. En az 4 doğruyla bilgi mührü senin.')}</span>
            </Link>
          </li>
          <li>
            <Link to="/pasaport" className="vk-ghome__game">
              <span className="vk-ghome__game-n" aria-hidden="true">III</span>
              <span className="vk-ghome__game-title">{t('Kayıp Vakfiye yapbozu')}</span>
              <span className="vk-ghome__game-text">{t('Her bilgi mührü bir parça getirir. Eseri yerinde ziyaret edince parça altınlaşır.')}</span>
            </Link>
          </li>
        </ul>
      </section>

      <section className="vk-ghome__seals" aria-label={t('Mühürler')}>
        <Seal kind="knowledge" label={t('Bilgi mührü')} size={56} />
        <p><strong>{t('Bilgi mührü')}</strong> {t('sorularla kazanılır.')}</p>
        <Seal kind="gold" label={t('Altın mühür')} size={56} />
        <p><strong>{t('Altın mühür')}</strong> {t('eseri yerinde ziyaret edince gelir.')}</p>
      </section>

      <nav className="vk-ghome__exit" aria-label={t('Oyundan çık')}>
        <Link to="/eserler" className="vk-btn vk-btn--ghost">{t('Keşfe dön')}</Link>
        <Link to="/harita" className="vk-btn vk-btn--ghost">{t('Haritaya dön')}</Link>
      </nav>
    </main>
  )
}
