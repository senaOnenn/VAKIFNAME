import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { resetLangForTests } from './i18n'
import { INTRO_SEEN_KEY } from './screens/Intro'
import { resetAuthForTests } from './session'
import VakifnameApp from './VakifnameApp'

// Faz 9: tanıtım sayfasında "Tanıtım filmini izle" — film derlemeye girdiyse görünür; altyazı varsayılan açık.

function open(film: boolean) {
  stubFetch({
    '/auth/me': { status: 401, body: {} },
    '/monuments': { body: { published_count: 0, data_version: 't', generated_at: null, monuments: [] } },
    ...(film ? { '/media/tanitim.mp4': { status: 200, body: {} } } : {}),
  })
  window.history.replaceState(null, '', '/')
  render(<VakifnameApp />)
}

beforeEach(() => {
  resetAuthForTests()
  resetLangForTests()
  window.localStorage.clear()
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('tanıtım filmi', () => {
  it('film varsa düğme görünür; pencerede altyazılı video açılır ve "Kapat" ile kapanır', async () => {
    open(true)
    await userEvent.click(await screen.findByRole('button', { name: /Tanıtım filmini izle/ }))
    const video = document.querySelector('video.vk-film__video') as HTMLVideoElement
    expect(video).toBeTruthy()
    expect(video.getAttribute('src')).toMatch(/^\/media\/tanitim\.mp4\?v=\w+$/)
    expect(video.hasAttribute('controls')).toBe(true)
    const tracks = [...video.querySelectorAll('track')]
    expect(tracks.map((tr) => [tr.getAttribute('srclang'), tr.hasAttribute('default')])).toEqual([['tr', true], ['en', false]])
    expect(screen.getByText(/yapay zekâ ile üretildi/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }))
    expect(document.querySelector('video.vk-film__video')).toBeNull()
  })

  it('film derlemede yoksa düğme hiç görünmez', async () => {
    open(false)
    expect(await screen.findByRole('heading', { level: 1, name: 'Geçmişi Keşfet, Mirası Yaşat.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tanıtım filmini izle/ })).not.toBeInTheDocument()
  })
})
