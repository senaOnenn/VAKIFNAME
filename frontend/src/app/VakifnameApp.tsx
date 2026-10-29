import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '../design/tokens.css'
import '../design/base.css'
import AppShell from './AppShell'
import Account from './screens/Account'
import AdminPage from './screens/AdminPage'
import Auth from './screens/Auth'
import City from './screens/City'
import Intro, { INTRO_SEEN_KEY } from './screens/Intro'
import MonumentPage from './screens/MonumentPage'
import Monuments from './screens/Monuments'
import Passport from './screens/Passport'
import Privacy from './screens/Privacy'
import QuizPage from './screens/QuizPage'
import RoutePage from './screens/RoutePage'
import { useAuth } from './session'
import { trackPage } from './stats'

// İçerik yönetimi yalnızca yöneticinin açtığı ekranlardır: ayrı parçada yüklenir, ziyaretçinin paketine girmez.
const ContentHome = lazy(() => import('./screens/admin/ContentHome'))
const ContentMonument = lazy(() => import('./screens/admin/ContentMonument'))
const FactEditor = lazy(() => import('./screens/admin/FactEditor'))
const later = (el: ReactNode) => <Suspense fallback={<p className="vk-page__state" role="status">Yükleniyor…</p>}>{el}</Suspense>

/** Açılış yalnızca oturum başına bir kez gösterilir; oturumu olan kullanıcı doğrudan şehir seçimine geçer. */
function Home() {
  const auth = useAuth()
  let seen = false
  try {
    seen = window.sessionStorage.getItem(INTRO_SEEN_KEY) === '1'
  } catch {
    /* yoksay */
  }
  if (auth.status === 'user' || auth.status === 'guest') return <Navigate to="/sehir" replace />
  return seen ? <Navigate to="/giris" replace /> : <Intro />
}

/** Sayfa değişince en üste dön ve sayfayı anonim olarak say (bkz. stats.ts). */
function OnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    trackPage(pathname)
  }, [pathname])
  return null
}

/** Yeni VAKIFNAME arayüzü (web + mobil, tek kod tabanı). */
export default function VakifnameApp() {
  return (
    <div className="vk-app">
      <BrowserRouter>
        <OnNavigate />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/giris" element={<Auth />} />
          <Route path="/gizlilik" element={<Privacy />} />
          <Route element={<AppShell />}>
            <Route path="/sehir" element={<City />} />
            <Route path="/rota/:city" element={<RoutePage />} />
            <Route path="/bursa" element={<Navigate to="/rota/bursa" replace />} />
            <Route path="/eserler" element={<Monuments />} />
            <Route path="/eser/:id" element={<MonumentPage />} />
            <Route path="/eser/:id/rozet" element={<QuizPage />} />
            <Route path="/pasaport" element={<Passport />} />
            <Route path="/hesap" element={<Account />} />
            <Route path="/yonetim" element={<AdminPage />} />
            <Route path="/yonetim/icerik" element={later(<ContentHome />)} />
            <Route path="/yonetim/icerik/eser/:id" element={later(<ContentMonument />)} />
            <Route path="/yonetim/icerik/eser/:id/yeni-kayit" element={later(<FactEditor />)} />
            <Route path="/yonetim/icerik/kayit/:factId" element={later(<FactEditor />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  )
}
