import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RouteResult } from './api'
import { KasifPortrait } from './components/KasifPortrait'
import { ledger } from './gameModel'
import { vakfiyeBoard, vakfiyeSlots } from './vakfiye'

/** R6.5: rota defterinin saf hesapları (sunucunun kilit kuralını oyuncuya önceden söyler) ve kâşif portreleri. */
const stop = (id: string, name: string, lat: number, lng: number, progress: 'new' | 'started', order: number) =>
  ({ monument_id: id, name, type: 'cami', latitude: lat, longitude: lng, state: 'unlocked' as const, progress, distance_m: order * 100, order })

const ROUTE: RouteResult = {
  city: 'bursa', total: 6, completed_count: 1,
  start: { source: 'city_center', latitude: 40.18, longitude: 29.06 },
  next: 'A',
  stops: [
    stop('A', 'Eser A', 40.18, 29.06, 'new', 1),
    stop('B', 'Eser B', 40.19, 29.06, 'started', 2),
    stop('C', 'Eser C', 40.30, 29.30, 'new', 3),
    stop('X', 'Eser X', 40.181, 29.061, 'new', 4),
    stop('Y', 'Eser Y', 40.31, 29.31, 'new', 5),
  ],
  completed: [{ monument_id: 'D', name: 'Tamam D', earned_at: '2026-11-01T10:00:00Z', visit: true }],
}

describe('eserler defteri (R6.7: kilit yok)', () => {
  it('her eser hesaba bağlı durumuyla: henüz keşfedilmedi, göreve başlandı, bilgi mührü, altın mühür', () => {
    const rows = ledger(ROUTE)
    expect(rows.map((r) => `${r.monument_id}:${r.state}`)).toEqual(['A:new', 'B:started', 'C:new', 'X:new', 'Y:new', 'D:gold'])
    expect(rows.find((r) => r.next)?.monument_id).toBe('A')
  })

  it('R6.9: vakfiye yerleşimi sunucudan gelir ve sabittir; kazanılma sırası yuvayı değiştirmez', () => {
    const layout = ['BUR-9005', 'BUR-9001', 'BUR-9003', 'BUR-9002', 'BUR-9004']
    expect(vakfiyeSlots(layout, ['BUR-9001', 'BUR-9002', 'BUR-9003', 'BUR-9004', 'BUR-9005'])).toEqual(layout)
    const mons = layout.map((id) => ({ monument_id: id, name: id }))
    const a = vakfiyeBoard(layout, mons, new Set(['BUR-9003', 'BUR-9001']), new Set(['BUR-9003']))
    const b = vakfiyeBoard(layout, [...mons].reverse(), new Set(['BUR-9001', 'BUR-9003']), new Set(['BUR-9003']))
    expect(a.states).toEqual(b.states)
    expect(a.states.map((s, i) => (s === 'missing' ? null : `${i}:${s}`)).filter(Boolean)).toEqual(['1:found', '2:gold'])
    // Yerleşimde olmayan (sonradan yayımlanan) eser sona eklenir; var olan yuvalar kaymaz. Yerleşim yoksa kimlik sırası.
    expect(vakfiyeSlots(layout, [...layout, 'BUR-9042']).indexOf('BUR-9003')).toBe(2)
    expect(vakfiyeSlots(null, ['BUR-9002', 'BUR-9001'])).toEqual(['BUR-9001', 'BUR-9002'])
  })
})

describe('kâşif portreleri (R6.5)', () => {
  it('üç kâşif dört aşamada çizilir; üst aşama katman ekler (muhafızda balmumu mühür)', () => {
    for (const id of ['gezgin', 'nakkas', 'katip'] as const) {
      const { container, unmount } = render(<KasifPortrait id={id} stage="baslangic" />)
      const base = container.querySelectorAll('svg *').length
      unmount()
      const top = render(<KasifPortrait id={id} stage="muhafiz" />)
      expect(top.container.querySelectorAll('svg *').length).toBeGreaterThan(base)
      expect(top.container.querySelector('svg')).toHaveAttribute('data-stage', 'muhafiz')
      top.unmount()
    }
  })

  it('adı verilince ekran okuyucuya okunur, verilmezse dekoratiftir', () => {
    render(<><KasifPortrait id="katip" title="Kâtip Çırağı" /><KasifPortrait id="gezgin" /></>)
    expect(screen.getByRole('img', { name: 'Kâtip Çırağı' })).toBeInTheDocument()
    expect(document.querySelector('svg[data-character="gezgin"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
