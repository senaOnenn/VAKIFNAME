import { EmblemIcon, LockIcon } from './Icons'

const COMING_SOON = ['Görevler', 'Pasaport']

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner container">
        <a className="brand" href="#top" aria-label="VAKIFNAME ana sayfa">
          <EmblemIcon className="brand__icon" />
          <span className="brand__name">VAKIFNAME</span>
        </a>
        <nav aria-label="Ana menü">
          <ul className="nav">
            <li>
              <a className="nav__link" href="#kesfet">
                Keşfet
              </a>
            </li>
            <li>
              <a className="nav__link" href="#harita">
                Harita
              </a>
            </li>
            {COMING_SOON.map((label) => (
              // Bağlantı veya buton değil: henüz geliştirilmedi ve tıklanamaz.
              <li key={label} className="nav__soon">
                <LockIcon className="nav__soon-icon" />
                <span>{label}</span>
                <span className="badge badge--soon">Yakında</span>
                <span className="visually-hidden">(henüz kullanılamıyor)</span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}
