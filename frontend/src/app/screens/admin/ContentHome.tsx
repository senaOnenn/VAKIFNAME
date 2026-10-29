import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  createSource,
  getContentOverview,
  listFacts,
  typeLabel,
  uploadContentFile,
  useLoad,
  type ContentFact,
  type ContentOverview,
} from '../../api'
import { StatTile } from '../../components/charts'
import { GoldRule } from '../../components/Ornament'
import { AdminNav } from './AdminNav'
import { CERTAINTY_LABEL, DRAFT_NOTE, ORIGIN_LABEL, formatWhen, label } from './labels'
import { OriginTag, StatusTag } from './StatusTag'
import '../discover.css'
import '../admin.css'
import './content.css'

/** İçerik yönetimi ana sayfası: taslak kuyruğu, eserler ve kaynak kitaplar (CLAUDE.md §2.13). */
export default function ContentHome() {
  const overview = useLoad((s) => getContentOverview(s), [])
  const drafts = useLoad((s) => listFacts({ status: 'draft' }, s), [])

  return (
    <main className="vk-page vk-admin vk-content">
      <AdminNav />
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">Yönetim</p>
        <h1>İçerik yönetimi</h1>
        <GoldRule className="vk-page__rule" />
        <p>Kitaptan aday çıkarın ya da elle ekleyin. Hiçbir kayıt, siz kaynağıyla karşılaştırıp onaylamadan yayımlanmaz.</p>
      </header>

      {overview.loading && !overview.data && <p className="vk-page__state" role="status">Yükleniyor…</p>}
      {overview.error && (
        <p className="vk-page__state vk-page__state--error" role="alert">{overview.error}</p>
      )}
      {overview.data && !overview.data.enabled && (
        <p className="vk-content__closed" role="status">
          İçerik deposu bu sunucuda kapalı (<code>VAKIFNAME_CONTENT_DIR</code> tanımlı değil). Ziyaretçiler yalnızca onaylı
          kataloğu görür; yeni kayıt eklemek için deponun açılması gerekir.
        </p>
      )}
      {overview.data?.enabled && (
        <Body overview={overview.data} drafts={drafts.data?.facts ?? []} draftsError={drafts.error} onSourceAdded={overview.reload} />
      )}
    </main>
  )
}

