import { NavLink } from 'react-router-dom'
import './admin-nav.css'

/** Yönetim bölümleri arasında geçiş: istatistik panosu ve içerik yönetimi. */
export function AdminNav() {
  return (
    <nav className="vk-adminnav" aria-label="Yönetim bölümleri">
      <NavLink to="/yonetim" end className="vk-adminnav__link">İstatistik</NavLink>
      <NavLink to="/yonetim/icerik" className="vk-adminnav__link">İçerik</NavLink>
    </nav>
  )
}
