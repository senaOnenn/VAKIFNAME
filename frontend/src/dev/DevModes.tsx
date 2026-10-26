import { lazy, Suspense } from 'react'
import { ModeSwitch } from '../components/ModeSwitch'
import type { AppMode } from '../mode'

// Yalnızca geliştirme sunucusunda yüklenir (App.tsx). Genel kullanıcı arayüzünde mod seçici veya demo yoktur.
const InventoryApp = lazy(() => import('../internal/InventoryApp'))
const DemoGame = lazy(() => import('../demo/DemoGame'))

/** Geliştirme ortamı: yetkili dahili envanter ve otomatik testler için Demo Keşif Oyunu. */
export default function DevModes({ mode }: { mode: Exclude<AppMode, 'katalog'> }) {
  return (
    <>
      <ModeSwitch mode={mode} />
      <Suspense fallback={<p className="container inventory-loading">Yükleniyor…</p>}>
        {mode === 'envanter' ? <InventoryApp /> : <DemoGame />}
      </Suspense>
    </>
  )
}
