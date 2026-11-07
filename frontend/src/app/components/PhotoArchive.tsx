import { useEffect, useId, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react'
import { useLang } from '../i18n'
import './photo-archive.css'

/** Arşivdeki bir fotoğraf: yalnızca katalogdaki onaylı görsel ve onun kayıtlı bilgileri (uydurma alan yok). */
export interface ArchivePhoto {
  key: string
  src: string
  thumbSrc: string
  width?: number | null
  height?: number | null
  alt: string
  /** Katalogdaki açıklama (görsel başlığı); yoksa gösterilmez. */
  title?: string | null
  rightsHolder?: string | null
  /** Atıf satırı (dil etiketleri çevrilmiş). */
  attribution?: string | null
  license?: string | null
  licenseUrl?: string | null
  sourceLabel?: string | null
  sourceUrl?: string | null
  /** R6.15.2: karonun altında görünen kısa kaynak yazısı (ör. "Kaynak: … Cilt I"). */
  caption?: string | null
  /** R6.15.2: yayın izni durumu; kaynaktan ayrı satırda yazılır (kaynak atfı yayın izni değildir). */
  permission?: string | null
}

/** İlk görünümdeki fotoğraf sayısı (öne çıkan + 4 küçük). */
const PREVIEW = 5

/** Boyutu belli fotoğraf özgün genişliğinden büyütülmez (bulanıklaşmasın). */
const noUpscale = (p: ArchivePhoto) => (p.width ? { maxWidth: `min(100%, ${p.width}px)` } : undefined)

/**
 * R3.8 / R3.10 Fotoğraf Arşivi: esere ait bütün yayımlanmış fotoğraflar asimetrik bir mozaikte (öne çıkan 2×2 + 4 küçük;
 * ilk görünümde 5, "Bütün fotoğrafları göster" ile hepsi). Önizlemeler alanı doldurur ve kırpılabilir (bozulmaz,
 * gerilmez); inceleyicide fotoğrafın tamamı görünür. Atıf ve lisanslar "Fotoğraf bilgileri" listesinde ve inceleyicide. Bir fotoğrafa basınca inceleme penceresi (`<dialog>`) açılır: büyük görüntü,
 * önceki/sonraki (düğme, ←/→, kaydırma), açıklama, fotoğrafı çeken/hak sahibi, kaynak, lisans ve atıf (yalnızca katalogda
 * olanlar). Esc kapatır; odak açan fotoğrafa döner. Fotoğraf yoksa boş durum yazılır.
 */
export function PhotoArchive({ photos, monumentName, publishedCount }: {
  photos: ArchivePhoto[]
  monumentName: string
  /** R6.15.2: yayımlanmış (lisanslı) fotoğraf sayısı; geri kalanı yerel önizlemedir ve sayaçta ayrı yazılır. */
  publishedCount?: number
}) {
  const { t } = useLang()
  const headingId = useId()
  const [open, setOpen] = useState<number | null>(null)
  const [all, setAll] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const lastOpened = useRef<number | null>(null)
  const touchX = useRef<number | null>(null)
  const n = photos.length

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open !== null && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (open === null && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
    if (open !== null) {
      lastOpened.current = open
      closer.current?.focus()
    } else if (lastOpened.current !== null) {
      tiles.current[lastOpened.current]?.focus()
      lastOpened.current = null
    }
    // Yalnızca açılıp kapanırken (fotoğraf değişince odak "Kapat"a geri çekilmez).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open === null])

  const go = (delta: number) => setOpen((i) => (i === null ? i : (i + delta + n) % n))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(null)
      return
    }
    if (n < 2) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(1)
    }
  }
  const swipe = {
    onTouchStart: (e: TouchEvent) => (touchX.current = e.touches[0]?.clientX ?? null),
    onTouchEnd: (e: TouchEvent) => {
      const start = touchX.current
      touchX.current = null
      const end = e.changedTouches[0]?.clientX
      if (start === null || end === undefined || n < 2) return
      if (Math.abs(end - start) > 40) go(end < start ? 1 : -1)
    },
  }
  const p = open !== null ? photos[open] : null
  // R3.10: ilk görünümde en çok 5 fotoğraf (öne çıkan + 4 küçük); "Bütün fotoğrafları göster" hepsini açar.
  const shown = all ? n : Math.min(n, PREVIEW)
  const more = n - shown

  const tile = (ph: ArchivePhoto, i: number) => (
    <li key={ph.key} className="vk-archive__item">
      <button ref={(el) => { tiles.current[i] = el }} type="button" className="vk-archive__open" onClick={() => setOpen(i)}
        aria-label={t('İncele: {alt} (fotoğraf {i} / {n})', { i: i + 1, n, alt: ph.title || ph.alt })}>
        {/* Önizleme alanı doldurur (kırpılabilir); inceleyicide fotoğrafın tamamı görünür. */}
        <img src={i === 0 ? ph.src : ph.thumbSrc} alt={ph.alt} width={ph.width ?? undefined} height={ph.height ?? undefined}
          loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
        {ph.caption && <span className="vk-archive__caption">{ph.caption}</span>}
        {more > 0 && i === shown - 1 && <span className="vk-archive__more-badge" aria-hidden="true">+{more}</span>}
      </button>
    </li>
  )

  return (
    <section className="vk-archive" aria-labelledby={headingId}>
      <div className="vk-archive__head">
        <h2 id={headingId}>{t('Fotoğraf Arşivi')}</h2>
        {n > 0 && (
          <p className="vk-archive__count">
            {publishedCount !== undefined && publishedCount < n
              ? t('{p} yayımlanmış fotoğraf, {l} yerel önizleme fotoğrafı', { p: publishedCount, l: n - publishedCount })
              : t('{n} yayımlanmış fotoğraf', { n })}
          </p>
        )}
      </div>
      {n === 0 ? (
        <p className="vk-archive__empty">{t('Bu eser için henüz yayımlanmış fotoğraf yok. Onaylanan fotoğraflar burada görünecek.')}</p>
      ) : (
        <>
          <ul className="vk-archive__mosaic" data-count={Math.min(shown, PREVIEW)} aria-label={t('{name} fotoğrafları', { name: monumentName })}>
            {photos.slice(0, shown).map((ph, i) => tile(ph, i))}
          </ul>
          <div className="vk-archive__foot">
            {n > PREVIEW && (
              <button type="button" className="vk-link-btn vk-archive__toggle" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                {all ? t('Daha az göster') : t('Bütün fotoğrafları göster ({n})', { n })}
              </button>
            )}
            {/* Atıf ve lisanslar: bütün fotoğraflar için, katalogdaki biçimiyle (inceleyicide ayrıntılı). */}
            <details className="vk-archive__credits">
              <summary>{t('Fotoğraf bilgileri ({n})', { n })}</summary>
              <ol>
                {photos.map((ph) => (
                  <li key={ph.key}>
                    {ph.attribution || ph.rightsHolder || ph.caption}
                    {ph.permission && <span className="vk-archive__permission"> ({ph.permission})</span>}
                    {ph.license && (
                      <>
                        {' · '}
                        {ph.licenseUrl ? <a href={ph.licenseUrl} target="_blank" rel="noreferrer">{ph.license}</a> : ph.license}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </>
      )}

      <dialog ref={dialog} className="vk-viewer" aria-label={t('Fotoğraf inceleme')} onClose={() => setOpen(null)}>
        {p && (
          <div className="vk-viewer__body" onKeyDown={onKey}>
            <div className="vk-viewer__stage" {...swipe}>
              <img src={p.src} alt={p.alt} style={noUpscale(p)} decoding="async" />
            </div>
            <div className="vk-viewer__info">
              <p className="vk-viewer__count" aria-live="polite">{t('Fotoğraf {i} / {n}', { i: open! + 1, n })}</p>
              {p.title && <p className="vk-viewer__title">{p.title}</p>}
              <dl className="vk-viewer__meta">
                {p.rightsHolder && <div><dt>{t('Fotoğrafı çeken / hak sahibi')}</dt><dd>{p.rightsHolder}</dd></div>}
                {(p.sourceLabel || p.sourceUrl) && (
                  <div>
                    <dt>{t('Kaynak')}</dt>
                    <dd>{p.sourceUrl
                      ? <a href={p.sourceUrl} target="_blank" rel="noreferrer">{p.sourceLabel || t('Kaynak sayfası')}</a>
                      : p.sourceLabel}</dd>
                  </div>
                )}
                {p.license && (
                  <div>
                    <dt>{t('Lisans')}</dt>
                    <dd>{p.licenseUrl ? <a href={p.licenseUrl} target="_blank" rel="noreferrer">{p.license}</a> : p.license}</dd>
                  </div>
                )}
                {p.attribution && <div><dt>{t('Atıf')}</dt><dd>{p.attribution}</dd></div>}
                {p.permission && <div><dt>{t('Yayın izni')}</dt><dd>{p.permission}</dd></div>}
              </dl>
              <div className="vk-viewer__nav">
                {n > 1 && (
                  <>
                    <button type="button" className="vk-viewer__btn" onClick={() => go(-1)}>{t('Önceki fotoğraf')}</button>
                    <button type="button" className="vk-viewer__btn" onClick={() => go(1)}>{t('Sonraki fotoğraf')}</button>
                  </>
                )}
              </div>
            </div>
            <button ref={closer} type="button" className="vk-viewer__close" onClick={() => setOpen(null)} aria-label={t('İncelemeyi kapat')}>
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3 3 13" /></svg>
            </button>
          </div>
        )}
      </dialog>
    </section>
  )
}
