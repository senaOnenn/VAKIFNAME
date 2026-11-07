import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetLangForTests } from '../app/i18n'

// R6.12: ekranlar ayrı parçalardan yüklenir (React.lazy); Vitest bir modülü ilk kullanımda derlediği için yük altında
// ilk görünüm 1 sn'yi aşabiliyor. `findBy…`/`waitFor` için bekleme üst sınırı 3 sn (başarılı test yine hemen biter).
configure({ asyncUtilTimeout: 3000 })

// Node 25'in deneysel global `localStorage`'ı (--localstorage-file yolu verilmeden) jsdom'unkini gölgeler ve metotları
// çalışmaz. Depolama kullanılamıyorsa testlere bellek içi bir Storage verilir.
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}
if (typeof window !== 'undefined') {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    let ok = false
    try {
      ok = typeof window[name]?.getItem === 'function'
    } catch {
      ok = false
    }
    if (!ok) Object.defineProperty(window, name, { value: memoryStorage(), configurable: true })
  }
}

// jsdom tarayıcı dilini en-US verir; uygulama testleri Türkçe arayüzle yazıldı (İngilizce testler dili kendisi seçer).
if (typeof window !== 'undefined') {
  Object.defineProperty(window.navigator, 'languages', { value: ['tr-TR', 'tr'], configurable: true })
  Object.defineProperty(window.navigator, 'language', { value: 'tr-TR', configurable: true })
}

// jsdom `scrollTo`'yu uygulamaz (konsola hata yazar); sayfa geçişi testleri için sessiz bir yer tutucu.
if (typeof window !== 'undefined') window.scrollTo = () => {}

afterEach(() => {
  // Node ortamında çalışan testlerde (ör. heroVideo.test.ts) DOM yoktur.
  if (typeof window === 'undefined') return
  cleanup()
  window.history.replaceState(null, '', '/')
  resetLangForTests()
})
