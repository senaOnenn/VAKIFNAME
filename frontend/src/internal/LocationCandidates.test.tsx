import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import { LocationCandidatesPanel } from './LocationCandidates'
import type { LocationCandidateRow, LocationCandidatesResponse } from './types'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Kurgusal adaylar; BUR-9xxx kimlikleri gerçek V20 eserleri değildir.
const row = (over: Partial<LocationCandidateRow>): LocationCandidateRow => ({
  monument_id: 'BUR-9001',
  monument_name: 'Test Türbesi',
  candidate_id: 'LC-9001-01',
  latitude: 40.1,
  longitude: 29.1,
  represents: 'point_feature',
  estimated_accuracy_m: 25,
  source_id: 'S-9001-OSM',
  source_kind: 'open_map_data',
  source_object: 'osm:node/1@v1',
  status: 'unverified',
  monument_location_status: 'unverified',
  notes: null,
  other_candidates: [{ candidate_id: 'LC-9001-02', distance_m: 30.3 }],
  nearest_other_monument: { monument_id: 'BUR-9002', candidate_id: 'LC-9002-01', distance_m: 41.7 },
  competing_discrepancy_ids: ['D-9001-01'],
  flags: ['competing_candidate', 'centroid_not_entrance', 'burial_site'],
  checkin_entry_point: null,
  ...over,
})

const BODY: LocationCandidatesResponse = {
  candidates: [row({}), row({ candidate_id: 'LC-9001-02', represents: 'area_centroid',
                              flags: ['area_not_building', 'centroid_not_entrance'], competing_discrepancy_ids: [] })],
  flag_labels: {
    competing_candidate: 'Aynı eser için çelişen aday.',
    centroid_not_entrance: 'Güvenli giriş noktası değildir.',
    area_not_building: 'Kullanım alanının merkezi; bina sınırı değildir.',
    burial_site: 'Kabir alanı.',
  },
  monuments_with_candidates: 1,
  verified: 0,
  entry_points_available: 0,
  attribution: '© OpenStreetMap katkıcıları',
}

describe('koordinat adayları tablosu', () => {
  it('çelişen adayları, alan/bina ayrımını ve giriş noktası eksikliğini gösterir; hiçbirini doğrulanmış saymaz', async () => {
    stubFetch({ '/internal/review/location-candidates': { body: BODY } })
    render(<LocationCandidatesPanel />)
    await userEvent.click(screen.getByText(/karşılaştırmalı inceleme tablosu/))
    const table = await screen.findByRole('region', { name: 'Koordinat adayları karşılaştırması' })
    const [first, second] = within(table).getAllByRole('row').slice(1)
    expect(first).toHaveTextContent('Aynı eser için çelişen aday. (D-9001-01)')
    expect(first).toHaveTextContent('LC-9001-02: 30.3 m')
    expect(first).toHaveTextContent('BUR-9002: 41.7 m')
    expect(first).toHaveTextContent('Kabir alanı.')
    expect(second).toHaveTextContent('Kullanım alanı merkezi')
    expect(second).toHaveTextContent('bina sınırı değildir')
    expect(within(table).getAllByText('Koordinat doğrulanmadı')).toHaveLength(2)
    expect(screen.getByText(/doğrulanmış konum: 0 · güvenli giriş noktası: 0/)).toBeInTheDocument()
  })
})
