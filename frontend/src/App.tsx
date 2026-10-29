import { lazy, Suspense, useState } from 'react'
import VakifnameApp from './app/VakifnameApp'
import { readMode } from './mode'

// Geliştirme araçları (dahili envanter ve mod seçici) tek bir parçadadır. `import.meta.env.DEV`
// derleme sırasında sabite çevrilir: üretim derlemesinde bu dal ve modülleri pakete hiç girmez (mode.ts,
// scripts/check-public-build.mjs). Koşul burada doğrudan yazılmalı: başka modülden gelen sabit dinamik import'u elemez.
const DevModes = import.meta.env.DEV ? lazy(() => import('./dev/DevModes')) : null

/** Genel platform: VAKIFNAME arayüzü (açılış → giriş → şehir). Geliştirme sunucusunda `?mod=envanter` dahili envanteri açar. */
export default function App() {
  const [mode] = useState(readMode)
  if (DevModes && mode !== 'katalog') {
    return (
      <Suspense fallback={<p className="container inventory-loading">Geliştirme aracı yükleniyor…</p>}>
        <DevModes mode={mode} />
      </Suspense>
    )
  }
  return <VakifnameApp />
}
