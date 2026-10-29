import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  createFact,
  factAction,
  getContentMonument,
  getContentOverview,
  getSourcePage,
  monumentOfFact,
  updateFact,
  useLoad,
  type ContentFact,
  type ContentOverview,
  type FactInput,
  type MonumentEdit,
  type Quest,
} from '../../api'
import { GoldRule } from '../../components/Ornament'
import { AdminNav } from './AdminNav'
import { CATEGORY_LABEL, CERTAINTY_LABEL, DRAFT_NOTE, ORIGIN_LABEL, QUOTE_CHECK_LABEL, formatWhen, label } from './labels'
import { locateQuote } from './quoteMatch'
import { StatusTag } from './StatusTag'
import '../discover.css'
import '../admin.css'
import './content.css'

type Form = Omit<FactInput, 'publish' | 'page'> & { page: string }
type Msg = { text: string; error: boolean } | null

const EMPTY_QUEST: Quest = { question: '', choices: ['', ''], answer_index: 0, explanation: '' }

function initialForm(fact: ContentFact | null, overview: ContentOverview): Form {
  return fact
    ? {
        title: fact.title, text: fact.text, category: fact.category, certainty: fact.certainty, source_id: fact.source_id,
        page: String(fact.page), quote: fact.quote, game_use: fact.game_use, quest: fact.quest,
      }
    : {
        title: '', text: '', category: overview.vocab.category[0] ?? '', certainty: overview.vocab.certainty[0] ?? 'documented',
        source_id: overview.sources[0]?.source_id ?? '', page: '1', quote: '', game_use: false, quest: null,
      }
}

/**
 * Kayıt düzenleyici: solda kayıt formu, sağda kaynak kitabın atıf verilen sayfası (alıntı vurgulu). Yönetici kaydı
 * kaynağıyla karşılaştırıp onaylar; onaylanmayan kayıt hiçbir yerde görünmez.
 * Adresler: `/yonetim/icerik/kayit/:factId` (düzenle) ve `/yonetim/icerik/eser/:id/yeni-kayit` (elle ekle).
 */
export default function FactEditor() {
  const { factId, id } = useParams()
  const monumentId = factId ? monumentOfFact(factId) : id ?? ''
  const overview = useLoad((s) => getContentOverview(s), [])
  // Yeni kayıt eklenip düzenleyiciye geçilince eser yeniden okunur (yeni kayıt listede olsun).
  const edit = useLoad((s) => getContentMonument(monumentId, s), [monumentId, factId])
  const flash = (useLocation().state as { flash?: string } | null)?.flash ?? null
  const error = overview.error ?? edit.error
  const fact = factId ? edit.data?.facts.find((f) => f.fact_id === factId) ?? null : null
  const ready = overview.data && edit.data && edit.data.monument.monument_id === monumentId

  return (
    <main className="vk-page vk-admin vk-content">
      <AdminNav />
      <p className="vk-content__crumb">
        <Link to="/yonetim/icerik">← İçerik yönetimi</Link>
        {edit.data && <> · <Link to={`/yonetim/icerik/eser/${monumentId}`}>{edit.data.monument.name}</Link></>}
      </p>
      {error && <p className="vk-page__state vk-page__state--error" role="alert">{error}</p>}
      {!error && !ready && <p className="vk-page__state" role="status">Yükleniyor…</p>}
      {!error && ready && factId && !fact && (
        <p className="vk-page__state vk-page__state--error" role="alert">Kayıt bulunamadı.</p>
      )}
      {!error && ready && (!factId || fact) && (
        <Editor
          key={fact ? fact.fact_id : 'yeni'}
          overview={overview.data!}
          edit={edit.data!}
          fact={fact}
          flash={flash}
          onSaved={edit.reload}
        />
      )}
    </main>
  )
}

