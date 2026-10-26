import { describe, expect, it } from 'vitest'
import { groupOverlapping, markerShape, markerTitle } from './researchMapModel'
import type { LocationCandidateRow } from './types'

// Kurgusal adaylar; BUR-9xxx kimlikleri gerçek V20 eserleri değildir.
const row = (id: string, lat: number, lon: number, over: Partial<LocationCandidateRow> = {}): LocationCandidateRow => ({
  monument_id: `BUR-${id.slice(3, 7)}`,
  monument_name: `Test ${id}`,
  candidate_id: id,
  latitude: lat,
  longitude: lon,
  represents: 'building_footprint_centroid',
  estimated_accuracy_m: 20,
  source_id: 'S-9001-OSM',
  source_kind: 'open_map_data',
  source_object: 'osm:way/1@v1',
  status: 'unverified',
  monument_location_status: 'unverified',
  notes: null,
  other_candidates: [],
  nearest_other_monument: null,
  competing_discrepancy_ids: [],
  flags: [],
  checkin_entry_point: null,
  ...over,
})

// 1 derece = 100 000 px: 0,0001 derece fark 10 px eder.
const project = (lat: number, lon: number) => ({ x: lon * 100_000, y: lat * 100_000 })

describe('araştırma haritası modeli', () => {
  it('yakın adayları gruplar, uzaktakileri ayrı bırakır; hiçbir aday kaybolmaz', () => {
    const a = row('LC-9001-01', 40.0, 29.0)
    const b = row('LC-9001-02', 40.0001, 29.0) // 10 px
    const c = row('LC-9002-01', 40.0002, 29.0) // b'ye 10 px: zincirle aynı grup
    const far = row('LC-9003-01', 40.01, 29.0)
    const groups = groupOverlapping([a, b, c, far], project, 30)
    expect(groups.map((g) => g.candidates.map((x) => x.candidate_id))).toEqual([
      ['LC-9001-01', 'LC-9001-02', 'LC-9002-01'],
      ['LC-9003-01'],
    ])
    expect(groups.flatMap((g) => g.candidates)).toHaveLength(4)
  })

  it('grup işaretçisini uydurma ortalama noktaya değil gerçek bir adayın koordinatına koyar', () => {
    const [g] = groupOverlapping([row('LC-9001-01', 40.0, 29.0), row('LC-9001-02', 40.0001, 29.0001)], project, 30)
    expect([g.latitude, g.longitude]).toEqual([40.0, 29.0])
  })

  it('her işaretçi doğrulanmamış aday olarak etiketlenir; alan ve bina merkezi ayrılır', () => {
    const competing = row('LC-9001-01', 40, 29, { flags: ['competing_candidate'], represents: 'point_feature' })
    expect(markerTitle(competing)).toBe('Doğrulanmamış konum adayı: Test LC-9001-01 (LC-9001-01) · çelişen aday')
    expect(markerShape(row('LC-9001-02', 40, 29, { represents: 'area_centroid' }))).toBe('area')
    expect(markerShape(row('LC-9001-03', 40, 29))).toBe('building')
    expect(markerShape(row('LC-9001-04', 40, 29, { source_kind: 'open_knowledge_base', represents: 'point_feature' })))
      .toBe('crosscheck')
  })
})
