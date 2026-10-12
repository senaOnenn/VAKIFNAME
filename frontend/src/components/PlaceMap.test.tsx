import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../api/types'
import { PLACES, REAL_TYPE_PLACE } from '../test/fixtures'
import PlaceMap, { markerLabel } from './PlaceMap'

// Leaflet tıklamada kaydırma konumunu window.scrollTo ile korur; jsdom bunu desteklemez.
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

// Gerçek Leaflet bileşeni jsdom'da çalışır; jsdom görsel yüklemediği için harita karoları ağa istek atmaz.
function renderMap(selectedId: string | null = null, places: Place[] = PLACES) {
  const onSelect = vi.fn()
  const ui = (id: string | null) => <PlaceMap places={places} selectedId={id} onSelect={onSelect} onTileError={() => {}} />
  const view = render(ui(selectedId))
  const marker = (name: string) => {
    const place = places.find((p) => p.name === name)!
    return view.container.querySelector<HTMLElement>(`.leaflet-marker-icon[title="${markerLabel(place)}"]`)
  }
  return { ...view, onSelect, marker, rerenderWith: (id: string | null) => view.rerender(ui(id)) }
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

  it('klavyeyle seçimden sonra işaretleyici vurgulanır ve odak işaretleyicide kalır', async () => {
    const { marker, onSelect, rerenderWith } = renderMap()
    const el = marker('Test Mekânı A')!
    el.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('test-a')
    rerenderWith('test-a') // Üst bileşenin seçimi geri vermesi
    expect(marker('Test Mekânı A')).toBe(el)
    expect(el).toHaveClass('map-marker--selected')
    expect(el).toHaveFocus()
  })

  // REAL_TYPE_PLACE kurgusal bir test kaydıdır; yalnızca `is_demo: false` gösterimini sınar.
  it('demo ve gerçek-tipli işaretleyicileri ad, sınıf ve açılır pencere metniyle ayırır', async () => {
    const places = [PLACES[0], REAL_TYPE_PLACE]
    const { container, marker } = renderMap(null, places)

    const demo = container.querySelector('.leaflet-marker-icon[title="Test Mekânı A (kurgusal demo konumu)"]')
    expect(demo).toHaveClass('map-marker--demo')
    const real = container.querySelector('.leaflet-marker-icon[title="Test Mekânı G"]')
    expect(real).not.toBeNull()
    expect(real).not.toHaveClass('map-marker--demo')

    await userEvent.click(marker('Test Mekânı G')!)
    await waitFor(() => expect(container.querySelector('.leaflet-popup-content')).toHaveTextContent('Gerçek eser kaydı'))
    expect(container.querySelector('.leaflet-popup-content')).not.toHaveTextContent('Kurgusal')
  })

  it('OpenStreetMap atfını gösterir', () => {
    const { container } = renderMap()
    expect(container.querySelector('.leaflet-control-attribution')).toHaveTextContent('OpenStreetMap')
  })
})