function Editor({ overview, edit, fact, flash, onSaved }: {
  overview: ContentOverview
  edit: MonumentEdit
  fact: ContentFact | null
  flash: string | null
  onSaved: () => void
}) {
  const id = useId()
  const navigate = useNavigate()
  const start = useMemo(() => initialForm(fact, overview), [fact, overview])
  const [f, setF] = useState<Form>(start)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(flash ? { text: flash, error: false } : null)
  const dirty = JSON.stringify(f) !== JSON.stringify(start)
  const source = overview.sources.find((s) => s.source_id === f.source_id)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const pageNum = Number(f.page)

  function validate(): string | null {
    if (!f.title.trim() || !f.text.trim()) return 'Başlık ve metin zorunludur.'
    if (!source) return 'Kaynak kitap seçin.'
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > source.page_count) return `Sayfa 1 ile ${source.page_count} arasında olmalı.`
    if (f.game_use && f.quest) {
      const q = f.quest
      if (!q.question.trim() || !q.explanation.trim() || q.choices.some((c) => !c.trim())) {
        return 'Keşif sorusunda soru, bütün seçenekler ve açıklama dolu olmalı.'
      }
    }
    return null
  }

  function body(publish: boolean): FactInput {
    return {
      title: f.title.trim(), text: f.text.trim(), category: f.category, certainty: f.certainty, source_id: f.source_id,
      page: pageNum, quote: f.quote.trim(), game_use: f.game_use, quest: f.game_use ? f.quest : null, publish,
    }
  }

  async function run(kind: 'draft' | 'publish' | 'reject' | 'withdraw') {
    if (kind === 'draft' || kind === 'publish') {
      const problem = validate()
      if (problem) {
        setMsg({ text: problem, error: true })
        return
      }
    }
    setBusy(true)
    setMsg(null)
    try {
      if (!fact) {
        const created = await createFact({ ...body(kind === 'publish'), monument_id: edit.monument.monument_id })
        navigate(`/yonetim/icerik/kayit/${created.fact_id}`, {
          replace: true,
          state: { flash: kind === 'publish' ? 'Kayıt eklendi ve yayımlandı.' : 'Kayıt taslak olarak eklendi.' },
        })
        return
      }
      if (kind === 'reject' || kind === 'withdraw') await factAction(fact.fact_id, kind)
      else if (kind === 'publish' && !dirty) await factAction(fact.fact_id, 'publish')
      else await updateFact(fact.fact_id, body(kind === 'publish'))
      setMsg({
        text: {
          publish: 'Onaylandı ve yayımlandı.',
          draft: fact.status === 'published' ? 'Taslak olarak kaydedildi; kayıt yayından çekildi.' : 'Taslak olarak kaydedildi.',
          reject: 'Kayıt reddedildi.',
          withdraw: 'Kayıt yayından çekildi.',
        }[kind],
        error: false,
      })
      onSaved()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'İşlem başarısız.', error: true })
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run('draft')
  }
  const status = fact?.status

  return (
    <>
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">{fact ? fact.fact_id : 'Elle kayıt'} · {edit.monument.name}</p>
        <h1>{fact ? 'Kaydı incele' : 'Yeni kayıt'}</h1>
        <GoldRule className="vk-page__rule" />
      </header>

      <div className="vk-factedit">
        <section className="vk-admin__card vk-factedit__form" aria-labelledby={`${id}-h`}>
          <h2 id={`${id}-h`}>Kayıt</h2>
          {fact && (
            <dl className="vk-content__dl">
              <dt>Durum</dt><dd><StatusTag status={fact.status} /></dd>
              <dt>Geldiği yol</dt><dd>{ORIGIN_LABEL[fact.origin]}</dd>
              <dt>Alıntı denetimi</dt><dd>{QUOTE_CHECK_LABEL[fact.quote_check]}</dd>
              <dt>Onay</dt><dd>{fact.decision ? `${fact.decision.by} · ${formatWhen(fact.decision.at)}` : 'Henüz onaylanmadı'}</dd>
            </dl>
          )}
          {(!fact || status !== 'published') && <p className="vk-admin__note vk-factedit__draft">{DRAFT_NOTE}</p>}
          {status === 'published' && (
            <p className="vk-admin__note">Yayındaki kayıt taslak olarak kaydedilirse yayından çekilir; "Kaydet ve yayımla" yeniden onaydır.</p>
          )}

          <form className="vk-cform vk-cform--grid" onSubmit={submit} noValidate>
            <label htmlFor={`${id}-title`}>Başlık</label>
            <input id={`${id}-title`} value={f.title} onChange={(e) => set('title', e.target.value)} />
            <label htmlFor={`${id}-text`}>Metin (ziyaretçinin okuyacağı ve rehberin anlatacağı cümleler)</label>
            <textarea id={`${id}-text`} rows={5} value={f.text} onChange={(e) => set('text', e.target.value)} />
            <label htmlFor={`${id}-cat`}>Konu</label>
            <select id={`${id}-cat`} value={f.category} onChange={(e) => set('category', e.target.value)}>
              {overview.vocab.category.map((c) => <option key={c} value={c}>{label(CATEGORY_LABEL, c)}</option>)}
            </select>
            <label htmlFor={`${id}-cert`}>Kesinlik</label>
            <select id={`${id}-cert`} value={f.certainty} onChange={(e) => set('certainty', e.target.value)} aria-describedby={`${id}-cert-n`}>
              {overview.vocab.certainty.map((c) => <option key={c} value={c}>{label(CERTAINTY_LABEL, c)}</option>)}
            </select>
            <p id={`${id}-cert-n`} className="vk-admin__note">Rivayet ve kesin olmayan bilgi ziyaretçiye ve anlatımda öyle etiketlenir.</p>
            <label htmlFor={`${id}-src`}>Kaynak kitap</label>
            <select id={`${id}-src`} value={f.source_id} onChange={(e) => set('source_id', e.target.value)}>
              {overview.sources.length === 0 && <option value="">Önce bir kitap ekleyin</option>}
              {overview.sources.map((s) => <option key={s.source_id} value={s.source_id}>{s.title}</option>)}
            </select>
            {source && !source.rights_confirmed && (
              <p className="vk-cform__warn" role="note">Bu kaynağın kullanım izni işaretlenmemiş: kayıt yayımlanamaz.</p>
            )}
            <label htmlFor={`${id}-page`}>Sayfa (PDF dosyasındaki sıra)</label>
            <input id={`${id}-page`} type="number" min={1} max={source?.page_count} value={f.page} onChange={(e) => set('page', e.target.value)} />
            <label htmlFor={`${id}-quote`}>Kitaptan birebir alıntı (isteğe bağlı; yazılırsa sayfada bulunmalı)</label>
            <textarea id={`${id}-quote`} rows={3} value={f.quote} onChange={(e) => set('quote', e.target.value)} />

            <label className="vk-cform__check">
              <input
                type="checkbox"
                checked={f.game_use}
                onChange={(e) => setF((p) => ({ ...p, game_use: e.target.checked, quest: e.target.checked ? p.quest : null }))}
              />
              Oyunda kullanılsın (sınav sorularına girebilir)
            </label>
            {f.game_use && <QuestEditor quest={f.quest} onChange={(q) => set('quest', q)} />}

            <div className="vk-cform__actions">
              {(!fact || status !== 'published' || dirty) && (
                <button type="button" className="vk-btn" disabled={busy} onClick={() => void run('publish')}>
                  {fact && status !== 'published' ? 'Onayla ve yayımla' : 'Kaydet ve yayımla'}
                </button>
              )}
              <button type="submit" className="vk-btn vk-btn--ghost" disabled={busy}>Taslak olarak kaydet</button>
              {status === 'draft' && (
                <button type="button" className="vk-link-btn" disabled={busy} onClick={() => void run('reject')}>Reddet</button>
              )}
              {status === 'published' && (
                <button type="button" className="vk-link-btn" disabled={busy} onClick={() => void run('withdraw')}>Yayından çek</button>
              )}
            </div>
            <p className={msg?.error ? 'vk-cform__error' : 'vk-admin__note'} role={msg?.error ? 'alert' : 'status'}>{msg?.text ?? ''}</p>
          </form>
        </section>

        <SourcePageView
          sourceId={f.source_id}
          sourceTitle={source?.title ?? ''}
          page={Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1}
          quote={f.quote}
          onUsePage={(p) => set('page', String(p))}
        />
      </div>
    </>
  )
}

