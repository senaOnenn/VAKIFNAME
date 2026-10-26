import { useEffect, useState } from 'react'
import { ApiErrorMessage } from '../components/ApiErrorMessage'
import { ArchitectureDrawing, drawingVariantFor } from '../components/ArchitectureDrawing'
import { MapPinIcon } from '../components/Icons'
import { PhotoGallery } from '../components/PhotoGallery'
import { Seal } from '../components/Seal'
import { useApi } from '../hooks/useApi'
import { getVisitorId } from '../visitor'
import { AskMonument } from './AskMonument'
import { answerQuest, getMonument, getQuests, mediaUrl, notifyProgress } from './catalogClient'
import './monument-story.css'
import type { AnswerResult, ArchiveCollection, MonumentDetail, MonumentFact, MonumentImage, Quest } from './types'

const CATEGORY_LABELS: Record<string, string> = {
  construction: 'Yapım',
  foundation_purpose: 'Vakıf ve amaç',
  historical_person: 'Tarihî şahıslar',
  historical_event: 'Tarihî olaylar',
  architecture: 'Mimari',
  artistic_feature: 'Süsleme ve sanat',
  inscription: 'Kitabeler',
  burial_practice: 'Defin geleneği',
  function: 'Kullanım',
  restoration: 'Onarımlar',
}
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS)
const LICENSE_NAMES: Record<string, string> = {
  'CC0-1.0': 'CC0', public_domain: 'Kamu malı', 'CC-BY-2.0': 'CC BY 2.0', 'CC-BY-3.0': 'CC BY 3.0', 'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-2.0': 'CC BY-SA 2.0', 'CC-BY-SA-2.5': 'CC BY-SA 2.5', 'CC-BY-SA-3.0': 'CC BY-SA 3.0', 'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  written_permission: 'Yazılı izinle',
}

export const licenseName = (code: string) => LICENSE_NAMES[code] ?? code

/** Fotoğraf atfı: yazar, lisans (bağlantılı) ve kaynak. CC BY / BY-SA lisanslarının zorunlu kıldığı bilgiler. */
export function Credit({
  image,
}: {
  image: Pick<MonumentImage, 'rights_holder' | 'license' | 'license_url' | 'source_url'> & { source_label?: string | null }
}) {
  const source = image.source_label ?? 'Wikimedia Commons'
  return (
    <span className="credit">
      Fotoğraf: {image.rights_holder} ·{' '}
      {image.license_url ? (
        <a href={image.license_url} target="_blank" rel="noopener noreferrer license">
          {licenseName(image.license)}
        </a>
      ) : (
        licenseName(image.license)
      )}
      {image.source_url ? (
        <>
          {' · '}
          <a href={image.source_url} target="_blank" rel="noopener noreferrer">
            {source}
          </a>
        </>
      ) : (
        image.source_label && <> · {image.source_label}</>
      )}
    </span>
  )
}

/** Proje arşivi koleksiyonu: fotoğraflar arşivdeki klasöre göre; kimlik çelişkisi her fotoğrafın açıklamasında. */
function ArchiveGallery({ m, collection }: { m: MonumentDetail; collection: ArchiveCollection }) {
  const n = collection.images.length
  return (
    <section className="story-archive" aria-labelledby="arsiv-koleksiyonu-title">
      <h3 id="arsiv-koleksiyonu-title">Proje arşivi koleksiyonu</h3>
      <p className="story-archive__note">{collection.note}</p>
      <PhotoGallery
        label={`${m.name} — proje arşivi fotoğrafları`}
        photos={collection.images.map((im, i) => ({
          key: im.image_id,
          src: mediaUrl(im.file),
          thumbSrc: mediaUrl(im.card_file ?? im.file),
          width: im.width,
          height: im.height,
          alt: `Arşivde ${im.archive_folder} klasöründeki fotoğraf ${i + 1}/${n}`,
          caption: (
            <>
              Arşivdeki sınıflandırma: {im.archive_folder}
              {im.identity_note && <span className="story-archive__conflict"> · {im.identity_note}</span>}
            </>
          ),
          credit: <span className="credit">Kaynak: {collection.source_label}</span>,
        }))}
      />
    </section>
  )
}

function Gallery({ m, index }: { m: MonumentDetail; index: number }) {
  const archive = m.archive_collection?.images.length ? m.archive_collection : null
  return (
    <div className="story-galleries">
      <ApprovedGallery m={m} index={index} />
      {archive && <ArchiveGallery m={m} collection={archive} />}
    </div>
  )
}

