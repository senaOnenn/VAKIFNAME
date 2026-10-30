import { useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChartIcon, CompassIcon, DomeIcon, SealIcon, UserIcon } from './components/Icons'
import { LangSwitch, useLang } from './i18n'
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
  const { t } = useLang()
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
          ? t('Hesabın açıldı. Doğrulama bağlantısını {email} adresine gönderdik; e-postandaki bağlantıyı aç.', { email: sentTo })
          : t('E-posta adresin henüz doğrulanmadı.')}{' '}
        <Link to="/hesap">{sentTo ? t('Bağlantı gelmedi mi?') : t('Doğrula')}</Link>
      </p>
      <button type="button" className="vk-link-btn" onClick={close} aria-label={t('Bildirimi kapat')}>{t('Kapat')}</button>
    </div>
  )
}

/** Oturum açılmış sayfaların kabuğu: web'de üst menü, mobilde alt sekme çubuğu (aynı bağlantılar). */
export default function AppShell() {
  const auth = useAuth()
  const { t } = useLang()
  if (auth.status === 'loading') return <p className="vk-shell__loading" role="status">{t('Yükleniyor…')}</p>
  if (auth.status === 'none') return <Navigate to="/giris" replace />
  const nav = auth.status === 'user' && auth.user.is_admin ? [...NAV, { to: '/yonetim', label: 'Yönetim', Icon: ChartIcon }] : NAV
  return (
    <div className="vk-shell">
      <a className="vk-shell__skip" href="#icerik">{t('İçeriğe geç')}</a>
      <header className="vk-shell__top">
        <NavLink to="/sehir" className="vk-shell__logo">VAKIFNAME</NavLink>
        <nav aria-label={t('Ana menü')} className="vk-shell__topnav">
          {nav.map(({ to, label }) => (
            <NavLink key={to} to={to} className="vk-shell__toplink">{t(label)}</NavLink>
          ))}
        </nav>
        <div className="vk-shell__end">
          <LangSwitch />
          <span className="vk-shell__chip">
            {displayName(auth)}
          </span>
        </div>
      </header>
      <div id="icerik" className="vk-shell__main">
        {auth.status === 'user' && <VerifyNotice user={auth.user} />}
        <Outlet />
      </div>
      <nav aria-label={t('Alt menü')} className="vk-shell__tabs">
        {nav.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="vk-shell__tab">
            <Icon />
            <span>{t(label)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
