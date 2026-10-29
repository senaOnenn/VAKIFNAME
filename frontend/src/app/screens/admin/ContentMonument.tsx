import { lazy, Suspense, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  addImage,
  adminMediaUrl,
  createMonument,
  getContentMonument,
  getContentOverview,
  imageAction,
  typeLabel,
  updateMonument,
  uploadContentFile,
  useLoad,
  withdrawMonument,
  type ContentImage,
  type ContentMonument as Monument,
  type ContentOverview,
  type MonumentEdit,
  type MonumentFields,
} from '../../api'
import { CITIES } from '../../cities'
import { GoldRule } from '../../components/Ornament'
import { AdminNav } from './AdminNav'
import { CERTAINTY_LABEL, DRAFT_NOTE, ORIGIN_LABEL, formatWhen, label } from './labels'
import { PipelinePanel } from './PipelinePanel'
import { OriginTag, StatusTag } from './StatusTag'
import '../discover.css'
import '../admin.css'
import './content.css'

const LocationPicker = lazy(() => import('../../components/LocationPicker'))

type Msg = { text: string; error: boolean } | null
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/** Yönetimde tek eser: kimlik alanları (yeni eserde düzenlenir), kayıtlar, görseller ve kitaptan aday çıkarma. */
export default function ContentMonument() {
  const { id = '' } = useParams()
  const isNew = id === 'yeni'
  const overview = useLoad((s) => getContentOverview(s), [])
  const edit = useLoad((s) => (isNew ? Promise.resolve(null) : getContentMonument(id, s)), [id])
  const flash = (useLocation().state as { flash?: string } | null)?.flash ?? null

  const error = overview.error ?? edit.error
  // Yeniden yüklemede eski veri ekranda kalır (form durumu ve mesajlar kaybolmaz); başka esere geçişte beklenir.
  const current = edit.data && edit.data.monument.monument_id === id ? edit.data : null
  const ready = !!overview.data && (isNew || !!current)
  return (
    <main className="vk-page vk-admin vk-content">
      <AdminNav />
      <p className="vk-content__crumb"><Link to="/yonetim/icerik">← İçerik yönetimi</Link></p>
      {error && <p className="vk-page__state vk-page__state--error" role="alert">{error}</p>}
      {!error && !ready && <p className="vk-page__state" role="status">Yükleniyor…</p>}
      {!error && ready && overview.data && (
        isNew ? (
          <>
            <header className="vk-page__head">
              <p className="vk-page__eyebrow">Yeni eser</p>
              <h1>Eser ekle</h1>
              <GoldRule className="vk-page__rule" />
            </header>
            <MonumentForm overview={overview.data} initial={null} onSaved={() => undefined} />
          </>
        ) : current ? (
          <Loaded overview={overview.data} edit={current} reload={edit.reload} flash={flash} />
        ) : null
      )}
    </main>
  )
}

