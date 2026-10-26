import { useEffect, useRef, useState } from 'react'
import { ArchitectureDrawing } from './ArchitectureDrawing'

/**
 * Ana sayfanın sinematik girişi. Video, Vite eklentisinin (vite.config.ts, `heroVideoAsset`) sunduğu ve üretim
 * derlemesine kopyaladığı `/media/hero.mp4` dosyasıdır; dosya depoda tutulmaz. Başka bir adres (CDN) gerekirse
 * `VITE_HERO_VIDEO_URL` ile verilir.
 *
 * - Otomatik, sessiz, döngülü ve satır içi oynar; ses kanalı hiç açılmaz.
 * - Video oynayana kadar ve yüklenemezse temsilî mimari çizim görünür.
 * - "Azaltılmış hareket" tercihinde video kendiliğinden başlamaz; kullanıcı isterse oynatır.
 * - Görüntü kendi 16:9 oranında gösterilir; dar ekranda kırpılıp büyütülmez (720p kaynakta pikselleşme olmasın diye).
 */
export const HERO_VIDEO_URL = import.meta.env.VITE_HERO_VIDEO_URL || `${import.meta.env.BASE_URL}media/hero.mp4`

type VideoStatus = 'loading' | 'playing' | 'paused' | 'failed'

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export function VideoHero({ storyHref = '#hikaye', exploreHref = '#katalog' }: { storyHref?: string; exploreHref?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [enabled, setEnabled] = useState(() => !prefersReducedMotion())
  const [status, setStatus] = useState<VideoStatus>('loading')

  // React `muted` özelliğini HTML niteliği olarak yazmaz; otomatik oynatma politikası için ikisi de açıkça ayarlanır.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.defaultMuted = true
    video.muted = true
  }, [enabled])

  const toggle = () => {
    const video = videoRef.current
    if (!enabled) {
      setEnabled(true)
      return
    }
    if (!video) return
    if (video.paused) {
      Promise.resolve(video.play?.()).catch(() => setStatus('paused'))
    } else {
      video.pause()
    }
  }

  const showVideo = enabled && status !== 'failed'
  const representsVideo = showVideo && status !== 'loading'
  let controlLabel: string | null = null
  if (!enabled) controlLabel = 'Giriş videosunu oynat'
  else if (status === 'playing') controlLabel = 'Videoyu duraklat'
  else if (status === 'paused') controlLabel = 'Videoyu oynat'

  return (
    <section className="video-hero" aria-labelledby="hero-title" data-video={enabled ? status : 'off'}>
      <div className="video-hero__media">
        <div className="video-hero__fallback" aria-hidden="true">
          <ArchitectureDrawing variant="kubbeli" />
        </div>
        {showVideo && (
          <video
            ref={videoRef}
            className="video-hero__video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden="true"
            tabIndex={-1}
            onPlaying={() => setStatus('playing')}
            onPause={() => setStatus((s) => (s === 'failed' ? s : 'paused'))}
            onError={() => setStatus('failed')}
          >
            <source src={HERO_VIDEO_URL} type="video/mp4" onError={() => setStatus('failed')} />
          </video>
        )}
        <div className="video-hero__shade" aria-hidden="true" />
      </div>

      <div className="video-hero__content">
        <div className="container video-hero__inner">
          <p className="video-hero__eyebrow">Bursa’nın Kayıp Vakfiyesi · Yaşayan Miras</p>
          <h1 id="hero-title" className="video-hero__title">
            VAKIFNAME
          </h1>
          <p className="video-hero__slogan">Geçmişi Keşfet, Mirası Yaşat.</p>
          <div className="video-hero__actions">
            <a className="button button--light" href={exploreHref}>
              Eserleri Keşfet
            </a>
            <a className="button video-hero__story" href={storyHref}>
              Hikâyeye Başla
            </a>
          </div>
        </div>
      </div>

      <div className="video-hero__foot container">
        <p className="video-hero__caption">
          {representsVideo
            ? 'Temsilî, yapay zekâ ile üretilmiş görüntü · Gerçek bir Bursa eserinin kaydı değildir'
            : 'Temsilî çizim · Eser fotoğrafı değildir'}
        </p>
        {controlLabel && (
          <button type="button" className="video-hero__control" onClick={toggle} aria-label={controlLabel}>
            <span aria-hidden="true">{controlLabel === 'Videoyu duraklat' ? '❚❚' : '▶'}</span>
            <span className="video-hero__control-text">{controlLabel}</span>
          </button>
        )}
      </div>
    </section>
  )
}
