import { useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getContentMonument,
  getContentOverview,
  monumentOfFact,
  putTranslation,
  translationAction,
  useLoad,
  type ContentOverview,
  type ContentTranslation,
  type MonumentEdit,
  type QuestText,
  type TranslationInput,
} from '../../api'
import { GoldRule } from '../../components/Ornament'
import { AdminNav } from './AdminNav'
import { SourcePageView } from './FactEditor'
import { DRAFT_NOTE, ORIGIN_LABEL, QUOTE_CHECK_LABEL, formatWhen } from './labels'
import { StatusTag } from './StatusTag'
import '../discover.css'
import '../admin.css'
import './content.css'

type Form = Omit<TranslationInput, 'publish' | 'page' | 'quest_en' | 'note'> & { page: string; quest: QuestText | null }
type Msg = { text: string; error: boolean } | null

/** Türkçe kayıt: eserin yayındaki kayıtlarından (katalog dahil) ya da depodaki (henüz yayında olmayan) kayıtlardan. */
function trRecord(edit: MonumentEdit, factId: string) {
  const published = edit.tr_facts?.find((f) => f.fact_id === factId)
  const content = edit.facts.find((f) => f.fact_id === factId)
  if (published) return { title: published.title, text: published.text, content: !!content, page: content?.page, sourceId: content?.source_id }
  if (content) return { title: content.title, text: content.text, content: true, page: content.page, sourceId: content.source_id }
  return null
}

function initialForm(t: ContentTranslation | null, overview: ContentOverview, sourceId?: string, page?: number): Form {
  return t
    ? { title_en: t.title_en, text_en: t.text_en, quote_en: t.quote_en, source_id: t.source_id, page: String(t.page),
        quest: t.quest_en ?? null }
    : {
        title_en: '', text_en: '', quote_en: '', quest: null,
        source_id: sourceId && overview.sources.some((s) => s.source_id === sourceId) ? sourceId : overview.sources[0]?.source_id ?? '',
        page: String(page ?? 1),
      }
}

/**
 * Çeviri düzenleyici (Faz 11): bir Türkçe kaydın (katalog ya da depo) İngilizcesi. İngilizce metin kitabın İngilizce
 * bölümünden alınır, İngilizce alıntı kaynak sayfada vurgulanır; yönetici karşılaştırıp onaylar.
 * Adres: `/yonetim/icerik/ceviri/:factId`.
 */
export default function TranslationEditor() {
  const { factId = '' } = useParams()
  const monumentId = monumentOfFact(factId)
  const overview = useLoad((s) => getContentOverview(s), [])
  const edit = useLoad((s) => getContentMonument(monumentId, s), [monumentId])
  const error = overview.error ?? edit.error
  const ready = overview.data && edit.data && edit.data.monument.monument_id === monumentId
  const tr = ready ? trRecord(edit.data!, factId) : null
  const translation = ready ? edit.data!.translations?.find((t) => t.fact_id === factId) ?? null : null

  return (
    <main className="vk-page vk-admin vk-content">
      <AdminNav />
      <p className="vk-content__crumb">
        <Link to="/yonetim/icerik">← İçerik yönetimi</Link>
        {edit.data && <> · <Link to={`/yonetim/icerik/eser/${monumentId}`}>{edit.data.monument.name}</Link></>}
      </p>
      {error && <p className="vk-page__state vk-page__state--error" role="alert">{error}</p>}
      {!error && !ready && <p className="vk-page__state" role="status">Yükleniyor…</p>}
      {!error && ready && !tr && !translation && (
        <p className="vk-page__state vk-page__state--error" role="alert">Türkçe kayıt bulunamadı.</p>
      )}
      {!error && ready && (tr || translation) && (
        <Editor
          key={`${factId}-${translation?.updated_at ?? 'yeni'}`}
          factId={factId}
          overview={overview.data!}
          edit={edit.data!}
          tr={tr}
          translation={translation}
          onSaved={edit.reload}
        />
      )}
    </main>
  )
}

