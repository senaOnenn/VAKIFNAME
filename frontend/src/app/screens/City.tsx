import { Link } from 'react-router-dom'
import { CITIES } from '../cities'
import { GoldRule } from '../components/Ornament'
import { TurkeyMap } from '../components/TurkeyMap'
import './city.css'

/** Şehir seçimi: Türkiye haritası + erişilebilir şehir listesi. Bursa açık, diğerleri "yakında". */
export default function City() {
  return (
    <main className="vk-city">
      <section className="vk-city__intro">
        <h1>Nereyi keşfetmek istersin?</h1>
        <GoldRule className="vk-city__rule" />
        <p>Her şehir, Vakıf Eserleri Envanter Projesi’nde belgelenmiş eserleriyle açılır.</p>
      </section>

      <TurkeyMap cities={CITIES} />

      <ul className="vk-city__grid" aria-label="Şehirler">
        {CITIES.map((c) => (
          <li key={c.slug}>
            {c.open ? (
              <Link to={`/${c.slug}`} className="vk-city__card vk-city__card--open">
                <span className="vk-city__name">{c.name}</span>
                <span className="vk-city__note">{c.note}</span>
                <span className="vk-city__go" aria-hidden="true">Keşfe başla →</span>
              </Link>
            ) : (
              <div className="vk-city__card vk-city__card--soon" aria-disabled="true">
                <span className="vk-city__name">{c.name}</span>
                <span className="vk-city__note">{c.note}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
