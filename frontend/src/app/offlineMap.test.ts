import { describe, expect, it } from 'vitest'
import { decodeRoads, loadOfflineRoads } from './components/offline-map/roads'

describe('bağlantı yokken harita altlığı', () => {
  it('fark kodlu çizgileri çözer', () => {
    const r = decodeRoads({ major: [[4018758, 2905468, 10, -20, 5, 5]], minor: [], river: [] })
    expect(r.major[0]).toEqual([[40.18758, 29.05468], [40.18768, 29.05448], [40.18773, 29.05453]])
  })

  it('paketteki yollar şehir merkezini ve eserlerin bölgesini kapsar', async () => {
    const r = await loadOfflineRoads()
    expect(r.major.length).toBeGreaterThan(50)
    const all = [...r.major, ...r.minor].flat()
    const lat = all.map((p) => p[0])
    const lng = all.map((p) => p[1])
    expect(Math.min(...lat)).toBeLessThan(40.184) // en güneydeki eser 40.1839
    expect(Math.max(...lat)).toBeGreaterThan(40.191)
    expect(Math.min(...lng)).toBeLessThan(29.046)
    expect(Math.max(...lng)).toBeGreaterThan(29.0635)
  })
})
