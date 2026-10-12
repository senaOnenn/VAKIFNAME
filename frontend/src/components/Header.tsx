import { EmblemIcon } from './Icons'

const NAV_LINKS = [
  { href: '#kesfet', label: 'Keşfet' },
  { href: '#harita', label: 'Harita' },
  { href: '#gorevler', label: 'Görevler' },
  { href: '#pasaport', label: 'Pasaport' },
]

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
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a className="nav__link" href={href}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}
