import { Link } from 'react-router-dom'
import { citySlug, getMonuments, getRoute, getVakfiyeLayout, progressId, useLoad } from '../api'
import { CITIES, withCatalog } from '../cities'
import { PlayerCrest, RouteLedger } from '../components/GameParts'
import { Seal } from '../components/Seal'
import { VakfiyePuzzle } from '../components/VakfiyePuzzle'
import { nameOf } from '../contentLang'
import { gamePath, lastGameCity } from '../gameCity'
import { vakfiyeBoard } from '../vakfiye'
import { useLang } from '../i18n'
import { usePlayer } from '../player'
import { useAuth } from '../session'
import './game-home.css'

/**
 * R6.7 Vakfiye Odası (oyun girişi). Döngü: eser seç → bilgi görevini oyna → mühür ve XP kazan → vakfiye parçasını topla
 * → sonraki eseri seç. Ekranda: kâşif (seviye, XP), Kayıp Vakfiye yapbozu ve tamamlanan eserler, tek ana eylem
 * ("Sonraki keşif") ve şehrin bütün eserleri (hepsi seçilebilir; her satır doğrudan görev ekranına gider). Kurallar
 * sunucudadır.
 */
export default function GameHome() {
  const auth = useAuth()
  const { t, lang } = useLang()
  const { profile } = usePlayer()
  const uid = progressId(auth)
  const catalog = useLoad((s) => getMonuments(s), [])
  const cities = withCatalog(CITIES, catalog.data ? catalog.data.monuments.map((m) => m.city) : null, citySlug).filter((c) => c.open)
  const remembered = lastGameCity()
  const cityInfo = catalog.data ? (cities.find((c) => c.slug === remembered) ?? cities[0]) : undefined
  const city = cityInfo?.slug ?? ''
  const route = useLoad((s) => (city ? getRoute(city, uid, null, s) : Promise.resolve(null)), [city, uid])
  const r = route.data
  // Yerleşim yalnızca bu şehir için yüklendiğinde kullanılır (iki ekran geçici olarak farklı sıra göstermesin).
  const layout = useLoad((s) => (city ? getVakfiyeLayout(city, s).then((slots) => ({ city, slots }), () => ({ city, slots: null })) : Promise.resolve(null)), [city])
  const layoutReady = !!city && layout.data?.city === city
  // Sonraki keşif: önce yarım kalan görev, yoksa önerilen sıradaki eser.
  // R6.8: yalnızca görevi hazır eserler önerilir (onaylı kayıtlardan 5 soru kurulabilen).
  const playable = r ? r.stops.filter((s) => s.quest_ready !== false) : []
  const next = playable.find((s) => s.progress === 'started') ?? playable.find((s) => s.monument_id === r?.next) ?? playable[0]
  const cityName = cityInfo?.name ?? city
  // R6.9: tek ve sabit vakfiye yerleşimi (Mühür Defteri ile aynı): her eserin belgedeki yuvası sabittir.
  const pieces = r
    ? vakfiyeBoard(layout.data?.slots, [...r.stops, ...r.completed], new Set(r.completed.map((c) => c.monument_id)),
      new Set(r.completed.filter((c) => c.visit).map((c) => c.monument_id)))
    : null
  const done = r ? [...r.completed] : []

  return (
    <main className="vk-desk">
      <header className="vk-desk__head">
        <div className="vk-desk__title">
          <p className="vk-desk__eyebrow">{cityName ? t('{city} · Kayıp Vakfiye', { city: cityName }) : t('Kayıp Vakfiye')}</p>
          <h1>{t('Vakfiye Odası')}</h1>
          <p className="vk-desk__lead">
            {t('Bir eser seç, bilgi görevini oyna, mührünü ve vakfiyenin parçasını kazan. Sıra sende.')}
          </p>
        </div>
        {profile && <PlayerCrest profile={profile} />}
      </header>

      {(catalog.loading || route.loading) && !r && <p className="vk-desk__state" role="status">{t('Oyun hazırlanıyor…')}</p>}
      {(catalog.error || route.error) && (
        <p className="vk-desk__state vk-desk__state--error" role="alert">
          {t('Oyun bilgisi yüklenemedi.')}{' '}
          <button type="button" className="vk-link-btn" onClick={catalog.error ? catalog.reload : route.reload}>{t('Tekrar dene')}</button>
        </p>
      )}

      {r && pieces && layoutReady && (
        <article className="vk-folio vk-desk__folio">
          <section className="vk-desk__vakfiye" aria-labelledby="vakfiye-h">
            <p className="vk-folio__eyebrow">{t('{found} / {total} parça', { found: r.completed_count, total: r.total })}</p>
            <h2 id="vakfiye-h" className="vk-folio__h">{t('Kayıp Vakfiye')}</h2>
            <VakfiyePuzzle pieces={pieces.states} labels={pieces.monuments.map((m) => nameOf(m, lang))} />
          </section>

          <section className="vk-desk__next" aria-labelledby="sonraki">
            <p id="sonraki" className="vk-folio__eyebrow">{t('Sonraki keşif')}</p>
            {next ? (
              <>
                <h2 className="vk-folio__h">{nameOf(next, lang)}</h2>
                <Link to={gamePath.monument(next.monument_id)} className="vk-waxbtn">
                  {next.progress === 'started' ? t('Göreve Devam Et') : t('Göreve Başla')}
                </Link>
                <p className="vk-folio__note">{t('Ya da aşağıdan dilediğin eseri seç; hepsi açık.')}</p>
              </>
            ) : (
              <>
                <h2 className="vk-folio__h">{t('Kayıp Vakfiye tamamlandı')}</h2>
                <p className="vk-folio__note">{t('Bu şehirdeki bütün vakfiye parçalarını buldun. Eserleri yerinde ziyaret ettikçe parçalar altınlaşır.')}</p>
              </>
            )}
          </section>

          <section className="vk-desk__done" aria-labelledby="tamamlanan">
            <h2 id="tamamlanan" className="vk-folio__h">{t('Tamamlanan eserler')}</h2>
            {done.length ? (
              <ul className="vk-desk__donelist">
                {done.map((c) => (
                  <li key={c.monument_id}>
                    <span aria-hidden="true"><Seal kind={c.visit ? 'gold' : 'knowledge'} label="" size={36} /></span>
                    <Link to={gamePath.monument(c.monument_id)}>{nameOf(c, lang)}</Link>
                    <span className="vk-desk__donemeta">{t(c.visit ? 'Altın mühür' : 'Bilgi mührü')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="vk-folio__note">{t('İlk bilgi mührünü kazandığında eser burada mührüyle durur.')}</p>
            )}
            <Link to="/pasaport" className="vk-desk__maplink">{t('Mühür Defteri’ni aç')}</Link>
          </section>

          <section className="vk-desk__route" aria-labelledby="eserler-h">
            <div className="vk-desk__route-head">
              <h2 id="eserler-h" className="vk-folio__h">{t('{city} eserleri', { city: cityName })}</h2>
              <Link to={gamePath.route(city)} className="vk-desk__maplink">{t('Haritada gör')}</Link>
            </div>
            <RouteLedger route={r} label={t('Rota durakları')} />
          </section>
        </article>
      )}
    </main>
  )
}