/** Keşif sorusu: 2–4 seçenek, doğru seçenek yalnızca sunucuda saklanır (genel API soruyu cevapsız sunar). */
function QuestEditor({ quest, onChange }: { quest: Quest | null; onChange: (q: Quest | null) => void }) {
  const id = useId()
  if (!quest) {
    return (
      <button type="button" className="vk-link-btn vk-cform__left" onClick={() => onChange({ ...EMPTY_QUEST, choices: ['', ''] })}>
        Keşif sorusu ekle (isteğe bağlı)
      </button>
    )
  }
  const setChoice = (i: number, v: string) => onChange({ ...quest, choices: quest.choices.map((c, j) => (j === i ? v : c)) })
  const remove = (i: number) =>
    onChange({
      ...quest,
      choices: quest.choices.filter((_, j) => j !== i),
      answer_index: quest.answer_index === i ? 0 : quest.answer_index > i ? quest.answer_index - 1 : quest.answer_index,
    })
  return (
    <fieldset className="vk-cform__quest">
      <legend>Keşif sorusu</legend>
      <label htmlFor={`${id}-q`}>Soru</label>
      <input id={`${id}-q`} value={quest.question} onChange={(e) => onChange({ ...quest, question: e.target.value })} />
      <p className="vk-admin__note" id={`${id}-cn`}>Doğru seçeneği yanındaki düğmeyle işaretleyin.</p>
      {quest.choices.map((c, i) => (
        <div key={i} className="vk-cform__choice">
          <input
            type="radio"
            name={`${id}-ans`}
            checked={quest.answer_index === i}
            onChange={() => onChange({ ...quest, answer_index: i })}
            aria-label={`Seçenek ${i + 1} doğru cevap`}
          />
          <input value={c} onChange={(e) => setChoice(i, e.target.value)} aria-label={`Seçenek ${i + 1}`} aria-describedby={`${id}-cn`} />
          {quest.choices.length > 2 && (
            <button type="button" className="vk-link-btn" onClick={() => remove(i)} aria-label={`Seçenek ${i + 1}'i kaldır`}>Kaldır</button>
          )}
        </div>
      ))}
      {quest.choices.length < 4 && (
        <button type="button" className="vk-link-btn vk-cform__left" onClick={() => onChange({ ...quest, choices: [...quest.choices, ''] })}>
          Seçenek ekle
        </button>
      )}
      <label htmlFor={`${id}-ex`}>Açıklama (cevaptan sonra gösterilir)</label>
      <textarea id={`${id}-ex`} rows={2} value={quest.explanation} onChange={(e) => onChange({ ...quest, explanation: e.target.value })} />
      <button type="button" className="vk-link-btn vk-cform__left" onClick={() => onChange(null)}>Soruyu kaldır</button>
    </fieldset>
  )
}

