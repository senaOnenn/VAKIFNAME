import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ArchitectureDrawing, drawingVariantFor } from './ArchitectureDrawing'
import { Header } from './Header'

describe('üst bar menüsü', () => {
  it('menü düğmesi ana menüyü kontrol eder ve başlangıçta kapalıdır', () => {
    render(<Header />)
    const button = screen.getByRole('button', { name: 'Menü' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'ana-menu')
    expect(screen.getByRole('navigation', { name: 'Ana menü' })).toHaveAttribute('id', 'ana-menu')
  })

  it('düğmeyle açılır, bir bağlantı seçilince kapanır', async () => {
    render(<Header />)
    const button = screen.getByRole('button', { name: 'Menü' })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: 'Ana menü' })).toHaveClass('site-nav--open')

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', { name: 'Görevler' }))
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape menüyü kapatır ve odağı menü düğmesine geri verir', async () => {
    render(<Header />)
    const button = screen.getByRole('button', { name: 'Menü' })
    await userEvent.click(button)
    await userEvent.tab()
    expect(within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', { name: 'Keşfet' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })
})

describe('temsili mimari çizim', () => {
  it('ekran okuyucudan gizlenir; açıklaması görünür metinle verilir', () => {
    const { container } = render(<ArchitectureDrawing variant="turbe" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('çizim türünü sıraya göre döngüsel seçer', () => {
    expect([0, 1, 2, 3].map(drawingVariantFor)).toEqual(['kubbeli', 'revakli', 'turbe', 'kubbeli'])
  })
})
