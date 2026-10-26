import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PhotoGallery, type GalleryPhoto } from './PhotoGallery'

const photos: GalleryPhoto[] = [1, 2, 3].map((n) => ({
  key: `p${n}`,
  src: `/media/${n}.jpeg`,
  width: n === 1 ? 180 : 1200,
  height: 120,
  alt: `Kurgusal eser — fotoğraf ${n}`,
  caption: `Açıklama ${n}`,
  credit: `Kaynak ${n}`,
}))

const main = () => screen.getByRole('button', { name: 'Büyük görünümde aç' }).querySelector('img')!

describe('PhotoGallery', () => {
  it('önceki/sonraki ile döner, sayaç ve açıklama değişir', async () => {
    const user = userEvent.setup()
    render(<PhotoGallery photos={photos} label="Kurgusal eser fotoğrafları" />)
    expect(main()).toHaveAttribute('src', '/media/1.jpeg')
    expect(screen.getAllByText('1 / 3')[0]).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Önceki fotoğraf' })[0])
    expect(main()).toHaveAttribute('src', '/media/3.jpeg')
    await user.click(screen.getAllByRole('button', { name: 'Sonraki fotoğraf' })[0])
    expect(main()).toHaveAttribute('src', '/media/1.jpeg')
    expect(screen.getAllByText('Açıklama 1')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Kaynak 1')[0]).toBeInTheDocument()
  })

  it('küçük fotoğrafı özgün genişliğinden büyütmez', () => {
    render(<PhotoGallery photos={photos} label="g" />)
    expect(main().style.maxWidth).toBe('min(100%, 180px)')
  })

  it('klavye ve kaydırma ile gezinir; küçük resim seçilir', async () => {
    const user = userEvent.setup()
    render(<PhotoGallery photos={photos} label="g" />)
    const region = screen.getByRole('region', { name: 'g' })
    fireEvent.keyDown(region, { key: 'ArrowRight' })
    expect(main()).toHaveAttribute('src', '/media/2.jpeg')
    const stage = main().closest('.photo-gallery__stage')!
    fireEvent.touchStart(stage, { touches: [{ clientX: 200 }] })
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 100 }] })
    expect(main()).toHaveAttribute('src', '/media/3.jpeg')
    await user.click(screen.getByRole('button', { name: 'Fotoğraf 1' }))
    expect(main()).toHaveAttribute('src', '/media/1.jpeg')
  })

  it('büyük görünümü açar ve kapatır', async () => {
    const user = userEvent.setup()
    render(<PhotoGallery photos={photos} label="g" />)
    await user.click(screen.getByRole('button', { name: 'Büyük görünümde aç' }))
    const dialog = document.querySelector('dialog')!
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.querySelector('img')).toHaveAttribute('src', '/media/1.jpeg')
    await user.click(screen.getByRole('button', { name: 'Büyük görünümü kapat' }))
    expect(dialog.hasAttribute('open')).toBe(false)
  })
})
