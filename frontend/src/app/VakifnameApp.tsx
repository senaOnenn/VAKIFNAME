import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '../design/tokens.css'
import '../design/base.css'
import AppShell from './AppShell'
import Account from './screens/Account'
import Auth from './screens/Auth'
import City from './screens/City'
import Intro, { INTRO_SEEN_KEY } from './screens/Intro'
import Pending from './screens/Pending'
import Privacy from './screens/Privacy'
import { useAuth } from './session'

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

/** Sayfa değişince en üste dön (tarayıcı yeni sayfayı önceki kaydırma konumunda açmasın). */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** Yeni VAKIFNAME arayüzü (web + mobil, tek kod tabanı). */
export default function VakifnameApp() {
  return (
    <div className="vk-app">
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/giris" element={<Auth />} />
          <Route path="/gizlilik" element={<Privacy />} />
          <Route element={<AppShell />}>
            <Route path="/sehir" element={<City />} />
            <Route path="/bursa" element={<Pending title="Bursa" text="Rota ve eserler bu sayfada yapım aşamasında. Çok yakında." />} />
            <Route path="/eserler" element={<Pending title="Eserler" text="Eser listesi, harita ve filtreler yapım aşamasında. Çok yakında." />} />
            <Route path="/pasaport" element={<Pending title="Pasaport" text="Mühürlerin ve Kayıp Vakfiye yapbozu burada olacak. Çok yakında." />} />
            <Route path="/hesap" element={<Account />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  )
}
