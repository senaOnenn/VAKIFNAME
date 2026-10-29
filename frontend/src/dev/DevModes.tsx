import '../styles.css'
import { lazy, Suspense } from 'react'
import { ModeSwitch } from '../components/ModeSwitch'
import type { AppMode } from '../mode'

// Yalnızca geliştirme sunucusunda yüklenir (App.tsx). Genel kullanıcı arayüzünde mod seçici yoktur.
const InventoryApp = lazy(() => import('../internal/InventoryApp'))

/** Geliştirme ortamı: yetkili dahili envanter (inceleme ve onay ekranı). */
export default function DevModes({ mode }: { mode: Exclude<AppMode, 'katalog'> }) {
  return (
    <>
      <ModeSwitch mode={mode} />
      <Suspense fallback={<p className="container inventory-loading">Yükleniyor…</p>}>
        <InventoryApp />
      </Suspense>
    </>
  )
}
