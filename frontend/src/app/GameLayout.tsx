import { Link, Outlet, useLocation } from 'react-router-dom'
import { PuzzleIcon } from './components/Icons'
import { gamePath, useLastGameCity } from './gameCity'
import { useLang } from './i18n'
import './game-layout.css'

/**
 * Oyun paneli: katalogdan (Keşfet, Harita, Rehber) ayrı, kendi başlığı ve menüsü olan bölüm. Oyunun kuralları ve
 * ilerlemesi değişmez; burada yalnızca oyun ekranları (giriş, şehir, rota, eserin mühür yolu, Rozeti Al) toplanır.
 */
export default function GameLayout() {
  const { t } = useLang()
  const { pathname } = useLocation()
  const remembered = useLastGameCity()
  const city = /^\/oyun\/rota\/([^/]+)/.exec(pathname)?.[1] ?? remembered
  const items = [
    { to: gamePath.home, label: 'Oyun girişi', active: pathname === gamePath.home },
    { to: gamePath.cities, label: 'Şehir seç', active: pathname === gamePath.cities },
    ...(city ? [{ to: gamePath.route(city), label: 'Rotam', active: pathname.startsWith('/oyun/rota/') || pathname.startsWith('/oyun/eser/') }] : []),
  ]
  return (
    <div className="vk-gamezone">
      <div className="vk-gamebar">
        <div className="vk-gamebar__inner">
          <Link to={gamePath.home} className="vk-gamebar__id">
            <span className="vk-gamebar__icon"><PuzzleIcon /></span>
            <span>
              <span className="vk-gamebar__eyebrow">{t('Oyun')}</span>
              <span className="vk-gamebar__title">{t('Kayıp Vakfiye')}</span>
            </span>
          </Link>
          <nav aria-label={t('Oyun menüsü')} className="vk-gamebar__nav">
            {items.map(({ to, label, active }) => (
              <Link key={label} to={to} className={`vk-gamebar__link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                {t(label)}
              </Link>
            ))}
          </nav>
          <Link to="/eserler" className="vk-gamebar__exit">← {t('Keşfe dön')}</Link>
        </div>
      </div>
      <Outlet />
    </div>
  )
}
