import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stubFetch } from '../test/fixtures'
import type { ResearchMapProps } from './ResearchMap'
import { ResearchMapPanel } from './ResearchMapPanel'
import type { LocationCandidateRow, MonumentSummary } from './types'

// Leaflet jsdom'da ölçü alamaz; harita, kendisine verilen adayları listeleyen bir yer tutucuyla değiştirilir. Gerçek
// işaretçi ve üst üste binme davranışı tarayıcı testinde (frontend/e2e) doğrulanır.
vi.mock('./ResearchMap', () => ({
  default: ({ candidates, onSelectMonument }: ResearchMapProps) => (
    <ul aria-label="Harita işaretçileri">
      {candidates.map((c) => (
        <li key={c.candidate_id}>
          <button type="button" onClick={() => onSelectMonument(c.monument_id)}>
            {c.candidate_id} → {c.monument_id}
          </button>
        </li>
      ))}
    </ul>
  ),
}))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Kurgusal kayıtlar; BUR-9xxx kimlikleri gerçek V20 eserleri değildir.
const monument = (id: string, name: string) => ({ monument_id: id, name }) as MonumentSummary
const MONUMENTS = [monument('BUR-9001', 'Test Türbesi'), monument('BUR-9002', 'Test Bedesteni'), monument('BUR-9003', 'Konumsuz Eser')]

const cand = (id: string, mid: string, over: Partial<LocationCandidateRow> = {}): LocationCandidateRow => ({
  monument_id: mid,
  monument_name: mid,
  candidate_id: id,
  latitude: 40.19,
  longitude: 29.05,
  represents: 'point_feature',
  estimated_accuracy_m: 25,
  source_id: 'S-x-OSM',
  source_kind: 'open_map_data',
  source_object: 'osm:node/1@v1',
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

const BODY = {
  candidates: [
    cand('LC-9001-01', 'BUR-9001', { flags: ['competing_candidate'], competing_discrepancy_ids: ['D-9001-01'] }),
    cand('LC-9001-02', 'BUR-9001', { represents: 'building_footprint_centroid', flags: ['competing_candidate'],
                                     competing_discrepancy_ids: ['D-9001-01'], source_object: 'osm:way/2@v2' }),
    cand('LC-9002-01', 'BUR-9002', { represents: 'area_centroid', source_object: 'osm:way/3@v1' }),
  ],
  flag_labels: {},
  monuments_with_candidates: 2,
  verified: 0,
  entry_points_available: 0,
  attribution: '© OpenStreetMap katkıcıları',
}

describe('Bursa araştırma haritası', () => {
  it('tüm eserleri listeler, adayları doğru esere bağlar, konumsuz eseri haritaya koymaz', async () => {
    stubFetch({ '/internal/review/location-candidates': { body: BODY } })
    render(<ResearchMapPanel monuments={MONUMENTS} selectedId={null} onSelect={() => {}} />)
    const list = await screen.findByRole('list', { name: 'Gerçek eserler ve konum adayları' })
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    const cem = within(list).getByRole('list', { name: 'Test Türbesi konum adayları' })
    expect(within(cem).getAllByRole('listitem')).toHaveLength(2)
    expect(cem).toHaveTextContent('LC-9001-01 · Doğrulanmamış konum adayı · Nokta nesnesi')
    expect(cem).toHaveTextContent('çelişen aday (D-9001-01)')
    expect(within(list).getByRole('list', { name: 'Test Bedesteni konum adayları' })).toHaveTextContent(
      'Kullanım alanı merkezi (bina değil)',
    )
    expect(within(list).getByText('Koordinat adayı yok; haritada gösterilmez.')).toBeInTheDocument()
    const markers = await screen.findByRole('list', { name: 'Harita işaretçileri' })
    expect(within(markers).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'LC-9001-01 → BUR-9001',
      'LC-9001-02 → BUR-9001',
      'LC-9002-01 → BUR-9002',
    ])
    expect(screen.getByText(/3 eser · 2 eserde toplam 3 aday · 1 eserde aday yok/)).toBeInTheDocument()
  })

  it('haritada veya listede seçilen eser için ayrıntı panelini açtırır', async () => {
    const onSelect = vi.fn()
    stubFetch({ '/internal/review/location-candidates': { body: BODY } })
    render(<ResearchMapPanel monuments={MONUMENTS} selectedId={null} onSelect={onSelect} />)
    await userEvent.click(await screen.findByRole('button', { name: 'LC-9002-01 → BUR-9002' }))
    await userEvent.click(screen.getByRole('button', { name: /BUR-9001 Test Türbesi/ }))
    expect(onSelect.mock.calls).toEqual([['BUR-9002'], ['BUR-9001']])
  })
})
