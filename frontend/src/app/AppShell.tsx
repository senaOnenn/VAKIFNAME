import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { CompassIcon, DomeIcon, SealIcon, UserIcon } from './components/Icons'
import { displayName, useAuth } from './session'
import './app-shell.css'

const NAV = [
  { to: '/sehir', label: 'Keşfet', Icon: CompassIcon },
  { to: '/eserler', label: 'Eserler', Icon: DomeIcon },
  { to: '/pasaport', label: 'Pasaport', Icon: SealIcon },
  { to: '/hesap', label: 'Hesap', Icon: UserIcon },
]

/** Oturum açılmış sayfaların kabuğu: web'de üst menü, mobilde alt sekme çubuğu (aynı bağlantılar). */
export default function AppShell() {
  const auth = useAuth()
  if (auth.status === 'loading') return <p className="vk-shell__loading" role="status">Yükleniyor…</p>
  if (auth.status === 'none') return <Navigate to="/giris" replace />
  return (
    <div className="vk-shell">
      <a className="vk-shell__skip" href="#icerik">İçeriğe geç</a>
      <header className="vk-shell__top">
        <NavLink to="/sehir" className="vk-shell__logo">VAKIFNAME</NavLink>
        <nav aria-label="Ana menü" className="vk-shell__topnav">
          {NAV.map(({ to, label }) => (
            <NavLink key={to} to={to} className="vk-shell__toplink">{label}</NavLink>
          ))}
        </nav>
        <span className="vk-shell__chip">
          {displayName(auth)}
        </span>
      </header>
      <div id="icerik" className="vk-shell__main">
        <Outlet />
      </div>
      <nav aria-label="Alt menü" className="vk-shell__tabs">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="vk-shell__tab">
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
