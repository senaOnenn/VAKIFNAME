import { lazy, type ComponentType } from 'react'

/**
 * R6.12 Ekranların parça parça yüklenmesi. Ölçüm: ana sayfa (sinematik giriş) açılırken oyun, harita, eser sayfası,
 * Tarih Defteri, Fotoğraf Arşivi, rehber sayfası ve hesap ekranlarının tamamı tek pakette indirilip derleniyordu (mobilde
 * CPU 4× yavaşken ilk boyama ~4 sn). Artık ana sayfa yalnızca kendi kodunu yükler; diğer ekranlar ilk açıldıklarında ya
 * da ana sayfa oturduktan sonra boşta önceden yüklenir (`prefetchScreens`), böylece geçişlerde bekleme olmaz.
 * Sayfa geçişleri React Router'ın geçişleriyle (startTransition) yapılır: parça yüklenirken önceki sayfa ekranda kalır.
 */
type Loader = () => Promise<{ default: ComponentType<any> }> // eslint-disable-line @typescript-eslint/no-explicit-any

const loaders = {
  AppShell: () => import('./AppShell'),
  Monuments: () => import('./screens/Monuments'),
  MonumentPage: () => import('./screens/MonumentPage'),
  Auth: () => import('./screens/Auth'),
  GameLayout: () => import('./GameLayout'),
  GameHome: () => import('./screens/GameHome'),
  GameMonument: () => import('./screens/GameMonument'),
  GuidePage: () => import('./screens/GuidePage'),
  Passport: () => import('./screens/Passport'),
  Account: () => import('./screens/Account'),
  AdminPage: () => import('./screens/AdminPage'),
  City: () => import('./screens/City'),
  RoutePage: () => import('./screens/RoutePage'),
  QuizPage: () => import('./screens/QuizPage'),
  CharacterSelect: () => import('./screens/CharacterSelect'),
  Privacy: () => import('./screens/Privacy'),
} satisfies Record<string, Loader>

export const Screen = {
  AppShell: lazy(loaders.AppShell),
  Monuments: lazy(loaders.Monuments),
  MonumentPage: lazy(loaders.MonumentPage),
  Auth: lazy(loaders.Auth),
  GameLayout: lazy(loaders.GameLayout),
  GameHome: lazy(loaders.GameHome),
  GameMonument: lazy(loaders.GameMonument),
  GuidePage: lazy(loaders.GuidePage),
  Passport: lazy(loaders.Passport),
  Account: lazy(loaders.Account),
  AdminPage: lazy(loaders.AdminPage),
  City: lazy(loaders.City),
  RoutePage: lazy(loaders.RoutePage),
  QuizPage: lazy(loaders.QuizPage),
  CharacterSelect: lazy(loaders.CharacterSelect),
  Privacy: lazy(loaders.Privacy),
}

/** Ana sayfadan en olası geçişler (menü: Keşfet, Harita, Oyun; eser kartı; giriş), önem sırasıyla. */
const LIKELY: (keyof typeof loaders)[] = ['AppShell', 'Monuments', 'MonumentPage', 'Auth', 'GameLayout', 'GameHome', 'GameMonument']

let started = false
/**
 * Boşta önceden yükleme: ilk sahne çizilip ağ ve işlemci boşalınca olası ekranlar sırayla, birer birer indirilir
 * (aynı anda değil: sahne görselleriyle yarışmaz). Veri tasarrufu açıksa yapılmaz; ekranlar yine tıklanınca yüklenir.
 */
export function prefetchScreens(delayMs = 2500) {
  if (started || typeof window === 'undefined') return
  started = true
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  if (nav.connection?.saveData) return
  const idle = (cb: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 4000 })
    else window.setTimeout(cb, 200)
  }
  // Ekranlardan sonra rehber panelinin içeriği (sağ alttaki "Rehbere Sor" ilk açılışta beklemesin).
  const queue: (() => Promise<unknown>)[] = [...LIKELY.map((k) => loaders[k]), () => import('./components/Narrator')]
  const next = () => {
    const load = queue.shift()
    if (!load) return
    load().catch(() => undefined).finally(() => idle(next))
  }
  window.setTimeout(() => idle(next), delayMs)
}
