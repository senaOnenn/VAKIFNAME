import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GalleryPreview, GalleryPreviewItem, MonumentSummary } from './types'
import { ZipGalleryPreviewPanel } from './ZipGalleryPreview'

const it_ = (id: string, over: Partial<GalleryPreviewItem> = {}): GalleryPreviewItem => ({
  image_id: id,
  folder_monument_id: 'BUR-9001',
  card_url: `/internal/review/media/card/${id}`,
  detail_url: `/internal/review/media/detail/${id}`,
  width: 640,
  height: 480,
  caption: `Açıklama ${id}`,
  source: `Hackathon veri paketi (ZIP) · Test(BUR-9001)/${id}.jpeg`,
  source_url: null,
  quality: { short_side_px: 480, resolution: 'orta' },
  rights: { image_rights: 'pending', image_publication: 'pending', image_reference_index: 'pending' },
  publishable: false,
  ...over,
})

const preview: GalleryPreview = {
  monument_id: 'BUR-9001',
  name: 'Kurgusal Cami',
  public: false,
  sections: {
    published: [],
    commons_candidates: [],
    zip_gallery: [it_('ok1')],
    zip_review: [it_('bad1', { caption: 'Klasör Kurgusal Cami diyor; fotoğraf kitapta başka yapının bölümünde basılı.' })],
    zip_proposed_here: [it_('moved1', { folder_monument_id: 'BUR-9002' })],
  },
  zip_rights: { license_status: 'izin_belgesi_bekleniyor', allowed_now: 'dahili', finding: 'Yazılı izin gerekir.', required_for_publication: 'x' },
}
const monuments = [{ monument_id: 'BUR-9001', name: 'Kurgusal Cami' }] as unknown as MonumentSummary[]

afterEach(() => vi.unstubAllGlobals())

describe('ZIP galeri önizlemesi', () => {
  it('çelişkili fotoğrafları eser galerisine koymaz, önerileri klasörüyle gösterir', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path.startsWith('/internal/review/media/')) return new Response('x', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      return new Response(JSON.stringify(preview), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    const user = userEvent.setup()
    render(<ZipGalleryPreviewPanel monuments={monuments} />)

    const gallery = await screen.findByRole('region', { name: 'ZIP galeri adayları' })
    expect(within(gallery).getAllByText(/Açıklama ok1/)[0]).toBeInTheDocument()
    expect(within(gallery).queryByText(/bad1/)).toBeNull()
    expect(within(gallery).getAllByText(/Hak bekliyor · yayın bekliyor · referans bekliyor/)[0]).toBeInTheDocument()
    const moved = screen.getByRole('region', { name: 'Başka klasörden bu esere önerilenler' })
    expect(within(moved).getAllByText(/ZIP klasörü: BUR-9002/)[0]).toBeInTheDocument()
    expect(screen.getByText(/genel yayın değildir/)).toBeInTheDocument()

    const review = screen.getByText(/İncelemeye ayrılanlar/).closest('details')!
    expect(review.open).toBe(false)
    await user.click(within(review).getByText(/İncelemeye ayrılanlar/))
    expect(within(review).getByText(/başka yapının bölümünde/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([u]) => String(u).includes('/internal/'))).toBe(true)
  })
})