function ApprovedGallery({ m, index }: { m: MonumentDetail; index: number }) {
  if (m.images.length === 0) {
    return (
      <div className="story-gallery story-gallery--empty">
        <ArchitectureDrawing variant={drawingVariantFor(index)} />
        <p className="art-label">Temsilî çizim · Lisansı onaylanmış fotoğraf henüz yok</p>
      </div>
    )
  }
  return (
    <PhotoGallery
      label={`${m.name} fotoğrafları`}
      photos={m.images.map((im, i) => ({
        key: im.image_id,
        src: mediaUrl(im.file),
        thumbSrc: mediaUrl(im.card_file ?? im.file),
        width: im.width,
        height: im.height,
        alt: `${m.name} — fotoğraf ${i + 1}/${m.images.length}`,
        caption: `Eser: ${m.name}`,
        credit: <Credit image={im} />,
      }))}
    />
  )
}

function FactItem({ f }: { f: MonumentFact }) {
  return (
    <li className="story-fact">
      <h5>{f.title}</h5>
      <p>{f.text}</p>
      {f.certainty !== 'documented' && (
        <p className="story-fact__certainty">{f.certainty === 'uncertain' ? 'Kaynaklarda kesin değil' : 'Aktarılan bilgi'}</p>
      )}
      <p className="story-fact__sources">
        {(f.sources ?? []).map((s, i) => (
          <span key={s.url}>
            {i > 0 && ' · '}
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.publisher}: {s.title}
            </a>
          </span>
        ))}
        {(f.sources ?? []).length > 0 && ' · '}
        <span className="story-fact__book">
          Kaynakça: {f.source.title}, s. {f.source.pdf_physical_page}
        </span>
      </p>
    </li>
  )
}

function Story({ m }: { m: MonumentDetail }) {
  if (m.facts.length === 0) {
    return <p>Bu eser için yayına onaylanmış tarihî bilgi henüz yok.</p>
  }
  const groups = CATEGORY_ORDER.map((c) => [c, m.facts.filter((f) => f.category === c)] as const).filter(([, fs]) => fs.length)
  const other = m.facts.filter((f) => !CATEGORY_LABELS[f.category])
  return (
    <div className="story-groups">
      {groups.map(([c, fs]) => (
        <section key={c} aria-label={CATEGORY_LABELS[c]}>
          <h4>{CATEGORY_LABELS[c]}</h4>
          <ol className="story-facts">
            {fs.map((f) => (
              <FactItem key={f.fact_id} f={f} />
            ))}
          </ol>
        </section>
      ))}
      {other.length > 0 && (
        <ol className="story-facts">
          {other.map((f) => (
            <FactItem key={f.fact_id} f={f} />
          ))}
        </ol>
      )}
      <p className="story-note">
        Metinler, bağımsız resmî ve bilimsel kaynaklarla doğrulanan bilgilerden editör onayıyla özgün olarak yazılmıştır. Kaynak
        kitap yalnızca kaynakça olarak anılır.
      </p>
    </div>
  )
}