/** Atıf verilen kaynak sayfa: metin, alıntı vurgusu ve komşu sayfalar arasında gezinme. */
function SourcePageView({ sourceId, sourceTitle, page, quote, onUsePage }: {
  sourceId: string
  sourceTitle: string
  page: number
  quote: string
  onUsePage: (p: number) => void
}) {
  const id = useId()
  const [view, setView] = useState(page)
  useEffect(() => setView(page), [page, sourceId])
  const data = useLoad((s) => (sourceId ? getSourcePage(sourceId, view, s) : Promise.resolve(null)), [sourceId, view])
  const text = data.data?.text ?? ''
  const hit = quote.trim() ? locateQuote(text, quote) : null
  const count = data.data?.page_count

  return (
    <section className="vk-admin__card vk-factedit__source" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Kaynak sayfa</h2>
      {!sourceId ? (
        <p className="vk-admin__note">Kaynak seçilmedi.</p>
      ) : (
        <>
          <p className="vk-content__muted">{sourceTitle} · s. {view}{count ? ` / ${count}` : ''}</p>
          <div className="vk-factedit__pager">
            <button type="button" className="vk-chip" disabled={view <= 1} onClick={() => setView((v) => v - 1)}>← Önceki sayfa</button>
            <button type="button" className="vk-chip" disabled={!!count && view >= count} onClick={() => setView((v) => v + 1)}>Sonraki sayfa →</button>
            {view !== page && (
              <button type="button" className="vk-chip" onClick={() => onUsePage(view)}>Bu sayfayı kaynak yap</button>
            )}
          </div>
          <p className="vk-factedit__check" role="status" aria-live="polite">
            {data.loading ? 'Sayfa yükleniyor…' : data.error ? '' : !quote.trim() ? 'Alıntı yazılmadı.'
              : hit ? 'Alıntı bu sayfada bulundu (vurgulu).' : 'Uyarı: alıntı bu sayfada bulunamadı. Sayfayı veya alıntıyı kontrol edin.'}
          </p>
          {data.error && <p className="vk-cform__error" role="alert">{data.error}</p>}
          {data.data && (
            <div className="vk-factedit__text" tabIndex={0} aria-label={`Kaynak sayfa ${view} metni`}>
              {hit ? (
                <>
                  {text.slice(0, hit.start)}
                  <mark>{text.slice(hit.start, hit.end)}</mark>
                  {text.slice(hit.end)}
                </>
              ) : (
                text || 'Bu sayfada metin yok (görsel sayfa olabilir).'
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
