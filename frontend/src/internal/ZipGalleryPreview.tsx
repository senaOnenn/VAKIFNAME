import { useEffect, useState } from 'react'
import { PhotoGallery, type GalleryPhoto } from '../components/PhotoGallery'
import { getGallery, getReviewMedia } from './reviewClient'
import type { GalleryPreview, GalleryPreviewItem, MonumentSummary } from './types'

/**
 * Dahili galeri önizlemesi: her eser için yayındaki fotoğraflar ve hackathon ZIP arşivinden gelen fotoğraflar.
 *
 * - Yalnızca yetkili oturumla görünür; genel yayın değildir. Dosyalar sunucuda SHA-256 ile doğrulanarak alınır.
 * - ZIP klasörü başlangıç sınıflandırmasıdır. Belgelenmiş kimlik çelişkisi olan fotoğraflar eserin galerisinde
 *   gösterilmez; ayrı "incelemeye ayrılanlar" listesinde, çelişki açıklamasıyla durur.
 * - Hiçbir karar vermez; hak, yayın ve referans kararları toplu inceleme ekranındadır.
 */

const RIGHTS: Record<string, string> = {
  pending: 'bekliyor',
  approved: 'onaylı',
  rejected: 'reddedildi',
  needs_revision: 'düzeltme gerekli',
}
const RESOLUTION: Record<string, string> = { dusuk: 'düşük çözünürlük', orta: 'orta çözünürlük', iyi: 'iyi çözünürlük' }

