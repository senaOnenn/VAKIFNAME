import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  EXTRACT_MAX_PAGES,
  getJob,
  searchSource,
  startExtract,
  type ContentMonument,
  type ContentOverview,
  type ExtractJob,
} from '../../api'

/** İş durumu sorgulama aralığı (ms). */
export const JOB_POLL_MS = 2000

function jobText(job: ExtractJob): string {
  switch (job.status) {
    case 'queued':
      return 'Sıraya alındı…'
    case 'running':
      return job.kind === 'en'
        ? `İngilizce karşılıklar aranıyor (s. ${job.page_from}–${job.page_to}). Bu birkaç dakika sürebilir.`
        : `Aday kayıtlar çıkarılıyor (s. ${job.page_from}–${job.page_to}). Bu birkaç dakika sürebilir.`
    case 'done':
      return job.kind === 'en'
        ? `Tamamlandı: ${job.candidates} İngilizce karşılık taslak oldu, ${job.dropped} aday kaynağında bulunamadığı için düştü.`
        : `Tamamlandı: ${job.candidates} aday taslak oldu, ${job.dropped} aday kaynağında bulunamadığı için düştü.`
    case 'failed':
      return `Aday çıkarma başarısız: ${job.error ?? 'bilinmeyen hata'}`
  }
}

/**
 * Hat (pipeline): kaynak kitap + sayfa aralığı → rehber modeli aday kayıt önerir; alıntısı sayfada bulunmayan aday düşer,
 * kalanlar taslak olur. Hiçbir aday kendiliğinden yayımlanmaz.
 * İngilizce kipinde (Faz 11) yayındaki Türkçe kayıtların kitabın İngilizce bölümündeki karşılıkları aranır; makine çevirisi
 * yapılmaz, İngilizce alıntısı sayfada bulunmayan karşılık düşer.
 */
