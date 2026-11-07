import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE, SIGNED_IN, stubFetch } from '../test/fixtures'
import VakifnameApp from './VakifnameApp'
import { resetAuthForTests } from './session'
import { INTRO_SEEN_KEY } from './screens/Intro'

/** R6.9: Vakfiye Odası ve Mühür Defteri aynı oyuncu için aynı yuvaları dolu gösterir (tek, sabit yerleşim). */
// Sunucunun yerleşimi (GET /vakfiye/layout): kimlik sırasından bilerek farklı, yuva sırası buradan gelir.
const IDS = ['BUR-9010', 'BUR-9003', 'BUR-9005', 'BUR-9001', 'BUR-9008', 'BUR-9002', 'BUR-9007', 'BUR-9004', 'BUR-9009', 'BUR-9006']
const NAMES: Record<string, string> = Object.fromEntries(IDS.map((id: string, i: number) => [id, `Eser ${i + 1}`]))
const LOC = (i: number) => ({ latitude: 40.18 + i * 0.001, longitude: 29.06 + i * 0.001 })
// Kazanılma sırası yerleşimden farklı (en yeni önce): yuva 8 (altın), 1, 6, 0.
const EARNED = [
  { id: 'BUR-9009', visit: true, at: '2026-11-04T10:00:00Z' },
  { id: 'BUR-9003', visit: false, at: '2026-11-03T10:00:00Z' },
  { id: 'BUR-9007', visit: false, at: '2026-11-02T10:00:00Z' },
  { id: 'BUR-9010', visit: false, at: '2026-11-01T10:00:00Z' },
]
const done = new Set(EARNED.map((e) => e.id))
const summary = (id: string, i: number) => ({
  monument_id: id, name: NAMES[id], alternative_names: [], type: 'cami', city: 'Bursa', district: 'Osmangazi', address: '-',
  location: { ...LOC(i), accuracy_m: 20 },
  checkin_available: false, fact_count: 1, game_fact_count: 1, image_count: 0, illustration: 'representative_drawing',
})
// Rota durakları başka bir sırada (yürüyüş önerisi): yerleşimi etkilememeli.
const stops = [...IDS].reverse().filter((id) => !done.has(id)).map((id, k) => ({
  monument_id: id, name: NAMES[id], type: 'cami', ...LOC(IDS.indexOf(id)), state: 'unlocked', progress: 'new', quest_ready: true,
  distance_m: 100 * (k + 1), order: k + 1,
}))
const seal = (id: string, kind: string, at: string) => ({ user_id: 'u-oyuncu', monument_id: id, monument_name: NAMES[id], kind, earned_at: at, simulated: false })

function serve() {
  stubFetch({
    '/auth/me': SIGNED_IN,
    '/player/profile': PROFILE,
    '/vakfiye/layout': { body: { city: 'bursa', slots: IDS } },
    '/monuments': { body: { published_count: 10, data_version: 't', generated_at: null, monuments: [...IDS].sort().map((id) => summary(id, IDS.indexOf(id))) } },
    '/route': { body: { city: 'bursa', total: 10, completed_count: 4, next: stops[0].monument_id,
      start: { source: 'last_completed', latitude: 40.18, longitude: 29.06 }, stops,
      completed: EARNED.map((e) => ({ monument_id: e.id, name: NAMES[e.id], earned_at: e.at, visit: e.visit })) } },
    '/users/u-oyuncu/seals': { body: { user_id: 'u-oyuncu', monuments: [],
      knowledge_seals: EARNED.map((e) => seal(e.id, 'knowledge', e.at)),
      visit_seals: EARNED.filter((e) => e.visit).map((e) => seal(e.id, 'visit', e.at)) } },
  })
}
const filled = () => [...document.querySelectorAll('.vk-puzzle .vk-piece')].map((g, i) => {
  const state = [...g.classList].find((c) => c.startsWith('vk-piece--'))!.slice('vk-piece--'.length)
  return state === 'missing' ? null : `${i}:${state}`
}).filter(Boolean)

beforeEach(() => {
  resetAuthForTests()
  window.localStorage.clear()
  window.localStorage.setItem('vakifname.gameCity', 'bursa')
  window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
})
afterEach(() => vi.unstubAllGlobals())

describe('tek vakfiye yerleşimi (R6.9)', () => {
  it('Vakfiye Odası ve Mühür Defteri aynı 4 yuvayı aynı durumla dolu gösterir', async () => {
    const expected = ['0:found', '1:found', '6:found', '8:gold'] // sunucu yerleşiminde yuva 0, 1, 6 ve 8 (altın)
    serve()
    window.history.replaceState(null, '', '/oyun')
    render(<VakifnameApp />)
    await screen.findByRole('img', { name: /Kayıp Vakfiye: 10 parçadan 4 parça bulundu, 1 parça altın/ })
    const room = filled()
    expect(room).toEqual(expected)
    cleanup()

    resetAuthForTests()
    serve()
    window.history.replaceState(null, '', '/pasaport')
    render(<VakifnameApp />)
    await screen.findByRole('img', { name: /Kayıp Vakfiye: 10 parçadan 4 parça bulundu, 1 parça altın/ })
    expect(filled()).toEqual(room)
  })
})