function Editor({ factId, overview, edit, tr, translation, onSaved }: {
  factId: string
  overview: ContentOverview
  edit: MonumentEdit
  tr: ReturnType<typeof trRecord>
  translation: ContentTranslation | null
  onSaved: () => void
}) {
  const id = useId()
  const start = useMemo(() => initialForm(translation, overview, tr?.sourceId, tr?.page), [translation, overview, tr])
  const [f, setF] = useState<Form>(start)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const dirty = JSON.stringify(f) !== JSON.stringify(start)
  const source = overview.sources.find((s) => s.source_id === f.source_id)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const pageNum = Number(f.page)
  const status = translation?.status

  function validate(): string | null {
    // Sunucudaki sınırlarla aynı (backend/app/content_routes.py TranslationBody).
    if (f.title_en.trim().length < 3) return 'İngilizce başlık en az 3 karakter olmalı.'
    if (f.text_en.trim().length < 10) return 'İngilizce metin en az 10 karakter olmalı.'
    if (!source) return 'Kaynak kitap seçin.'
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > source.page_count) return `Sayfa 1 ile ${source.page_count} arasında olmalı.`
    if (f.quest) {
      if (f.quest.question.trim().length < 5 || f.quest.explanation.trim().length < 5) return 'İngilizce soru ve açıklama en az 5 karakter olmalı.'
      if (f.quest.choices.some((c) => !c.trim())) return 'İngilizce şıkların hepsi doldurulmalı.'
    }
    return null
  }

  const body = (publish: boolean): TranslationInput => ({
    title_en: f.title_en.trim(), text_en: f.text_en.trim(), quote_en: f.quote_en.trim(), source_id: f.source_id,
    page: pageNum, publish, note: translation?.note ?? null,
    quest_en: f.quest ? { question: f.quest.question.trim(), choices: f.quest.choices.map((c) => c.trim()), explanation: f.quest.explanation.trim() } : null,
  })
  const trQuest = translation?.fact_quest ?? null
  const setQuest = (patch: Partial<QuestText>) =>
    setF((p) => ({ ...p, quest: { ...(p.quest ?? { question: '', choices: (trQuest?.choices ?? []).map(() => ''), explanation: '' }), ...patch } }))

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
      if (kind === 'reject' || kind === 'withdraw') await translationAction(factId, kind)
      else if (kind === 'publish' && translation && !dirty) await translationAction(factId, 'publish')
      else await putTranslation(factId, body(kind === 'publish'))
      setMsg({
        text: {
          publish: 'Çeviri onaylandı ve yayımlandı.',
          draft: status === 'published' ? 'Taslak olarak kaydedildi; çeviri yayından çekildi.' : 'Çeviri taslak olarak kaydedildi.',
          reject: 'Çeviri reddedildi.',
          withdraw: 'Çeviri yayından çekildi.',
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

  return (
    <>
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">{factId} · {edit.monument.name} · İngilizce</p>
        <h1>Çeviriyi incele</h1>
        <GoldRule className="vk-page__rule" />
      </header>

      <div className="vk-factedit">
        <section className="vk-admin__card vk-factedit__form" aria-labelledby={`${id}-h`}>
          <h2 id={`${id}-h`}>Türkçe kayıt</h2>
          {tr ? (
            <div className="vk-trn__tr">
              <p className="vk-trn__tr-title">{tr.title}</p>
              <p>{tr.text}</p>
              {tr.content && <Link to={`/yonetim/icerik/kayit/${factId}`}>Türkçe kaydı aç</Link>}
            </div>
          ) : (
            <p className="vk-cform__warn" role="note">Türkçe kayıt yayında değil; çeviri o kayıt yayımlanana kadar görünmez.</p>
          )}

          <h2 id={`${id}-en`} className="vk-trn__en-h">İngilizce</h2>
          <p className="vk-admin__note">İngilizce metin kitabın İngilizce bölümünden alınır; makine çevirisi kullanılmaz.</p>
          {translation && (
            <dl className="vk-content__dl">
              <dt>Durum</dt><dd><StatusTag status={translation.status} /></dd>
              <dt>Geldiği yol</dt><dd>{ORIGIN_LABEL[translation.origin]}</dd>
              <dt>Alıntı denetimi</dt><dd>{QUOTE_CHECK_LABEL[translation.quote_check]}</dd>
              <dt>Onay</dt>
              <dd>{translation.decision ? `${translation.decision.by} · ${formatWhen(translation.decision.at)}` : 'Henüz onaylanmadı'}</dd>
            </dl>
          )}
          {translation?.note && (
            <p className="vk-cform__warn" role="note"><strong>Taslak notu:</strong> {translation.note}</p>
          )}
          {status !== 'published' && <p className="vk-admin__note vk-factedit__draft">{DRAFT_NOTE}</p>}
          {status === 'published' && (
            <p className="vk-admin__note">Yayındaki çeviri taslak olarak kaydedilirse yayından çekilir; "Kaydet ve yayımla" yeniden onaydır.</p>
          )}

          <form className="vk-cform vk-cform--grid" onSubmit={submit} noValidate aria-labelledby={`${id}-en`}>
            <label htmlFor={`${id}-title`}>İngilizce başlık</label>
            <input id={`${id}-title`} lang="en" value={f.title_en} onChange={(e) => set('title_en', e.target.value)} />
            <label htmlFor={`${id}-text`}>İngilizce metin (İngilizce arayüzde gösterilir ve anlatılır)</label>
            <textarea id={`${id}-text`} lang="en" rows={5} value={f.text_en} onChange={(e) => set('text_en', e.target.value)} />
            <label htmlFor={`${id}-src`}>Kaynak kitap</label>
            <select id={`${id}-src`} value={f.source_id} onChange={(e) => set('source_id', e.target.value)}>
              {overview.sources.length === 0 && <option value="">Önce bir kitap ekleyin</option>}
              {overview.sources.map((s) => <option key={s.source_id} value={s.source_id}>{s.title}</option>)}
            </select>
            {source && !source.rights_confirmed && (
              <p className="vk-cform__warn" role="note">Bu kaynağın kullanım izni işaretlenmemiş: çeviri yayımlanamaz.</p>
            )}
            <label htmlFor={`${id}-page`}>Sayfa (PDF dosyasındaki sıra)</label>
            <input id={`${id}-page`} type="number" min={1} max={source?.page_count} value={f.page} onChange={(e) => set('page', e.target.value)} />
            <label htmlFor={`${id}-quote`}>Kitabın İngilizce bölümünden birebir alıntı (isteğe bağlı; yazılırsa sayfada bulunmalı)</label>
            <textarea id={`${id}-quote`} lang="en" rows={3} value={f.quote_en} onChange={(e) => set('quote_en', e.target.value)} />

            {trQuest && (
              <fieldset className="vk-cform__wide">
                <legend>Soru (R6.17)</legend>
                <p className="vk-admin__note">
                  Türkçe: {trQuest.question} — {trQuest.choices.join(' / ')}. Şıklar aynı sırada çevrilir; doğru cevap Türkçe
                  sorudaki şıktır ve değişmez.
                </p>
                <label htmlFor={`${id}-q`}>İngilizce soru</label>
                <input id={`${id}-q`} lang="en" value={f.quest?.question ?? ''} onChange={(e) => setQuest({ question: e.target.value })} />
                {trQuest.choices.map((c, i) => (
                  <div key={i}>
                    <label htmlFor={`${id}-c${i}`}>Şık {i + 1} ({c})</label>
                    <input id={`${id}-c${i}`} lang="en" value={f.quest?.choices[i] ?? ''}
                      onChange={(e) => setQuest({ choices: trQuest.choices.map((_, j) => (j === i ? e.target.value : f.quest?.choices[j] ?? '')) })} />
                  </div>
                ))}
                <label htmlFor={`${id}-x`}>İngilizce açıklama</label>
                <textarea id={`${id}-x`} lang="en" rows={2} value={f.quest?.explanation ?? ''} onChange={(e) => setQuest({ explanation: e.target.value })} />
              </fieldset>
            )}

            <div className="vk-cform__actions">
              {(!translation || status !== 'published' || dirty) && (
                <button type="button" className="vk-btn" disabled={busy} onClick={() => void run('publish')}>
                  {translation && status !== 'published' ? 'Onayla ve yayımla' : 'Kaydet ve yayımla'}
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
          quote={f.quote_en}
          onUsePage={(p) => set('page', String(p))}
        />
      </div>
    </>
  )
}