export function PipelinePanel({ overview, monument, onDone }: { overview: ContentOverview; monument: ContentMonument; onDone: () => void }) {
  const id = useId()
  const [sourceId, setSourceId] = useState(overview.sources[0]?.source_id ?? '')
  const source = overview.sources.find((s) => s.source_id === sourceId)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState(monument.name)
  const [hits, setHits] = useState<{ page: number; snippet: string }[] | null>(null)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [job, setJob] = useState<ExtractJob | null>(null)
  const [lang, setLang] = useState<'tr' | 'en'>('tr')
  const [err, setErr] = useState<string | null>(null)
  const alive = useRef(true)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // İş bitene kadar her JOB_POLL_MS'de durum sorulur; sayfadan çıkılınca durur.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return
    const t = setTimeout(() => {
      getJob(job.job_id).then(
        (j) => {
          if (!alive.current) return
          setJob(j)
          if (j.status === 'done') onDoneRef.current()
        },
        (e: unknown) => alive.current && setErr(e instanceof Error ? e.message : 'İş durumu alınamadı.'),
      )
    }, JOB_POLL_MS)
    return () => clearTimeout(t)
  }, [job])

  if (overview.sources.length === 0) {
    return (
      <section className="vk-admin__card" aria-labelledby={`${id}-h`}>
        <h2 id={`${id}-h`}>Kitaptan aday kayıt çıkar</h2>
        <p className="vk-admin__note">Önce İçerik yönetimi sayfasından bir kaynak kitap (PDF) ekleyin.</p>
      </section>
    )
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    if (!sourceId || q.trim().length < 2) return
    setSearchErr(null)
    try {
      setHits((await searchSource(sourceId, q.trim())).hits)
    } catch (e2) {
      setSearchErr(e2 instanceof Error ? e2.message : 'Arama başarısız.')
    }
  }

  function pick(page: number) {
    const last = source?.page_count ?? page
    setFrom(String(page))
    setTo(String(Math.min(page + 1, last)))
  }

  const a = Number(from)
  const b = Number(to)
  const rangeError = !from || !to
    ? null
    : !Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a
      ? 'Sayfa aralığı geçersiz.'
      : source && b > source.page_count
        ? `Kitap ${source.page_count} sayfa.`
        : b - a + 1 > EXTRACT_MAX_PAGES
          ? `Tek seferde en fazla ${EXTRACT_MAX_PAGES} sayfa okunabilir.`
          : null
  const running = job?.status === 'queued' || job?.status === 'running'

  async function start(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!from || !to || rangeError) {
      setErr(rangeError ?? 'Başlangıç ve bitiş sayfasını girin.')
      return
    }
    try {
      const j = await startExtract({ source_id: sourceId, monument_id: monument.monument_id, page_from: a, page_to: b, lang })
      setJob(j)
      if (j.status === 'done') onDone()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Başlatılamadı.')
    }
  }

  return (
    <section className="vk-admin__card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Kitaptan aday kayıt çıkar</h2>
      <p className="vk-admin__note">
        Rehber modeli seçtiğiniz sayfalardan bu eserle ilgili aday kayıtlar önerir. Her adayın kitaptan birebir alıntısı
        aranır; sayfada bulunamayan aday düşer. Kalanlar taslak olur ve siz onaylamadan yayımlanmaz.
      </p>
      <div className="vk-cform vk-cform--grid">
        <label htmlFor={`${id}-src`}>Kaynak kitap</label>
        <select id={`${id}-src`} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setHits(null) }}>
          {overview.sources.map((s) => (
            <option key={s.source_id} value={s.source_id}>{s.title} ({s.page_count} s.)</option>
          ))}
        </select>
      </div>
      {source && !source.rights_confirmed && (
        <p className="vk-cform__warn" role="note">
          Bu kaynağın kullanım izni işaretlenmemiş: çıkan adaylar taslak kalır, yayımlanamaz.
        </p>
      )}

      <form className="vk-cform vk-content__search" onSubmit={search} role="search" aria-label="Kitapta ara">
        <label htmlFor={`${id}-q`}>Kitapta ara (eserin geçtiği sayfaları bulun)</label>
        <div className="vk-content__inline">
          <input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="vk-btn vk-btn--ghost vk-content__small-btn">Ara</button>
        </div>
      </form>
      {searchErr && <p className="vk-cform__error" role="alert">{searchErr}</p>}
      {hits && (
        hits.length === 0 ? (
          <p className="vk-admin__note" role="status">Bu kitapta "{q}" geçen sayfa bulunamadı.</p>
        ) : (
          <ul className="vk-content__hits" aria-label="Arama sonuçları">
            {hits.map((h) => (
              <li key={h.page}>
                <button type="button" className="vk-content__hit" onClick={() => pick(h.page)}>
                  <strong>s. {h.page}</strong> <span>{h.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      <form className="vk-cform" onSubmit={start} noValidate>
        <fieldset className="vk-cform__radios">
          <legend>Ne çıkarılsın?</legend>
          <label>
            <input type="radio" name={`${id}-lang`} value="tr" checked={lang === 'tr'} onChange={() => setLang('tr')} />
            Türkçe kayıt adayları
          </label>
          <label>
            <input type="radio" name={`${id}-lang`} value="en" checked={lang === 'en'} onChange={() => setLang('en')} />
            İngilizce karşılıklar (kitabın İngilizce bölümünden)
          </label>
          {lang === 'en' && (
            <p className="vk-admin__note">
              Eserin yayındaki Türkçe kayıtlarının bu sayfalardaki İngilizce karşılığı aranır; makine çevirisi kullanılmaz.
              Çıkan karşılıklar taslak olur ve siz onaylamadan yayımlanmaz.
            </p>
          )}
        </fieldset>
        <div className="vk-cform__pair">
          <label htmlFor={`${id}-from`}>Başlangıç sayfası</label>
          <input id={`${id}-from`} type="number" min={1} max={source?.page_count} value={from} onChange={(e) => setFrom(e.target.value)} />
          <label htmlFor={`${id}-to`}>Bitiş sayfası</label>
          <input id={`${id}-to`} type="number" min={1} max={source?.page_count} value={to} onChange={(e) => setTo(e.target.value)}
            aria-invalid={!!rangeError || undefined} aria-describedby={`${id}-range`} />
        </div>
        <p id={`${id}-range`} className="vk-admin__note">
          Sayfa numarası PDF dosyasındaki sıradır (basılı numara değil). En fazla {EXTRACT_MAX_PAGES} sayfa.
        </p>
        {rangeError && <p className="vk-cform__error">{rangeError}</p>}
        <div className="vk-cform__actions">
          <button type="submit" className="vk-btn" disabled={running}>{running ? 'Çalışıyor…' : lang === 'en' ? 'İngilizce karşılık çıkar' : 'Aday kayıt çıkar'}</button>
        </div>
      </form>
      {err && <p className="vk-cform__error" role="alert">{err}</p>}
      <p className="vk-content__job" role="status" aria-live="polite">{job ? jobText(job) : ''}</p>
    </section>
  )
}
