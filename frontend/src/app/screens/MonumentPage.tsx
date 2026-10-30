import { Link, useParams } from 'react-router-dom'
import { citySlug, getGame, getMonument, getPeople, getRoute, mediaUrl, progressId, sendEngagement, statusMap, typeLabel, useLoad, type MonumentFact } from '../api'
import { GamePanel } from '../components/GamePanel'
import { PeopleCards } from '../components/PeopleCards'
import { Narrator } from '../components/Narrator'
import { GoldRule } from '../components/Ornament'
import { StatusBadge } from '../components/StatusBadge'
import { factIn, nameOf, textIn } from '../contentLang'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import './discover.css'
import './monument.css'

/** Doğrulanmamış içerik kesin bilgi gibi sunulmaz (şartname 5.1.3): kesinlik her bilgide görünür. */
const CERTAINTY: Record<string, string> = {
  documented: 'Kaynaklarda belgelenmiş',
  reported: 'Aktarılan bilgi (rivayet)',
  uncertain: 'Kesin değil',
}

function FactItem({ f }: { f: MonumentFact }) {
  const { t, lang } = useLang()
  const c = factIn(f, lang)
  return (
    <li className="vk-fact">
      <h3 lang={c.turkishOnly ? 'tr' : undefined}>{c.title}</h3>
      <p lang={c.turkishOnly ? 'tr' : undefined}>{c.text}</p>
      {c.turkishOnly && <p className="vk-fact__tr">{t('Bu bilginin onaylı İngilizcesi henüz yok; kaynaktaki Türkçesi gösteriliyor.')}</p>}
      <p className="vk-fact__meta">
        <span className={`vk-cert vk-cert--${f.certainty}`}>{CERTAINTY[f.certainty] ? t(CERTAINTY[f.certainty]) : f.certainty}</span>
        <span>
          {t('Kaynak: {title}, s. {page}', { title: f.source.title, page: c.page })}
          {f.sources?.map((s) => (
            <span key={s.url}>
              {' · '}
              <a href={s.url} target="_blank" rel="noreferrer">{s.publisher || s.title}</a>
            </span>
          ))}
        </span>
      </p>
    </li>
  )
}

/**
 * Eser sayfası. Sıra: görsel ve kimlik → karakter anlatımı ve sohbet → ziyaret uyarısı → kaynaklı ayrıntı (ikinci
 * katman, gizlenmez) → galeri (her görselde atıf).
 */
export default function MonumentPage() {
  const { id = '' } = useParams()
  const auth = useAuth()
  const uid = progressId(auth)
  const { t, lang } = useLang()
  const m = useLoad((s) => getMonument(id, s), [id])
  const city = m.data ? citySlug(m.data.city) : ''
  const route = useLoad((s) => (city ? getRoute(city, uid, null, s).catch(() => null) : Promise.resolve(null)), [city, uid])
  const status = statusMap(route.data)[id]
  // Oyun durumu (Faz 5). Uç yoksa veya hata verirse panel gösterilmez; eser bilgisi yine okunur.
  const game = useLoad((s) => getGame(id, uid, s), [id, uid])
  // Tarihî kişiler kartla görünür; anlatıcı yerel rehberdir (K4). Yüklenemezse kart gösterilmez.
  const people = useLoad((s) => getPeople(id, s).catch(() => []), [id])
  const engage = (event: 'listened' | 'asked') => {
    sendEngagement(id, uid, event).then(game.reload, () => undefined)
  }

  if (m.loading) return <main className="vk-page"><p className="vk-page__state" role="status">{t('Eser yükleniyor…')}</p></main>
  if (m.error || !m.data)
    return (
      <main className="vk-page">
        <p className="vk-page__state vk-page__state--error" role="alert">{t('Eser bulunamadı veya yüklenemedi.')}</p>
        <Link to="/eserler" className="vk-btn vk-btn--ghost">← {t('Eserlere dön')}</Link>
      </main>
    )

  const d = m.data
  const cover = d.images[0]
  const name = nameOf(d, lang)
  const notice = textIn(d.site_notice, d.site_notice_en, lang)
  // Tarihî kişi kartının metni bağlı olduğu kaydın metnidir; İngilizcesi onaylıysa o gösterilir.
  const enText = new Map(d.facts.filter((f) => f.text_en).map((f) => [f.fact_id, f.text_en!]))
  const peopleIn = (people.data ?? []).map((p) => (lang === 'en' && enText.has(p.fact_id) ? { ...p, text: enText.get(p.fact_id)! } : p))
  return (
    <main className="vk-mon">
      <header className="vk-mon__hero">
        {cover && <img className="vk-mon__img" src={mediaUrl(cover.card_file || cover.file)} alt={t('{name} görünümü', { name })} />}
        <div className="vk-mon__shade" aria-hidden="true" />
        <div className="vk-mon__title">
          <p className="vk-page__eyebrow">{typeLabel(d.type)} · {d.district}, {d.city}</p>
          <h1>{name}</h1>
          <StatusBadge status={status} />
        </div>
        {cover?.attribution && <p className="vk-mon__credit">{cover.attribution}</p>}
      </header>

      <div className="vk-mon__body">
        <PeopleCards people={peopleIn} />

        <Narrator key={lang} monument={d} onListened={() => engage('listened')} onAsked={() => engage('asked')} />

        {game.data && <GamePanel id={id} uid={uid} city={city} game={game.data} onChange={() => { game.reload(); route.reload() }} />}

        {d.site_notice && (
          <aside className="vk-notice" aria-label={t('Ziyaret uyarısı')}>
            <strong>{t('Ziyaret ederken')}</strong>
            <p lang={notice.turkishOnly ? 'tr' : undefined}>{notice.text}</p>
          </aside>
        )}

        <section className="vk-facts" aria-labelledby="tarihce">
          <h2 id="tarihce">{t('Tarihçe ve kaynaklar')}</h2>
          <GoldRule className="vk-page__rule" />
          <p className="vk-facts__lead">{d.address}</p>
          <ol>
            {d.facts.map((f) => (
              <FactItem key={f.fact_id} f={f} />
            ))}
          </ol>
        </section>

        {d.images.length > 0 && (
          <section className="vk-gallery" aria-labelledby="galeri">
            <h2 id="galeri">{t('Görseller')}</h2>
            <ul>
              {d.images.map((img, i) => (
                <li key={img.image_id}>
                  <figure>
                    <img src={mediaUrl(img.card_file || img.file)} alt={t('{name}, görsel {n}', { name, n: i + 1 })} loading="lazy" />
                    <figcaption>
                      {img.attribution ?? img.rights_holder}
                      {img.license_url && (
                        <>
                          {' · '}
                          <a href={img.license_url} target="_blank" rel="noreferrer">{img.license}</a>
                        </>
                      )}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
