import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import '../design/tokens.css'
import '../design/base.css'
import { gamePath } from './gameCity'
import { RequireAccount } from './RequireAccount'
import { LangProvider } from './i18n'
import Intro, { INTRO_SEEN_KEY } from './screens/Intro'
import Landing from './screens/Landing'
import { PageLoading } from './PageLoading'
import { prefetchScreens, Screen } from './screens'
import { trackPage } from './stats'
// E-posta bağlantısı ekranları ana pakette kalır: bağlantıdaki belirteç adres çubuğundan ilk çizimde silinir
// (parça yüklenmesini beklemez; güvenlik davranışı R6.12 öncesiyle aynı).
import { ForgotPassword, ResetPassword, VerifyEmail } from './screens/EmailLink'
import { GuideProvider } from './components/GuideWidget'

// R6.12: ana sayfa dışındaki ekranlar ayrı parçalarda (bkz. screens.ts); ana sayfa oturunca boşta önceden yüklenir.
const { AppShell, CharacterSelect, GameLayout, Account, AdminPage, Auth, City,
  GameHome, GameMonument, GuidePage, MonumentPage, Monuments, Passport, Privacy, QuizPage, RoutePage } = Screen

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
  // Açılış → tanıtım: tanıtım, açılış perdesi çözülmeye başlarken altta açılır; perde bitince kaldırılır (yumuşak geçiş).
  const [stage, setStage] = useState<'intro' | 'leaving' | 'done'>(() => (introSeen() ? 'done' : 'intro'))
  const leave = useCallback(() => setStage((s) => (s === 'intro' ? 'leaving' : s)), [])
  const done = useCallback(() => setStage('done'), [])
  // İlk sahne çizildikten sonra olası ekranlar boşta önceden yüklenir (geçişte bekleme ve boş ekran olmasın).
  useEffect(() => prefetchScreens(), [])
  return (
    <>
      {stage !== 'intro' && <Landing />}
      {stage !== 'done' && <Intro leaving={stage === 'leaving'} onLeave={leave} onDone={done} />}
    </>
  )
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
  // Sayfa zemini (base.css `body.vk-body`): ilk boyamadan önce eklenir, uygulama kalkınca geri alınır.
  useLayoutEffect(() => {
    document.body.classList.add('vk-body')
    return () => document.body.classList.remove('vk-body')
  }, [])
  return (
    <div className="vk-app">
      <LangProvider>
      <BrowserRouter>
        <OnNavigate />
        {/* R3.11: tek "Rehbere Sor" (sayfalar arasında sohbet korunur). */}
        <GuideProvider>
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/giris" element={<Auth />} />
          <Route path="/gizlilik" element={<Privacy />} />
          {/* R6.3: ilk oyunda karakter seçimi (tam ekran; yalnızca hesapla). */}
          <Route path="/oyun/karakter" element={<RequireAccount><CharacterSelect /></RequireAccount>} />
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
            {/* R6.2: oyun ve ilerleme yalnızca hesapla (sunucu da denetler). Eski adresler oyun adreslerine yönlenir. */}
            <Route path="/oyun" element={<RequireAccount><GameLayout /></RequireAccount>}>
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
            <Route path="/pasaport" element={<RequireAccount><Passport /></RequireAccount>} />
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
        </Suspense>
        </GuideProvider>
      </BrowserRouter>
      </LangProvider>
    </div>
  )
}