function Body({ overview, drafts, draftsError, onSourceAdded }: {
  overview: ContentOverview
  drafts: ContentFact[]
  draftsError: string | null
  onSourceAdded: () => void
}) {
  const names = useMemo(() => new Map(overview.monuments.map((m) => [m.monument_id, m.name])), [overview.monuments])
  // Taslaklar esere göre gruplanır; en son güncellenen eser ve kayıt önce.
  const groups = useMemo(() => {
    const by = new Map<string, ContentFact[]>()
    for (const f of [...drafts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      by.set(f.monument_id, [...(by.get(f.monument_id) ?? []), f])
    }
    return [...by.entries()]
  }, [drafts])

  return (
    <div className="vk-admin__body">
      <div className="vk-admin__kpis">
        <StatTile label="Onay bekleyen taslak" value={overview.drafts} />
        <StatTile label="Eser" value={overview.monuments.length} />
        <StatTile label="Kaynak kitap" value={overview.sources.length} />
      </div>

      <section className="vk-admin__card" aria-labelledby="kuyruk">
        <h2 id="kuyruk">Taslak kuyruğu</h2>
        <p className="vk-admin__note">{DRAFT_NOTE}</p>
        {draftsError && <p className="vk-page__state--error" role="alert">{draftsError}</p>}
        {!draftsError && groups.length === 0 && <p className="vk-admin__note">Onay bekleyen taslak yok.</p>}
        {groups.map(([mid, facts]) => (
          <div key={mid} className="vk-content__group">
            <h3>
              <Link to={`/yonetim/icerik/eser/${mid}`}>{names.get(mid) ?? mid}</Link>
              <span className="vk-content__muted"> · {facts.length} taslak</span>
            </h3>
            <ul className="vk-content__list">
              {facts.map((f) => (
                <li key={f.fact_id}>
                  <Link to={`/yonetim/icerik/kayit/${f.fact_id}`}>{f.title}</Link>
                  <span className="vk-content__muted">
                    {label(CERTAINTY_LABEL, f.certainty)} · {ORIGIN_LABEL[f.origin]} · s. {f.page} · {formatWhen(f.updated_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="vk-admin__card" aria-labelledby="eserler">
        <div className="vk-content__headrow">
          <h2 id="eserler">Eserler</h2>
          <Link to="/yonetim/icerik/eser/yeni" className="vk-btn vk-btn--ghost vk-content__small-btn">Yeni eser</Link>
        </div>
        <div className="vk-content__scroll">
          <table className="vk-content__table">
            <caption className="vk-sr-only">Eserler, kaynakları, durumları ve kayıt sayıları</caption>
            <thead>
              <tr>
                <th scope="col">Eser</th>
                <th scope="col">Şehir</th>
                <th scope="col">Tür</th>
                <th scope="col">Kaynağı</th>
                <th scope="col">Durum</th>
                <th scope="col" className="num">Yayında kayıt</th>
                <th scope="col" className="num">Taslak</th>
              </tr>
            </thead>
            <tbody>
              {overview.monuments.map((m) => (
                <tr key={m.monument_id}>
                  <th scope="row"><Link to={`/yonetim/icerik/eser/${m.monument_id}`}>{m.name}</Link></th>
                  <td>{m.city}</td>
                  <td>{typeLabel(m.type)}</td>
                  <td><OriginTag origin={m.origin} /></td>
                  <td><StatusTag status={m.status} /></td>
                  <td className="num">{m.facts.published}</td>
                  <td className="num">{m.facts.draft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="vk-admin__card" aria-labelledby="kaynaklar">
        <h2 id="kaynaklar">Kaynak kitaplar</h2>
        {overview.sources.length === 0 ? (
          <p className="vk-admin__note">Henüz kaynak eklenmedi.</p>
        ) : (
          <ul className="vk-content__list">
            {overview.sources.map((s) => (
              <li key={s.source_id}>
                <strong>{s.title}</strong>
                <span className="vk-content__muted">
                  {s.page_count} sayfa · {formatWhen(s.uploaded_at)} · {s.uploaded_by}
                </span>
                <span className={`vk-ctag ${s.rights_confirmed ? 'vk-ctag--published' : 'vk-ctag--rejected'}`}>
                  {s.rights_confirmed ? 'Kullanım izni var' : 'Kullanım izni yok: kayıtları yayımlanamaz'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <SourceUpload onDone={onSourceAdded} />
      </section>
    </div>
  )
}

type Rights = '' | 'yes' | 'no'

/** Kitap (PDF) yükleme: önce dosya sunucuya gider, sonra başlık ve kullanım izniyle kaynak kaydı açılır. */
function SourceUpload({ onDone }: { onDone: () => void }) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [rights, setRights] = useState<Rights>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || !title.trim() || !rights) {
      setMsg({ text: 'Dosya, başlık ve kullanım izni seçimi gerekli.', error: true })
      return
    }
    setBusy(true)
    setMsg({ text: 'Kitap yükleniyor ve sayfa metni çıkarılıyor…', error: false })
    try {
      const up = await uploadContentFile(file)
      const src = await createSource({ upload_id: up.upload_id, title: title.trim(), rights_confirmed: rights === 'yes' })
      setMsg({ text: `"${src.title}" eklendi (${src.page_count} sayfa).`, error: false })
      setFile(null)
      setTitle('')
      setRights('')
      if (fileRef.current) fileRef.current.value = ''
      onDone()
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Yükleme başarısız.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="vk-cform vk-content__upload" onSubmit={submit} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Kitap ekle</h3>
      <label htmlFor={`${id}-file`}>PDF dosyası</label>
      <input ref={fileRef} id={`${id}-file`} type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <label htmlFor={`${id}-title`}>Başlık</label>
      <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Bursa Vakıf Eserleri, Cilt I" />
      <fieldset className="vk-cform__radios">
        <legend>Bu yayının metnini kullanma izniniz var mı?</legend>
        <p className="vk-admin__note">
          Kitaptan türetilen bir kayıt, ancak kaynağın kullanım izni varsa yayımlanabilir. İzin yoksa kitap yalnızca
          araştırma ve karşılaştırma için kullanılır.
        </p>
        <label>
          <input type="radio" name={`${id}-rights`} value="yes" checked={rights === 'yes'} onChange={() => setRights('yes')} />
          Evet, kullanım izni var
        </label>
        <label>
          <input type="radio" name={`${id}-rights`} value="no" checked={rights === 'no'} onChange={() => setRights('no')} />
          Hayır, henüz izin yok (kayıtları yayımlanamaz)
        </label>
      </fieldset>
      <button type="submit" className="vk-btn" disabled={busy}>{busy ? 'Yükleniyor…' : 'Kitabı ekle'}</button>
      <p className={msg?.error ? 'vk-cform__error' : 'vk-admin__note'} role={msg?.error ? 'alert' : 'status'} aria-live="polite">
        {msg?.text ?? ''}
      </p>
    </form>
  )
}
