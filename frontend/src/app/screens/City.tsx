import { Link } from 'react-router-dom'
import { citySlug, getMonuments, useLoad } from '../api'
import { CITIES, cityNote, withCatalog } from '../cities'
import { GoldRule } from '../components/Ornament'
import { TurkeyMap } from '../components/TurkeyMap'
import { useLang } from '../i18n'
import './city.css'

/** Şehir seçimi: Türkiye haritası + erişilebilir şehir listesi. Katalogda eseri olan şehir açık, diğerleri "yakında". */
export default function City() {
  const { t } = useLang()
  const catalog = useLoad((s) => getMonuments(s), [])
  const cities = withCatalog(CITIES, catalog.data ? catalog.data.monuments.map((m) => m.city) : null, citySlug)
  return (
    <main className="vk-city">
      <section className="vk-city__intro">
        <h1>{t('Nereyi keşfetmek istersin?')}</h1>
        <GoldRule className="vk-city__rule" />
        <p>{t('Her şehir, Vakıf Eserleri Envanter Projesi’nde belgelenmiş eserleriyle açılır.')}</p>
      </section>

      <TurkeyMap cities={cities} />

      <ul className="vk-city__grid" aria-label={t('Şehirler')}>
        {cities.map((c) => (
          <li key={c.slug}>
            {c.open ? (
              <Link to={`/rota/${c.slug}`} className="vk-city__card vk-city__card--open">
                <span className="vk-city__name">{c.name}</span>
                <span className="vk-city__note">{cityNote(c, t)}</span>
                <span className="vk-city__go" aria-hidden="true">{t('Keşfe başla')} →</span>
              </Link>
            ) : (
              <div className="vk-city__card vk-city__card--soon" aria-disabled="true">
                <span className="vk-city__name">{c.name}</span>
                <span className="vk-city__note">{cityNote(c, t)}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
