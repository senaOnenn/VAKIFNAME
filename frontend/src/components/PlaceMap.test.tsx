import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLACES } from '../test/fixtures'
import PlaceMap from './PlaceMap'

// Leaflet tıklamada kaydırma konumunu window.scrollTo ile korur; jsdom bunu desteklemez.
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

// Gerçek Leaflet bileşeni jsdom'da çalışır; jsdom görsel yüklemediği için harita karoları ağa istek atmaz.
function renderMap(selectedId: string | null = null) {
  const onSelect = vi.fn()
  const view = render(<PlaceMap places={PLACES} selectedId={selectedId} onSelect={onSelect} onTileError={() => {}} />)
  const marker = (name: string) => view.container.querySelector<HTMLElement>(`.leaflet-marker-icon[title="${name}"]`)
  return { ...view, onSelect, marker }
}

describe('PlaceMap', () => {
  it('her eser için klavyeyle erişilebilir, adlandırılmış bir işaretleyici oluşturur', () => {
    const { marker } = renderMap()
    for (const place of PLACES) {
      const el = marker(place.name)
      expect(el).not.toBeNull()
      expect(el).toHaveAttribute('role', 'button')
      expect(el).toHaveAttribute('tabindex', '0')
    }
  })

  it('işaretleyiciye tıklanınca eseri seçer ve adını açılır pencerede gösterir', async () => {
    const { marker, onSelect, container } = renderMap()
    await userEvent.click(marker('Test Mekânı B')!)
    expect(onSelect).toHaveBeenCalledWith('test-b')
    await waitFor(() => expect(container.querySelector('.leaflet-popup-content')).toHaveTextContent('Test Mekânı B'))
    expect(container.querySelector('.leaflet-popup-content')).toHaveTextContent('Kurgusal demo konumu')
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Boşluk', ' '],
  ])('klavyede odaklanılan işaretleyici %s ile seçilir', async (_label, key) => {
    const { marker, onSelect } = renderMap()
    marker('Test Mekânı A')!.focus()
    await userEvent.keyboard(key)
    expect(onSelect).toHaveBeenCalledWith('test-a')
  })

  it('seçili eseri vurgular ve açılır penceresini açar', async () => {
    const { marker, container } = renderMap('test-a')
    expect(marker('Test Mekânı A')).toHaveClass('map-marker--selected')
    expect(marker('Test Mekânı B')).not.toHaveClass('map-marker--selected')
    await waitFor(() => expect(container.querySelector('.leaflet-popup-content')).toHaveTextContent('Test Mekânı A'))
  })

  it('OpenStreetMap atfını gösterir', () => {
    const { container } = renderMap()
    expect(container.querySelector('.leaflet-control-attribution')).toHaveTextContent('OpenStreetMap')
  })
})
