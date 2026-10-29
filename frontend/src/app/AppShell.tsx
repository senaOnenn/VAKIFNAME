import { useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChartIcon, CompassIcon, DomeIcon, SealIcon, UserIcon } from './components/Icons'
import { displayName, useAuth, type AuthUser } from './session'
import './app-shell.css'

const NAV = [
  { to: '/sehir', label: 'Keşfet', Icon: CompassIcon },
  { to: '/eserler', label: 'Eserler', Icon: DomeIcon },
  { to: '/pasaport', label: 'Pasaport', Icon: SealIcon },
  { to: '/hesap', label: 'Hesap', Icon: UserIcon },
]

const VERIFY_DISMISSED = 'vakifname.verifyNoticeDismissed'

/** E-postası doğrulanmamış hesaba ince bir hatırlatma; kayıttan hemen sonra "bağlantı gönderildi" der. Oturum boyunca
 * kapatılabilir. Sunucu alanı göndermiyorsa (`undefined`) gösterilmez. */
function VerifyNotice({ user }: { user: AuthUser }) {
  const location = useLocation()
  const sentTo = (location.state as { verifySent?: string } | null)?.verifySent
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.sessionStorage.getItem(VERIFY_DISMISSED) === '1'
    } catch {
      return false
    }
  })
  if (user.email_verified !== false || dismissed || location.pathname === '/hesap') return null
  function close() {
    setDismissed(true)
    try {
      window.sessionStorage.setItem(VERIFY_DISMISSED, '1')
    } catch {
      /* yoksay */
    }
  }
  return (
    <div className="vk-verify-notice" role="status">
      <p>
        {sentTo
          ? `Hesabın açıldı. Doğrulama bağlantısını ${sentTo} adresine gönderdik; e-postandaki bağlantıyı aç.`
          : 'E-posta adresin henüz doğrulanmadı.'}{' '}
        <Link to="/hesap">{sentTo ? 'Bağlantı gelmedi mi?' : 'Doğrula'}</Link>
      </p>
      <button type="button" className="vk-link-btn" onClick={close} aria-label="Bildirimi kapat">Kapat</button>
    </div>
  )
}

/** Oturum açılmış sayfaların kabuğu: web'de üst menü, mobilde alt sekme çubuğu (aynı bağlantılar). */
export default function AppShell() {
  const auth = useAuth()
  if (auth.status === 'loading') return <p className="vk-shell__loading" role="status">Yükleniyor…</p>
  if (auth.status === 'none') return <Navigate to="/giris" replace />
  const nav = auth.status === 'user' && auth.user.is_admin ? [...NAV, { to: '/yonetim', label: 'Yönetim', Icon: ChartIcon }] : NAV
  return (
    <div className="vk-shell">
      <a className="vk-shell__skip" href="#icerik">İçeriğe geç</a>
      <header className="vk-shell__top">
        <NavLink to="/sehir" className="vk-shell__logo">VAKIFNAME</NavLink>
        <nav aria-label="Ana menü" className="vk-shell__topnav">
          {nav.map(({ to, label }) => (
            <NavLink key={to} to={to} className="vk-shell__toplink">{label}</NavLink>
          ))}
        </nav>
        <span className="vk-shell__chip">
          {displayName(auth)}
        </span>
      </header>
      <div id="icerik" className="vk-shell__main">
        {auth.status === 'user' && <VerifyNotice user={auth.user} />}
        <Outlet />
      </div>
      <nav aria-label="Alt menü" className="vk-shell__tabs">
        {nav.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="vk-shell__tab">
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
