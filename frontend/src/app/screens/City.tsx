import { Link, Navigate, useNavigate } from 'react-router-dom'
import { GoldRule } from '../components/Ornament'
import { endSession, useSession } from '../session'
import './city.css'

interface City {
  slug: string
  name: string
  /** Vakıf Katılım envanter projesinin yayımlanmış/süren şehirleri (bilgi notu). */
  note: string
  open: boolean
}

// Şehir verisi ileride sunucudan gelecek (il alanı); şimdilik envanter projesinin şehirleri sabit listelenir.
const CITIES: City[] = [
  { slug: 'bursa', name: 'Bursa', note: 'Pilot şehir · 10 eser', open: true },
  { slug: 'kutahya', name: 'Kütahya', note: 'Yakında', open: false },
  { slug: 'konya', name: 'Konya', note: 'Yakında', open: false },
  { slug: 'hatay', name: 'Hatay', note: 'Yakında', open: false },
  { slug: 'izmir', name: 'İzmir', note: 'Yakında', open: false },
  { slug: 'manisa', name: 'Manisa', note: 'Yakında', open: false },
]

/** Şehir seçimi: Bursa açık, diğerleri "yakında". */
export default function City() {
  const session = useSession()
  const navigate = useNavigate()
  if (!session) return <Navigate to="/giris" replace />

  return (
    <main className="vk-city">
      <header className="vk-city__bar">
        <span className="vk-city__logo">VAKIFNAME</span>
        <div className="vk-city__who">
          <span className="vk-city__chip">
            {session.kind === 'guest' ? 'Misafir' : `Geçici oturum · ${session.email ?? ''}`}
          </span>
          <button
            type="button"
            className="vk-link-btn"
            onClick={() => {
              endSession()
              navigate('/giris', { replace: true })
            }}
          >
            Çıkış
          </button>
        </div>
      </header>

      <section className="vk-city__intro">
        <h1>Nereyi keşfetmek istersin?</h1>
        <GoldRule className="vk-city__rule" />
        <p>Her şehir, Vakıf Eserleri Envanter Projesi’nde belgelenmiş eserlerle birlikte açılır.</p>
      </section>

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
