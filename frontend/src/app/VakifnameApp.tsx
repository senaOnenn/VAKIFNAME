import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import '../design/tokens.css'
import '../design/base.css'
import AppShell from './AppShell'
import GameLayout from './GameLayout'
import { gamePath } from './gameCity'
import Account from './screens/Account'
import AdminPage from './screens/AdminPage'
import Auth from './screens/Auth'
import City from './screens/City'
import { ForgotPassword, ResetPassword, VerifyEmail } from './screens/EmailLink'
import GameHome from './screens/GameHome'
import GameMonument from './screens/GameMonument'
import GuidePage from './screens/GuidePage'
import { LangProvider } from './i18n'
import Intro, { INTRO_SEEN_KEY } from './screens/Intro'
import Landing from './screens/Landing'
import MonumentPage from './screens/MonumentPage'
import Monuments from './screens/Monuments'
import Passport from './screens/Passport'
import Privacy from './screens/Privacy'
import QuizPage from './screens/QuizPage'
import RoutePage from './screens/RoutePage'
import { trackPage } from './stats'

// İçerik yönetimi yalnızca yöneticinin açtığı ekranlardır: ayrı parçada yüklenir, ziyaretçinin paketine girmez.
const ContentHome = lazy(() => import('./screens/admin/ContentHome'))
const ContentMonument = lazy(() => import('./screens/admin/ContentMonument'))
const FactEditor = lazy(() => import('./screens/admin/FactEditor'))
const TranslationEditor = lazy(() => import('./screens/admin/TranslationEditor'))
const later = (el: ReactNode) => <Suspense fallback={<p className="vk-page__state" role="status">Yükleniyor…</p>}>{el}</Suspense>

function introSeen(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Ana sayfa: açılış animasyonu (oturum başına bir kez) → hikâyesel tanıtım. Görev 35'ten beri oturumu olan kullanıcı da
 * ana sayfayı görür; üst menüden Keşfet, Harita, Rehber ve Oyun'a geçer.
 */
function Home() {
  const [seen, setSeen] = useState(introSeen)
  const done = useCallback(() => setSeen(true), [])
  return seen ? <Landing /> : <Intro onDone={done} />
}

/** Oyun ekranlarının eski adresleri (paylaşılmış bağlantılar, yer imleri) oyun paneline yönlenir. */
function OldGameRoute({ to }: { to: (p: Record<string, string>) => string }) {
  const params = useParams()
  return <Navigate to={to(params as Record<string, string>)} replace />
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
      <LangProvider>
      <BrowserRouter>
        <OnNavigate />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/giris" element={<Auth />} />
          <Route path="/gizlilik" element={<Privacy />} />
          <Route path="/dogrula" element={<VerifyEmail />} />
          <Route path="/sifre-sifirla" element={<ForgotPassword />} />
          <Route path="/sifre-yenile" element={<ResetPassword />} />
          <Route element={<AppShell />}>
            {/* Katalog: Keşfet (liste), Harita, eser sayfası, Rehber */}
            <Route path="/eserler" element={<Monuments />} />
            <Route path="/harita" element={<Monuments />} />
            <Route path="/eser/:id" element={<MonumentPage />} />
            <Route path="/rehber" element={<GuidePage />} />
            {/* Oyun paneli: kendi başlığı ve menüsüyle ayrı bölüm (kurallar ve ilerleme aynı) */}
            <Route path="/oyun" element={<GameLayout />}>
              <Route index element={<GameHome />} />
              <Route path="sehir" element={<City />} />
              <Route path="rota/:city" element={<RoutePage />} />
              <Route path="eser/:id" element={<GameMonument />} />
              <Route path="eser/:id/rozet" element={<QuizPage />} />
            </Route>
            <Route path="/sehir" element={<Navigate to={gamePath.cities} replace />} />
            <Route path="/rota/:city" element={<OldGameRoute to={(p) => gamePath.route(p.city)} />} />
            <Route path="/bursa" element={<Navigate to={gamePath.route('bursa')} replace />} />
            <Route path="/eser/:id/rozet" element={<OldGameRoute to={(p) => gamePath.quiz(p.id)} />} />
            <Route path="/pasaport" element={<Passport />} />
            <Route path="/hesap" element={<Account />} />
            <Route path="/yonetim" element={<AdminPage />} />
            <Route path="/yonetim/icerik" element={later(<ContentHome />)} />
            <Route path="/yonetim/icerik/eser/:id" element={later(<ContentMonument />)} />
            <Route path="/yonetim/icerik/eser/:id/yeni-kayit" element={later(<FactEditor />)} />
            <Route path="/yonetim/icerik/kayit/:factId" element={later(<FactEditor />)} />
            <Route path="/yonetim/icerik/ceviri/:factId" element={later(<TranslationEditor />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </LangProvider>
    </div>
  )
}
