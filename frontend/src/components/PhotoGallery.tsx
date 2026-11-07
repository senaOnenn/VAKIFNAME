import { useEffect, useRef, useState, type ReactNode } from 'react'
import './photo-gallery.css'

/** Galerideki bir fotoğraf. `src` henüz yüklenmediyse `null` olabilir (ör. yetkili önizlemede dosya alınırken). */
export interface GalleryPhoto {
  key: string
  /** Ana görünüm ve büyük görünüm dosyası. */
  src: string | null
  /** Küçük resim (yoksa `src`). */
  thumbSrc?: string | null
  /** Özgün piksel boyutu: görüntü bunun üzerine büyütülmez. */
  width?: number | null
  height?: number | null
  alt: string
  /** Açıklama ve eserle ilişkisi. */
  caption?: ReactNode
  /** Kaynak ve atıf satırı. */
  credit?: ReactNode
}

/** Ekran okuyucu ve düğme metinleri (çeviri için). Verilmeyen anahtar Türkçe varsayılanı kullanır. */
export interface GalleryLabels {
  prev: string
  next: string
  open: string
  close: string
  thumbs: string
  /** `{n}`: fotoğrafın sırası. */
  thumb: string
  loading: string
  /** Büyük görünüm penceresinin adı; `{label}` galeri adıdır. */
  lightbox: string
}
const DEFAULT_LABELS: GalleryLabels = {
  prev: 'Önceki fotoğraf', next: 'Sonraki fotoğraf', open: 'Büyük görünümde aç', close: 'Büyük görünümü kapat',
  thumbs: 'Fotoğraflar', thumb: 'Fotoğraf {n}', loading: 'Fotoğraf yükleniyor…', lightbox: '{label} — büyük görünüm',
}

/** Boyutu belli fotoğrafı özgün genişliğinden büyük göstermez (büyütme bulanıklık yaratır). */
const noUpscale = (p: GalleryPhoto) => (p.width ? { maxWidth: `min(100%, ${p.width}px)` } : undefined)

/**
 * Eser fotoğraf galerisi: ana görünüm, önceki/sonraki, klavye (←/→) ve dokunmatik kaydırma, küçük resimler ve tam ekran
 * büyük görünüm (`<dialog>`, Esc ile kapanır). Fotoğraflar kırpılmaz, bulanıklaştırılmaz ve özgün boyutundan büyütülmez.
 * Odak: büyük görünüm açılınca "Kapat" düğmesine, kapanınca açan düğmeye döner (tarayıcıdan bağımsız).
 */
export function PhotoGallery({ photos, label, startIndex = 0, labels }: {
  photos: GalleryPhoto[]; label: string; startIndex?: number; labels?: Partial<GalleryLabels>
}) {
  const L = { ...DEFAULT_LABELS, ...labels }
  const [active, setActive] = useState(Math.min(startIndex, Math.max(0, photos.length - 1)))
  const [zoomed, setZoomed] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  const wasZoomed = useRef(false)
  const touchX = useRef<number | null>(null)
  const count = photos.length
  const index = Math.min(active, Math.max(0, count - 1))
  const photo = photos[index]

  const go = (delta: number) => setActive((i) => (i + delta + count) % count)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (zoomed && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!zoomed && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
    if (zoomed) closer.current?.focus()
    else if (wasZoomed.current) opener.current?.focus()
    wasZoomed.current = zoomed
  }, [zoomed])

  if (!photo) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (count < 2) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(1)
    }
  }
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => (touchX.current = e.touches[0]?.clientX ?? null),
    onTouchEnd: (e: React.TouchEvent) => {
      const start = touchX.current
      touchX.current = null
      const end = e.changedTouches[0]?.clientX
      if (start === null || end === undefined || count < 2) return
      if (Math.abs(end - start) > 40) go(end < start ? 1 : -1)
    },
  }
  const nav = count > 1 && (
    <>
      <button type="button" className="photo-gallery__nav photo-gallery__nav--prev" onClick={() => go(-1)} aria-label={L.prev}>
        ‹
      </button>
      <button type="button" className="photo-gallery__nav photo-gallery__nav--next" onClick={() => go(1)} aria-label={L.next}>
        ›
      </button>
    </>
  )
  const counter = (
    <span className="photo-gallery__count" aria-live="polite">
      {index + 1} / {count}
    </span>
  )

  return (
    <section className="photo-gallery" aria-label={label} aria-roledescription="galeri" onKeyDown={onKey}>
      <figure className="photo-gallery__main">
        <div className="photo-gallery__stage" {...swipe}>
          {photo.src ? (
            <button ref={opener} type="button" className="photo-gallery__zoom" onClick={() => setZoomed(true)} aria-label={L.open}>
              <img
                src={photo.src}
                alt={photo.alt}
                width={photo.width ?? undefined}
                height={photo.height ?? undefined}
                style={noUpscale(photo)}
                decoding="async"
              />
            </button>
          ) : (
            <p className="photo-gallery__loading">{L.loading}</p>
          )}
          {nav}
        </div>
        <figcaption>
          {counter}
          {photo.caption && <span className="photo-gallery__caption">{photo.caption}</span>}
          {photo.credit && <span className="photo-gallery__credit">{photo.credit}</span>}
        </figcaption>
      </figure>
      {count > 1 && (
        <ul className="photo-gallery__thumbs" aria-label={L.thumbs}>
          {photos.map((p, i) => (
            <li key={p.key}>
              <button
                type="button"
                className={i === index ? 'is-active' : undefined}
                onClick={() => setActive(i)}
                aria-label={L.thumb.replace('{n}', String(i + 1))}
                aria-current={i === index ? 'true' : undefined}
              >
                {(p.thumbSrc ?? p.src) && <img src={(p.thumbSrc ?? p.src)!} alt="" loading="lazy" decoding="async" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <dialog ref={dialog} className="photo-gallery__lightbox" aria-label={L.lightbox.replace('{label}', label)} onClose={() => setZoomed(false)}>
        {zoomed && (
          <div className="photo-gallery__lightbox-body" {...swipe}>
            {photo.src && <img src={photo.src} alt={photo.alt} style={noUpscale(photo)} decoding="async" />}
            {nav}
            <p className="photo-gallery__lightbox-caption">
              {counter}
              {photo.caption && <span>{photo.caption}</span>}
              {photo.credit && <span>{photo.credit}</span>}
            </p>
            <button ref={closer} type="button" className="photo-gallery__close" onClick={() => setZoomed(false)} aria-label={L.close}>
              ×
            </button>
          </div>
        )}
      </dialog>
    </section>
  )
}
