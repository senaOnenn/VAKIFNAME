import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  // Node ortamında çalışan testlerde (ör. heroVideo.test.ts) DOM yoktur.
  if (typeof window === 'undefined') return
  cleanup()
  window.history.replaceState(null, '', '/')
})