function QuestCard({ monumentId, quest, solved, onAnswered }: { monumentId: string; quest: Quest; solved: boolean; onAnswered: (r: AnswerResult) => void }) {
  const [choice, setChoice] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const done = solved || result?.correct === true

  async function submit() {
    if (choice === null) return
    setBusy(true)
    setError(null)
    try {
      const r = await answerQuest(monumentId, quest.quest_id, getVisitorId(), choice)
      setResult(r)
      onAnswered(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`quest-card${done ? ' quest-card--done' : ''}`}>
      <fieldset disabled={busy || done}>
        <legend>{quest.question}</legend>
        {quest.choices.map((c, i) => (
          <label key={i} className="quest-card__choice">
            <input type="radio" name={`q-${quest.quest_id}`} checked={choice === i} onChange={() => setChoice(i)} />
            {c}
          </label>
        ))}
      </fieldset>
      {!done && (
        <button type="button" className="button button--primary" disabled={choice === null || busy} onClick={submit}>
          {busy ? 'Kontrol ediliyor…' : 'Cevapla'}
        </button>
      )}
      {result && !result.correct && (
        <p className="quest-card__feedback quest-card__feedback--wrong" role="status">
          Doğru değil. Hikâyeyi yeniden oku ve tekrar dene.
        </p>
      )}
      {done && (
        <p className="quest-card__feedback quest-card__feedback--right" role="status">
          ✓ Doğru. {result?.explanation ?? 'Bu soruyu daha önce çözdün.'}
        </p>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

function QuestPlayer({ m }: { m: MonumentDetail }) {
  const visitorId = getVisitorId()
  const quests = useApi((signal) => getQuests(m.monument_id, visitorId, signal), `quests:${m.monument_id}:${visitorId}`)
  const [progress, setProgress] = useState<{ total: number; solved: number; solved_ids: string[] } | null>(null)
  const [seal, setSeal] = useState<AnswerResult['knowledge_seal']>(null)
  // Sunucudan gelen ilk ilerleme yalnızca veri değişince alınır; cevaplardan gelen güncel ilerlemeyi ezmez.
  const loaded = quests.status === 'success' ? quests.data : null
  useEffect(() => {
    if (loaded) setProgress(loaded.progress)
  }, [loaded])

  if (quests.status === 'loading') return <p role="status">Görev yükleniyor…</p>
  if (quests.status === 'error') return <ApiErrorMessage title="Görev yüklenemedi" error={quests.error} onRetry={quests.reload} />
  const list = quests.data.quests
  if (list.length === 0) {
    return <p>Bu eser için henüz oyunda kullanılmak üzere onaylanmış soru yok.</p>
  }
  const p = progress ?? quests.data.progress
  const complete = p.total > 0 && p.solved === p.total
  return (
    <div className="quest-player">
      <div className="quest-progress" aria-label="Görev ilerlemesi">
        <div className="quest-progress__bar">
          <span style={{ width: `${(100 * p.solved) / Math.max(1, p.total)}%` }} />
        </div>
        <p>
          {p.solved}/{p.total} soru çözüldü
        </p>
      </div>
      {(complete || seal) && (
        <div className="seal-banner" role="status">
          <Seal className="seal-banner__seal" />
          <div>
            <p className="seal-banner__title">{m.name} bilgi mührü pasaportunda</p>
            <p>Bilgi mührü uzaktan keşifle kazanılır; fiziksel ziyaret mührü değildir.</p>
          </div>
        </div>
      )}
      <ol className="quest-list">
        {list.map((q) => (
          <QuestCard
            key={q.quest_id}
            monumentId={m.monument_id}
            quest={q}
            solved={p.solved_ids.includes(q.quest_id)}
            onAnswered={(r) => {
              setProgress(r.progress)
              if (r.knowledge_seal) setSeal(r.knowledge_seal)
              if (r.correct) notifyProgress()
            }}
          />
        ))}
      </ol>
    </div>
  )
}

function VisitStatus({ m }: { m: MonumentDetail }) {
  return (
    <div className="visit-status">
      <h4>Yerinde ziyaret</h4>
      <p>
        <MapPinIcon />{' '}
        {m.location
          ? `Haritadaki nokta doğrulanmış yapı konumudur (yaklaşık ±${Math.round(m.location.accuracy_m)} m); giriş kapısı değildir.`
          : 'Konum henüz doğrulanmadı; eser haritada gösterilmiyor.'}
      </p>
      <p>
        {m.checkin_available && m.checkin
          ? `Ziyaret mührü açık: herkese açık nokta, ${Math.round(m.checkin.radius_m)} m yarıçap. ${m.checkin.access_hours_note} ${m.checkin.safety_note}`
          : 'Fiziksel ziyaret mührü bu eserde henüz açık değil: güvenli ve herkese açık bir giriş noktası sahada doğrulanınca açılacak. Uzaktan keşif görevi şimdiden oynanabilir.'}
      </p>
    </div>
  )
}

/** Seçilen eserin hikâyesi, fotoğrafları, kaynakları ve keşif görevi (yalnızca yayın onaylı içerik). */
export function MonumentStory({ monumentId, index, onClose }: { monumentId: string; index: number; onClose: () => void }) {
  const detail = useApi((signal) => getMonument(monumentId, signal), `monument:${monumentId}`)
  return (
    <section id="eser-hikayesi" className="section monument-story" aria-labelledby="eser-hikayesi-title">
      <div className="container">
        {detail.status === 'loading' && <p role="status">Eser yükleniyor…</p>}
        {detail.status === 'error' && (
          <ApiErrorMessage
            title={detail.error.status === 404 ? 'Eser bulunamadı veya yayımlanmadı' : 'Eser yüklenemedi'}
            error={detail.error}
            onRetry={detail.reload}
          />
        )}
        {detail.status === 'success' && (
          <article className="monument-story__grid">
            <header className="monument-story__header">
              <p className="story__eyebrow">
                {detail.data.type} · {detail.data.district}, {detail.data.city}
              </p>
              <h2 id="eser-hikayesi-title" className="section__title">
                {detail.data.name}
              </h2>
              {detail.data.alternative_names.length > 0 && (
                <p className="monument-story__alt">Diğer adları: {detail.data.alternative_names.join(', ')}</p>
              )}
              <p className="monument-story__address">{detail.data.address}</p>
              {detail.data.site_notice && <p className="notice">{detail.data.site_notice}</p>}
              <button type="button" className="button button--secondary" onClick={onClose}>
                Kataloğa dön
              </button>
            </header>
            <Gallery m={detail.data} index={index} />
            <div className="monument-story__story">
              <h3>Tarihî hikâye</h3>
              <Story m={detail.data} />
            </div>
            <aside className="monument-story__quest" aria-labelledby="kesif-gorevi-title">
              <h3 id="kesif-gorevi-title">Keşif görevi</h3>
              <p className="inventory-muted">Soruların cevapları yukarıdaki hikâyede. Hepsini çöz, bilgi mührünü kazan.</p>
              <QuestPlayer m={detail.data} />
              <VisitStatus m={detail.data} />
            </aside>
            <AskMonument monumentId={detail.data.monument_id} monumentName={detail.data.name} />
          </article>
        )}
      </div>
    </section>
  )
}
