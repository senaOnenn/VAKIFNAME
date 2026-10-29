import { useId, useState, type FormEvent } from 'react'
import { ApiError } from '../../../api/client'
import {
  addImageFromSource,
  adminMediaUrl,
  getPageImages,
  searchSource,
  type BookImage,
  type ContentOverview,
} from '../../api'

/**
 * Kitaptan görsel (karar 14 = A): kaynak kitabın bir sayfasındaki fotoğraflar önizlemeyle listelenir; seçilen fotoğraf
 * esere eklenir. Atıf sunucuda kendiliğinden yazılır ("Görsel: <kitap>, s. <sayfa>"); taslak yönetici onayıyla yayına girer.
 */
export function BookImagePicker({ overview, monumentId, monumentName, onAdded }: {
  overview: ContentOverview
  monumentId: string
  monumentName: string
  onAdded: () => void
}) {
  const id = useId()
  const [sourceId, setSourceId] = useState(overview.sources[0]?.source_id ?? '')
  const source = overview.sources.find((s) => s.source_id === sourceId)
  const [page, setPage] = useState('')
  const [q, setQ] = useState(monumentName)
  const [hits, setHits] = useState<{ page: number; snippet: string }[] | null>(null)
  const [images, setImages] = useState<BookImage[] | null>(null)
  const [shownPage, setShownPage] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  if (!overview.sources.length) {
    return <p className="vk-admin__note">Kitaptan görsel eklemek için önce bir kaynak kitap yükleyin.</p>
  }

  const err = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

  async function search(e: FormEvent) {
    e.preventDefault()
    if (q.trim().length < 2) return
    try {
      setHits((await searchSource(sourceId, q.trim())).hits)
    } catch (e2) {
      setMsg({ text: err(e2, 'Arama yapılamadı.'), error: true })
    }
  }

  async function show(p: number) {
    if (!source || !(p >= 1 && p <= source.page_count)) {
      setMsg({ text: `Sayfa 1–${source?.page_count ?? '?'} aralığında olmalı.`, error: true })
      return
    }
    setPage(String(p))
    setBusy(true)
    setMsg(null)
    setPicked(null)
    try {
      const r = await getPageImages(sourceId, p)
      setImages(r.images)
      setShownPage(p)
    } catch (e) {
      setMsg({ text: err(e, 'Sayfanın görselleri alınamadı.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  async function add(publish: boolean) {
    if (picked === null || shownPage === null) return
    setBusy(true)
    try {
      await addImageFromSource(monumentId, { source_id: sourceId, page: shownPage, index: picked, title: title.trim() || null, publish })
      setMsg({ text: publish ? 'Kitap görseli eklendi ve yayımlandı.' : 'Kitap görseli taslak olarak eklendi.', error: false })
      setPicked(null)
      setTitle('')
      onAdded()
    } catch (e) {
      setMsg({ text: err(e, 'Görsel eklenemedi.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vk-cform vk-bookimg" role="group" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Kitaptan ekle</h3>
      <label htmlFor={`${id}-src`}>Kaynak kitap</label>
      <select id={`${id}-src`} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setImages(null); setHits(null) }}>
        {overview.sources.map((s) => (
          <option key={s.source_id} value={s.source_id}>{s.title} ({s.page_count} sayfa)</option>
        ))}
      </select>
      <form className="vk-content__search" role="search" aria-label="Kitapta eseri ara" onSubmit={search}>
        <label htmlFor={`${id}-q`}>Kitapta ara (eserin geçtiği sayfalar)</label>
        <div className="vk-bookimg__row">
          <input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="vk-btn vk-btn--ghost vk-content__small-btn">Ara</button>
        </div>
      </form>
      {hits && (
        hits.length === 0 ? (
          <p className="vk-admin__note" role="status">"{q}" geçen sayfa bulunamadı.</p>
        ) : (
          <ul className="vk-bookimg__hits" aria-label="Sayfalar">
            {hits.slice(0, 12).map((h) => (
              <li key={h.page}>
                <button type="button" className="vk-chip" aria-pressed={shownPage === h.page} onClick={() => void show(h.page)}>s. {h.page}</button>
              </li>
            ))}
          </ul>
        )
      )}
      <form className="vk-bookimg__row" onSubmit={(e) => { e.preventDefault(); void show(Number(page)) }}>
        <label htmlFor={`${id}-page`} className="vk-sr-only">Sayfa numarası</label>
        <input id={`${id}-page`} inputMode="numeric" placeholder="Sayfa no" value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ''))} />
        <button type="submit" className="vk-btn vk-btn--ghost vk-content__small-btn" disabled={busy || !page}>Sayfanın görsellerini göster</button>
      </form>

      <p className="vk-content__muted" role="status" aria-live="polite">
        {busy ? 'Yükleniyor…' : images && shownPage !== null ? `s. ${shownPage}: ${images.length} fotoğraf` : ''}
      </p>
      {images && images.length > 0 && (
        <ul className="vk-bookimg__grid" aria-label={`s. ${shownPage} fotoğrafları`}>
          {images.map((im) => (
            <li key={im.index}>
              <button type="button" className="vk-bookimg__pick" aria-pressed={picked === im.index} onClick={() => setPicked(im.index)}>
                <img src={adminMediaUrl(im.url)} alt={`s. ${shownPage}, fotoğraf ${im.index + 1}`} loading="lazy" />
                <span>{im.width}×{im.height}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked !== null && (
        <div className="vk-bookimg__add">
          <label htmlFor={`${id}-title`}>Kitap görselinin başlığı (alternatif metin)</label>
          <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`ör. ${monumentName} avlusu`} />
          <p className="vk-content__muted">Atıf kendiliğinden yazılır: "Görsel: {source?.title}, s. {shownPage}".</p>
          <div className="vk-cform__actions">
            <button type="button" className="vk-btn vk-btn--ghost" disabled={busy} onClick={() => void add(false)}>Taslak olarak ekle</button>
            <button type="button" className="vk-btn" disabled={busy} onClick={() => void add(true)}>Ekle ve yayımla</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.error ? 'vk-cform__error' : 'vk-admin__note'} role={msg.error ? 'alert' : 'status'}>{msg.text}</p>}
    </div>
  )
}
