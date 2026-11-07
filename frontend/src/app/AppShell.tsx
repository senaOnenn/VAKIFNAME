import { Suspense, useState } from 'react'
import { A11yMenu } from './components/A11yMenu'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { PageLoading } from './PageLoading'
import { loginPath } from './RequireAccount'
import { ChartIcon, CompassIcon, MapIcon, PuzzleIcon, SealIcon } from './components/Icons'
import { LangSwitch, useLang } from './i18n'
import { displayName, useAuth, type AuthUser } from './session'
import './app-shell.css'

/**
 * Ana bölümler (R6.10: Keşfet · Harita · Oyun · Rozetler). Keşfet ve Harita katalogdur; rehber üst menüde değil, her
 * uygun sayfada sağ alttaki "Rehbere Sor" düğmesindedir (`/rehber` adresi çalışmaya devam eder); Oyun kendi paneli ve menüsüyle ayrı bölümdür; Rozetler pasaporttur.
 * Hesap üst çubuktaki ad düğmesindedir. `match`: bölümün alt sayfalarında da etkin görünmesi için (ör. eser sayfası Keşfet'tir).
 */
const NAV = [
  { to: '/eserler', label: 'Keşfet', Icon: CompassIcon, match: (p: string) => p === '/eserler' || p.startsWith('/eser/') },
  { to: '/harita', label: 'Harita', Icon: MapIcon, match: (p: string) => p === '/harita' },
  { to: '/oyun', label: 'Oyun', Icon: PuzzleIcon, match: (p: string) => p === '/oyun' || p.startsWith('/oyun/') },
  { to: '/pasaport', label: 'Rozetler', Icon: SealIcon, match: (p: string) => p === '/pasaport' },
]
const ADMIN = { to: '/yonetim', label: 'Yönetim', Icon: ChartIcon, match: (p: string) => p.startsWith('/yonetim') }

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

/** Oturum açılmış sayfaların kabuğu: web'de üst menü, mobilde alt sekme çubuğu (aynı bağlantılar, etkin bölüm belirgin). */
export default function AppShell() {
  const auth = useAuth()
  const { t } = useLang()
  const { pathname, search } = useLocation()
  if (auth.status === 'loading') return <p className="vk-shell__loading" role="status">{t('Yükleniyor…')}</p>
  // Girişten sonra istenen sayfaya dönülür (R6.2; yalnızca site içi yol, bkz. RequireAccount.safeNext).
  if (auth.status === 'none') return <Navigate to={loginPath(pathname + search)} replace />
  const nav = (auth.status === 'user' && auth.user.is_admin ? [...NAV, ADMIN] : NAV).map((n) => ({ ...n, active: n.match(pathname) }))
  return (
    <div className="vk-shell">
      <a className="vk-shell__skip" href="#icerik">{t('İçeriğe geç')}</a>
      <header className="vk-shell__top">
        <Link to="/" className="vk-shell__logo">VAKIFNAME</Link>
        <nav aria-label={t('Ana menü')} className="vk-shell__topnav">
          {nav.map(({ to, label, active }) => (
            <Link key={to} to={to} className={`vk-shell__toplink${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>{t(label)}</Link>
          ))}
        </nav>
        <div className="vk-shell__end">
          <A11yMenu />
          <LangSwitch />
          <NavLink to="/hesap" className="vk-shell__chip" aria-label={t('Hesap: {name}', { name: displayName(auth) })}>
            {displayName(auth)}
          </NavLink>
        </div>
      </header>
      <div id="icerik" className="vk-shell__main">
        {auth.status === 'user' && <VerifyNotice user={auth.user} />}
        {/* R6.12: ekran parçası yüklenirken üst menü yerinde kalır. */}
        <Suspense fallback={<PageLoading />}><Outlet /></Suspense>
      </div>
      <nav aria-label={t('Alt menü')} className="vk-shell__tabs">
        {nav.map(({ to, label, Icon, active }) => (
          <Link key={to} to={to} className={`vk-shell__tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon />
            <span>{t(label)}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
