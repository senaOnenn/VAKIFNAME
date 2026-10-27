import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom `scrollTo`'yu uygulamaz (konsola hata yazar); sayfa geçişi testleri için sessiz bir yer tutucu.
if (typeof window !== 'undefined') window.scrollTo = () => {}

afterEach(() => {
  // Node ortamında çalışan testlerde (ör. heroVideo.test.ts) DOM yoktur.
  if (typeof window === 'undefined') return
  cleanup()
  window.history.replaceState(null, '', '/')
})
