import { useEffect, useRef, useState } from 'react'
import { CloseIcon, MenuIcon } from './Icons'

export interface NavLink {
  href: string
  label: string
}

const NAV_LINKS: NavLink[] = [
  { href: '#kesfet', label: 'Keşfet' },
  { href: '#harita', label: 'Harita' },
  { href: '#gorevler', label: 'Görevler' },
  { href: '#pasaport', label: 'Pasaport' },
]

/** Yeni tasarımın kemer biçimli logosu; belirli bir eseri temsil etmez. */
export function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" focusable="false">
      <path d="M5 35V18Q20-8 35 18v17H5zM12 35V20q8-13 16 0v15M1 35h38M20 3V0" />
    </svg>
  )
}

export function Header({
  links = NAV_LINKS,
  subtitle = 'Bursa’nın Kayıp Vakfiyesi',
}: { links?: NavLink[]; subtitle?: string } = {}) {
  // Menü düğmesi yalnızca dar ekranlarda görünür; geniş ekranda bağlantılar her zaman açıktır (CSS).
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <header className="site-header">
      <div className="site-header__inner container">
        <a className="brand" href="#top" aria-label="VAKIFNAME ana sayfa">
          <BrandMark />
          <span className="brand__text">
            <span className="brand__name">VAKIFNAME</span>
            <span className="brand__sub" aria-hidden="true">
              {subtitle}
            </span>
          </span>
        </a>
        <button
          ref={buttonRef}
          type="button"
          className="menu-button"
          aria-expanded={open}
          aria-controls="ana-menu"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
          <span>Menü</span>
        </button>
        <nav id="ana-menu" className={`site-nav${open ? ' site-nav--open' : ''}`} aria-label="Ana menü">
          <ul className="nav">
            {links.map(({ href, label }) => (
              <li key={href}>
                <a className="nav__link" href={href} onClick={() => setOpen(false)}>
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
