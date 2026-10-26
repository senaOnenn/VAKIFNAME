import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoHero } from './VideoHero'

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const video = () => document.querySelector('video')

describe('video giriş', () => {
  it('başlık, slogan ve iki eylemi gösterir; video sessiz, döngülü, satır içi ve otomatik oynar', () => {
    reducedMotion(false)
    render(<VideoHero />)
    expect(screen.getByRole('heading', { level: 1, name: 'VAKIFNAME' })).toBeInTheDocument()
    expect(screen.getByText('Geçmişi Keşfet, Mirası Yaşat.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Eserleri Keşfet' })).toHaveAttribute('href', '#katalog')
    expect(screen.getByRole('link', { name: 'Hikâyeye Başla' })).toHaveAttribute('href', '#hikaye')
    const v = video()!
    expect(v.autoplay && v.loop && v.muted).toBe(true)
    expect(v).toHaveAttribute('playsinline')
    expect(v.defaultMuted).toBe(true)
    expect(v.querySelector('source')).toHaveAttribute('src', '/media/hero.mp4')
    // Video oynayana kadar temsilî çizim görünür.
    expect(document.querySelector('.video-hero__fallback svg')).not.toBeNull()
    expect(screen.getByText(/Temsilî çizim/)).toBeInTheDocument()
  })

  it('oynamaya başlayınca temsilî/üretilmiş görüntü notunu ve duraklatma düğmesini gösterir', () => {
    reducedMotion(false)
    render(<VideoHero />)
    act(() => {
      fireEvent.playing(video()!)
    })
    expect(screen.getByText(/yapay zekâ ile üretilmiş görüntü · Gerçek bir Bursa eserinin kaydı değildir/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Videoyu duraklat' })).toBeInTheDocument()
  })

  it('video yüklenemezse videoyu kaldırır ve mimari çizimde kalır', () => {
    reducedMotion(false)
    render(<VideoHero />)
    act(() => {
      fireEvent.error(video()!.querySelector('source')!)
    })
    expect(video()).toBeNull()
    expect(document.querySelector('.video-hero__fallback svg')).not.toBeNull()
    expect(screen.getByText('Temsilî çizim · Eser fotoğrafı değildir')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Video/ })).not.toBeInTheDocument()
  })

  it('azaltılmış hareket tercihinde kendiliğinden oynamaz; kullanıcı isterse oynatır', async () => {
    reducedMotion(true)
    render(<VideoHero />)
    expect(video()).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Giriş videosunu oynat' }))
    expect(video()).not.toBeNull()
  })
})