function Loaded({ overview, edit, reload, flash }: { overview: ContentOverview; edit: MonumentEdit; reload: () => void; flash: string | null }) {
  const m = edit.monument
  const drafts = edit.facts.filter((f) => f.status === 'draft').length
  return (
    <>
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">{m.monument_id} · {m.city}</p>
        <h1>{m.name}</h1>
        <GoldRule className="vk-page__rule" />
        <p className="vk-content__tags"><OriginTag origin={m.origin} /> <StatusTag status={m.status} /></p>
      </header>
      {flash && <p className="vk-admin__note" role="status">{flash}</p>}

      {m.origin === 'catalog' ? <CatalogFields m={m} /> : <MonumentForm overview={overview} initial={m} onSaved={reload} />}

      <section className="vk-admin__card" aria-labelledby="kayitlar">
        <div className="vk-content__headrow">
          <h2 id="kayitlar">Kayıtlar</h2>
          <Link to={`/yonetim/icerik/eser/${m.monument_id}/yeni-kayit`} className="vk-btn vk-btn--ghost vk-content__small-btn">
            Elle kayıt ekle
          </Link>
        </div>
        {drafts > 0 && <p className="vk-admin__note">{DRAFT_NOTE}</p>}
        {m.origin === 'content' && m.status !== 'published' && (
          <p className="vk-admin__note">Eser yayında değil: kayıtları da eser yayımlanana kadar görünmez.</p>
        )}
        {edit.facts.length === 0 ? (
          <p className="vk-admin__note">Bu eserde içerik yönetiminden eklenmiş kayıt yok.</p>
        ) : (
          <ul className="vk-content__list">
            {edit.facts.map((f) => (
              <li key={f.fact_id}>
                <Link to={`/yonetim/icerik/kayit/${f.fact_id}`}>{f.title}</Link>
                <StatusTag status={f.status} />
                <span className="vk-content__muted">
                  {label(CERTAINTY_LABEL, f.certainty)} · {ORIGIN_LABEL[f.origin]} · s. {f.page} · {formatWhen(f.updated_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PipelinePanel overview={overview} monument={m} onDone={reload} />
      <ImagesSection monument={m} images={edit.images} onChange={reload} />
    </>
  )
}

/** Katalog eseri (onaylı V20): kimlik alanları salt okunurdur; yeni kayıt ve görsel eklenebilir. */
function CatalogFields({ m }: { m: Monument }) {
  return (
    <section className="vk-admin__card" aria-labelledby="kimlik">
      <h2 id="kimlik">Kimlik</h2>
      <p className="vk-admin__note">Katalog eseri: kimlik alanları onaylı katalogdan gelir ve burada değiştirilemez.</p>
      <dl className="vk-content__dl">
        <dt>Tür</dt><dd>{typeLabel(m.type)}</dd>
        <dt>Şehir / ilçe</dt><dd>{m.city} / {m.district}</dd>
        <dt>Adres</dt><dd>{m.address}</dd>
        <dt>Konum</dt><dd>{m.latitude != null && m.longitude != null ? `${m.latitude.toFixed(6)}, ${m.longitude.toFixed(6)}` : 'Yok'}</dd>
        {m.alternative_names.length > 0 && (<><dt>Diğer adlar</dt><dd>{m.alternative_names.join(', ')}</dd></>)}
        {m.site_notice && (<><dt>Ziyaret uyarısı</dt><dd>{m.site_notice}</dd></>)}
      </dl>
    </section>
  )
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

/** Yeni eser veya içerik yönetiminde eklenmiş eserin kimlik formu. */
function MonumentForm({ overview, initial, onSaved }: { overview: ContentOverview; initial: Monument | null; onSaved: () => void }) {
  const id = useId()
  const navigate = useNavigate()
  const [f, setF] = useState({
    name: initial?.name ?? '',
    alternative_names: initial?.alternative_names.join(', ') ?? '',
    type: initial?.type ?? overview.vocab.type[0] ?? '',
    city: initial?.city ?? overview.vocab.cities[0]?.name ?? '',
    district: initial?.district ?? '',
    address: initial?.address ?? '',
    latitude: initial?.latitude != null ? String(initial.latitude) : '',
    longitude: initial?.longitude != null ? String(initial.longitude) : '',
    site_notice: initial?.site_notice ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  const lat = num(f.latitude)
  const lng = num(f.longitude)
  const coordsBad = (lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90))
    || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))
  const citySlug = overview.vocab.cities.find((c) => c.name === f.city)?.slug
  const cityPos = CITIES.find((c) => c.slug === citySlug) ?? CITIES[0]

  async function save(publish: boolean) {
    if (!f.name.trim() || !f.type || !f.city || !f.district.trim() || !f.address.trim()) {
      setMsg({ text: 'Ad, tür, şehir, ilçe ve adres zorunludur.', error: true })
      return
    }
    if (coordsBad) {
      setMsg({ text: 'Konum için enlem ve boylamı birlikte ve geçerli aralıkta girin (ya da ikisini de boş bırakın).', error: true })
      return
    }
    const body: MonumentFields & { publish: boolean } = {
      name: f.name.trim(),
      alternative_names: f.alternative_names.split(',').map((s) => s.trim()).filter(Boolean),
      type: f.type,
      city: f.city,
      district: f.district.trim(),
      address: f.address.trim(),
      latitude: lat,
      longitude: lng,
      site_notice: f.site_notice.trim() || null,
      publish,
    }
    setBusy(true)
    setMsg(null)
    try {
      if (!initial) {
        const created = await createMonument(body)
        navigate(`/yonetim/icerik/eser/${created.monument_id}`, {
          state: { flash: publish ? 'Eser eklendi ve yayımlandı.' : 'Eser taslak olarak eklendi.' },
        })
        return
      }
      await updateMonument(initial.monument_id, body)
      setMsg({ text: publish ? 'Kaydedildi ve yayımlandı.' : 'Taslak olarak kaydedildi (ziyaretçilere görünmez).', error: false })
      onSaved()
    } catch (e) {
      setMsg({ text: errText(e, 'Kaydedilemedi.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    if (!initial) return
    setBusy(true)
    try {
      await withdrawMonument(initial.monument_id)
      setMsg({ text: 'Eser yayından çekildi.', error: false })
      onSaved()
    } catch (e) {
      setMsg({ text: errText(e, 'Yayından çekilemedi.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save(false)
  }

  return (
    <section className="vk-admin__card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Kimlik</h2>
      {initial?.status === 'published' && (
        <p className="vk-admin__note">Yayındaki eser taslak olarak kaydedilirse yayından çekilir; "Kaydet ve yayımla" yeniden onaydır.</p>
      )}
      <form className="vk-cform vk-cform--grid" onSubmit={submit} noValidate>
        <label htmlFor={`${id}-name`}>Ad</label>
        <input id={`${id}-name`} value={f.name} onChange={set('name')} required />
        <label htmlFor={`${id}-alt`}>Diğer adlar (virgülle)</label>
        <input id={`${id}-alt`} value={f.alternative_names} onChange={set('alternative_names')} />
        <label htmlFor={`${id}-type`}>Tür</label>
        <select id={`${id}-type`} value={f.type} onChange={set('type')}>
          {overview.vocab.type.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
        </select>
        <label htmlFor={`${id}-city`}>Şehir</label>
        <select id={`${id}-city`} value={f.city} onChange={set('city')}>
          {overview.vocab.cities.map((c) => <option key={c.slug} value={c.name}>{c.name}</option>)}
        </select>
        <label htmlFor={`${id}-district`}>İlçe</label>
        <input id={`${id}-district`} value={f.district} onChange={set('district')} required />
        <label htmlFor={`${id}-address`}>Adres</label>
        <input id={`${id}-address`} value={f.address} onChange={set('address')} required />
        <label htmlFor={`${id}-notice`}>Ziyaret uyarısı (isteğe bağlı)</label>
        <textarea id={`${id}-notice`} rows={2} value={f.site_notice} onChange={set('site_notice')}
          placeholder="ör. Aktif ibadet mekânıdır; namaz vakitlerinde sessiz olun." />

        <fieldset className="vk-cform__coords">
          <legend>Konum (isteğe bağlı; konumsuz eser haritada ve rotada yer almaz, ziyaret edilemez)</legend>
          <div className="vk-cform__pair">
            <label htmlFor={`${id}-lat`}>Enlem</label>
            <input id={`${id}-lat`} inputMode="decimal" value={f.latitude} onChange={set('latitude')} aria-invalid={coordsBad || undefined} />
            <label htmlFor={`${id}-lng`}>Boylam</label>
            <input id={`${id}-lng`} inputMode="decimal" value={f.longitude} onChange={set('longitude')} aria-invalid={coordsBad || undefined} />
          </div>
          <p className="vk-admin__note">Haritaya tıklayarak da konum seçebilirsiniz.</p>
          <Suspense fallback={<p className="vk-admin__note">Harita yükleniyor…</p>}>
            <LocationPicker
              value={lat !== null && lng !== null && !coordsBad ? { lat, lng } : null}
              center={{ lat: cityPos.lat, lng: cityPos.lng }}
              onPick={(p) => setF((prev) => ({ ...prev, latitude: p.lat.toFixed(6), longitude: p.lng.toFixed(6) }))}
            />
          </Suspense>
        </fieldset>

        <div className="vk-cform__actions">
          <button type="submit" className="vk-btn vk-btn--ghost" disabled={busy}>Taslak olarak kaydet</button>
          <button type="button" className="vk-btn" disabled={busy} onClick={() => void save(true)}>Kaydet ve yayımla</button>
          {initial?.status === 'published' && (
            <button type="button" className="vk-link-btn" disabled={busy} onClick={() => void withdraw()}>Yayından çek</button>
          )}
        </div>
        <p className={msg?.error ? 'vk-cform__error' : 'vk-admin__note'} role={msg?.error ? 'alert' : 'status'}>{msg?.text ?? ''}</p>
      </form>
    </section>
  )
}

const LICENSES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'Kamu malı', 'Kurum izniyle']

/** Eser görselleri: yükleme (hak sahibi, lisans, atıf zorunlu bilgi), önizleme, yayımlama ve geri çekme. */
function ImagesSection({ monument, images, onChange }: { monument: Monument; images: ContentImage[]; onChange: () => void }) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [f, setF] = useState({ rights_holder: '', license: '', attribution: '', title: '', source_url: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  async function upload(publish: boolean) {
    if (!file || !f.rights_holder.trim() || !f.license.trim()) {
      setMsg({ text: 'Görsel dosyası, hak sahibi ve lisans zorunludur.', error: true })
      return
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setMsg({ text: 'Yalnızca JPEG veya PNG görsel yüklenebilir.', error: true })
      return
    }
    if (f.source_url && !f.source_url.startsWith('https://')) {
      setMsg({ text: 'Kaynak adresi https:// ile başlamalıdır.', error: true })
      return
    }
    setBusy(true)
    setMsg({ text: 'Görsel yükleniyor…', error: false })
    try {
      const up = await uploadContentFile(file)
      await addImage(monument.monument_id, {
        upload_id: up.upload_id,
        rights_holder: f.rights_holder.trim(),
        license: f.license.trim(),
        attribution: f.attribution.trim() || null,
        title: f.title.trim() || null,
        source_url: f.source_url.trim() || null,
        publish,
      })
      setMsg({ text: publish ? 'Görsel eklendi ve yayımlandı.' : 'Görsel taslak olarak eklendi.', error: false })
      setFile(null)
      setF({ rights_holder: '', license: '', attribution: '', title: '', source_url: '' })
      if (fileRef.current) fileRef.current.value = ''
      onChange()
    } catch (e) {
      setMsg({ text: errText(e, 'Görsel eklenemedi.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  async function act(img: ContentImage, action: 'publish' | 'withdraw') {
    setBusy(true)
    try {
      await imageAction(img.image_id, action)
      setMsg({ text: action === 'publish' ? 'Görsel yayımlandı.' : 'Görsel yayından çekildi.', error: false })
      onChange()
    } catch (e) {
      setMsg({ text: errText(e, 'İşlem başarısız.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="vk-admin__card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Görseller</h2>
      {images.length === 0 ? (
        <p className="vk-admin__note">İçerik yönetiminden eklenmiş görsel yok.</p>
      ) : (
        <ul className="vk-content__images">
          {images.map((img) => (
            <li key={img.image_id}>
              <img src={adminMediaUrl(img.url)} alt={img.title ?? `${monument.name} görseli`} loading="lazy" />
              <div>
                <StatusTag status={img.status} />
                <p className="vk-content__muted">
                  {img.attribution ?? img.rights_holder} · {img.license}
                </p>
                {img.status === 'published' ? (
                  <button type="button" className="vk-link-btn" disabled={busy} onClick={() => void act(img, 'withdraw')}>Yayından çek</button>
                ) : (
                  <button type="button" className="vk-link-btn" disabled={busy} onClick={() => void act(img, 'publish')}>Onayla ve yayımla</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="vk-cform vk-cform--grid" onSubmit={(e) => { e.preventDefault(); void upload(false) }} noValidate>
        <h3>Görsel ekle</h3>
        <label htmlFor={`${id}-file`}>Görsel (JPEG veya PNG)</label>
        <input ref={fileRef} id={`${id}-file`} type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label htmlFor={`${id}-holder`}>Hak sahibi</label>
        <input id={`${id}-holder`} value={f.rights_holder} onChange={set('rights_holder')} />
        <label htmlFor={`${id}-license`}>Lisans</label>
        <input id={`${id}-license`} list={`${id}-licenses`} value={f.license} onChange={set('license')} />
        <datalist id={`${id}-licenses`}>{LICENSES.map((l) => <option key={l} value={l} />)}</datalist>
        <label htmlFor={`${id}-attr`}>Atıf satırı (CC BY lisanslarında zorunlu)</label>
        <input id={`${id}-attr`} value={f.attribution} onChange={set('attribution')} placeholder="ör. Fotoğraf: Ad Soyad, CC BY-SA 4.0" />
        <label htmlFor={`${id}-title`}>Başlık / açıklama (alternatif metin)</label>
        <input id={`${id}-title`} value={f.title} onChange={set('title')} />
        <label htmlFor={`${id}-url`}>Kaynak adresi (isteğe bağlı, https)</label>
        <input id={`${id}-url`} type="url" value={f.source_url} onChange={set('source_url')} />
        <div className="vk-cform__actions">
          <button type="submit" className="vk-btn vk-btn--ghost" disabled={busy}>Taslak olarak ekle</button>
          <button type="button" className="vk-btn" disabled={busy} onClick={() => void upload(true)}>Ekle ve yayımla</button>
        </div>
        <p className={msg?.error ? 'vk-cform__error' : 'vk-admin__note'} role={msg?.error ? 'alert' : 'status'}>{msg?.text ?? ''}</p>
      </form>
    </section>
  )
}