/** Bölümdeki dosyaları oturumla alıp nesne adreslerine çevirir; bileşen kapanınca adresleri bırakır. */
function useBlobUrls(items: GalleryPreviewItem[], enabled: boolean): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = items.map((i) => i.image_id).join('|')
  useEffect(() => {
    if (!enabled || items.length === 0) return
    const controller = new AbortController()
    const made: string[] = []
    items.forEach((it) => {
      getReviewMedia(it.detail_url, controller.signal)
        .then((blob) => {
          const u = URL.createObjectURL(blob)
          made.push(u)
          setUrls((prev) => ({ ...prev, [it.image_id]: u }))
        })
        .catch(() => undefined)
    })
    return () => {
      controller.abort()
      made.forEach((u) => URL.revokeObjectURL(u))
      setUrls({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return urls
}

function rightsLine(it: GalleryPreviewItem) {
  return `Hak ${RIGHTS[it.rights.image_rights] ?? it.rights.image_rights} · yayın ${RIGHTS[it.rights.image_publication] ?? it.rights.image_publication} · referans ${RIGHTS[it.rights.image_reference_index] ?? it.rights.image_reference_index}`
}

function Section({ title, note, items, monumentId, monumentName }: { title: string; note: string; items: GalleryPreviewItem[]; monumentId: string; monumentName: string }) {
  const urls = useBlobUrls(items, items.length > 0)
  if (items.length === 0) return null
  const photos: GalleryPhoto[] = items.map((it, i) => ({
    key: it.image_id,
    src: urls[it.image_id] ?? null,
    width: it.width,
    height: it.height,
    alt: `${monumentName} — ${title.toLowerCase()} ${i + 1}/${items.length}`,
    caption: (
      <>
        {it.caption ?? '—'}
        {it.quality && ` · ${RESOLUTION[it.quality.resolution]} (${it.quality.short_side_px} px)`}
        {it.folder_monument_id !== monumentId ? ` · ZIP klasörü: ${it.folder_monument_id}` : ''}
      </>
    ),
    credit: (
      <>
        {it.source_url ? (
          <a href={it.source_url} target="_blank" rel="noopener noreferrer">
            {it.source}
          </a>
        ) : (
          it.source
        )}{' '}
        · {rightsLine(it)}
      </>
    ),
  }))
  return (
    <section className="zip-gallery__section" aria-label={title}>
      <h4>
        {title} <span className="inventory-muted">({items.length})</span>
      </h4>
      <p className="inventory-muted">{note}</p>
      <PhotoGallery photos={photos} label={`${monumentName}: ${title}`} />
    </section>
  )
}

function ReviewList({ items }: { items: GalleryPreviewItem[] }) {
  const [open, setOpen] = useState(false)
  const urls = useBlobUrls(items, open)
  if (items.length === 0) return null
  return (
    <details className="zip-gallery__review" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        İncelemeye ayrılanlar — belgelenmiş kimlik çelişkisi ({items.length}). Bu fotoğraflar bu eserin galerisinde gösterilmez.
      </summary>
      <ul className="zip-gallery__grid">
        {items.map((it) => (
          <li key={it.image_id}>
            {urls[it.image_id] ? (
              <img src={urls[it.image_id]} alt={it.caption ?? it.image_id} style={{ maxWidth: `min(100%, ${it.width}px)` }} />
            ) : (
              <span className="inventory-muted">{open ? 'yükleniyor…' : ''}</span>
            )}
            <p>
              <strong>{it.source}</strong>
            </p>
            <p>{it.caption}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function ZipGalleryPreviewPanel({ monuments }: { monuments: MonumentSummary[] }) {
  const [mid, setMid] = useState(monuments[0]?.monument_id ?? '')
  const [data, setData] = useState<GalleryPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!mid) return
    const controller = new AbortController()
    setData(null)
    setError(null)
    getGallery(mid, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Galeri alınamadı.')
      })
    return () => controller.abort()
  }, [mid])

  return (
    <section className="inventory-panel zip-gallery" aria-label="Galeri önizlemesi (dahili)">
      <h3>Galeri önizlemesi (dahili)</h3>
      <p className="notice notice--warning">
        Yalnızca yetkili dahili önizleme; genel yayın değildir. Hackathon ZIP fotoğraflarının kamuya açık kullanım izni
        belgelenene kadar sitede gösterilmez.
      </p>
      <label className="batch-field">
        <span>Eser</span>
        <select value={mid} onChange={(e) => setMid(e.target.value)}>
          {monuments.map((m) => (
            <option key={m.monument_id} value={m.monument_id}>
              {m.monument_id} · {m.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="notice notice--error">{error}</p>}
      {!data && !error && <p>Galeri yükleniyor…</p>}
      {data && (
        <>
          {data.zip_rights && (
            <p className="inventory-muted">
              ZIP izin durumu: {data.zip_rights.license_status === 'izin_belgesi_bekleniyor' ? 'izin belgesi bekleniyor' : data.zip_rights.license_status}.{' '}
              {data.zip_rights.finding}
            </p>
          )}
          <Section
            key={`p-${data.monument_id}`}
            title="Yayındaki fotoğraflar"
            note="Hak ve yayın kararı onaylı (genel sitede görünenler)."
            items={data.sections.published}
            monumentId={data.monument_id}
            monumentName={data.name}
          />
          <Section
            key={`z-${data.monument_id}`}
            title="ZIP galeri adayları"
            note="Klasör bu eser; belgelenmiş çelişki yok. Yazılı izin ve hak kararı bekliyor."
            items={data.sections.zip_gallery}
            monumentId={data.monument_id}
            monumentName={data.name}
          />
          <Section
            key={`o-${data.monument_id}`}
            title="Başka klasörden bu esere önerilenler"
            note="Kitapta bu eserin bölümünde basılı; ZIP'te başka klasörde. Yalnızca öneridir: editör kararı olmadan bu esere bağlanmaz."
            items={data.sections.zip_proposed_here}
            monumentId={data.monument_id}
            monumentName={data.name}
          />
          {data.sections.zip_gallery.length + data.sections.zip_proposed_here.length + data.sections.published.length === 0 && (
            <p className="inventory-muted">Bu eser için gösterilebilecek ZIP fotoğrafı yok.</p>
          )}
          {data.sections.commons_candidates.length > 0 && (
            <p className="inventory-muted">
              Ayrıca {data.sections.commons_candidates.length} Commons adayı toplu inceleme ekranında karar bekliyor.
            </p>
          )}
          <ReviewList key={`r-${data.monument_id}`} items={data.sections.zip_review} />
        </>
      )}
    </section>
  )
}
