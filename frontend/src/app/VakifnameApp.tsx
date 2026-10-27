import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import '../design/tokens.css'
import '../design/base.css'
import Auth from './screens/Auth'
import City from './screens/City'
import Intro, { INTRO_SEEN_KEY } from './screens/Intro'
import Pending from './screens/Pending'
import { useSession } from './session'

/** Açılış yalnızca oturum başına bir kez gösterilir; oturumu olan kullanıcı doğrudan şehir seçimine geçer. */
function Home() {
  const session = useSession()
  let seen = false
  try {
    seen = window.sessionStorage.getItem(INTRO_SEEN_KEY) === '1'
  } catch {
    /* yoksay */
  }
  if (session) return <Navigate to="/sehir" replace />
  return seen ? <Navigate to="/giris" replace /> : <Intro />
}

/** Yeni VAKIFNAME arayüzü (web + mobil, tek kod tabanı). */
export default function VakifnameApp() {
  return (
    <div className="vk-app">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/giris" element={<Auth />} />
          <Route path="/sehir" element={<City />} />
          <Route path="/bursa" element={<Pending title="Bursa" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  )
}
