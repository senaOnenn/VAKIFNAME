import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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

// jsdom `scrollTo`'yu uygulamaz (konsola hata yazar); sayfa geçişi testleri için sessiz bir yer tutucu.
if (typeof window !== 'undefined') window.scrollTo = () => {}

afterEach(() => {
  // Node ortamında çalışan testlerde (ör. heroVideo.test.ts) DOM yoktur.
  if (typeof window === 'undefined') return
  cleanup()
  window.history.replaceState(null, '', '/')
})
