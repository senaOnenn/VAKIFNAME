import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router-dom'
import { citySlug, typeLabel, type MonumentDetail, type MonumentFact, type PersonCard } from '../api'
import { addressIn, altNamesIn, factIn } from '../contentLang'
import { useLang, type Lang } from '../i18n'
import { Semse } from './HistoryBook'
import { MapIcon } from './Icons'

/**
 * R6.11 Eser sergisi: bütün eserler için TEK şablon (eser bazında yerleşim veya CSS yoktur).
 *  1. Sergi girişi (ilk ekran): koleksiyon yolu, eser adı, kaynaklı kısa giriş, üç temel bilgi, ziyaret notu, bilgi
 *     görevi (ana çağrı) ve harita (ikincil); yanında kemerli sergi nişinde iki arşiv nesnesi: Tarih Defteri ve
 *     Fotoğraf Arşivi (eserin kendi lisanslı fotoğrafından küçük önizleme, atfıyla).
 *  2. Öne çıkanlar: girişi tekrar etmeyen 2–3 onaylı kayıt ve "Tüm tarihî kayıtları incele".
 *  3. Duvar etiketi: ziyaret, açılabilir ayrıntılı künye, kaynak yayın (kitap adı sayfada yalnızca burada; diğer yerlerde
 *     kısa gönderme: "Cilt I, s. 20").
 * Her tarihî metin onaylı bir kayıttan gelir; eksik alan uydurulmaz, satırı/nesnesi çizilmez.
 */

/** Kısa girişin kaydı: yayımlanmış katalog özetiyle aynı kural (backend/app/public_catalog.py `monument_summary`). */
export function leadFact(facts: MonumentFact[]): MonumentFact | null {
  return facts.find((f) => ['construction', 'historical_person', 'foundation_purpose'].includes(f.category)) ?? facts[0] ?? null
}

/** Öne çıkanlar: girişten ve kişi kayıtlarından farklı, mümkünse farklı türden en çok 3 kayıt (katalog sırasıyla). */
const HIGHLIGHT_ORDER = ['architecture', 'artistic_feature', 'historical_event', 'burial_practice', 'function',
  'foundation_purpose', 'inscription', 'construction', 'restoration', 'historical_person']
export function highlightFacts(facts: MonumentFact[], exclude: Set<string>, max = 3): MonumentFact[] {
  const pool = facts.filter((f) => !exclude.has(f.fact_id))
  const picked: MonumentFact[] = []
  for (const cat of HIGHLIGHT_ORDER) {
    const f = pool.find((x) => x.category === cat)
    if (f) picked.push(f)
    if (picked.length === max) break
  }
  if (picked.length < max) picked.push(...pool.filter((f) => !picked.includes(f)).slice(0, max - picked.length))
  return facts.filter((f) => picked.includes(f)) // katalog sırası
}

/** Sayfadaki kaynak yayınlar (bir kez yazılır) ve kayıtların kısa göndermesi ("Cilt I, s. 20"). */
export function sourceIndex(facts: MonumentFact[]) {
  const titles = [...new Set(facts.map((f) => f.source?.title).filter((s): s is string => !!s))]
  // R6.17: kitabın özgün adı aynen kalır; yalnızca kısa göndermedeki "Cilt"/"Kaynak" arayüz dilindedir (Vol. I, p. 20).
  const short = (title: string, lang: Lang) => {
    const num = /Cilt\s+([IVXLC\d]+)/i.exec(title)?.[1]
    const vol = num ? `${lang === 'en' ? 'Vol.' : 'Cilt'} ${num}` : null
    return titles.length > 1 || !vol ? `${vol ?? (lang === 'en' ? 'Source' : 'Kaynak')} [${titles.indexOf(title) + 1}]` : vol
  }
  const ref = (f: MonumentFact, lang: Lang) => `${short(f.source.title, lang)}, ${lang === 'en' ? 'p.' : 's.'} ${factIn(f, lang).page}`
  return { titles, ref, numbered: titles.length > 1 }
}

const CERT: Record<string, string> = { reported: 'Rivayet', uncertain: 'Kesin değil' }
export function Certainty({ value }: { value: string }) {
  const { t } = useLang()
  return CERT[value] ? <span className="vk-cert vk-cert--uncertain">{t(CERT[value])}</span> : null
}

export interface ExhibitPhoto {
  src: string
  alt: string
  credit: string | null
}

/** Sergi girişi: ilk ekran. */
export function ExhibitHero({ monument: d, name, lead, sourceRef, people, seal, notice, quest, onOpenBook, onOpenPhotos,
  bookRef, photosRef, photo, photoCount, openDialog }: {
  monument: Pick<MonumentDetail, 'monument_id' | 'type' | 'district' | 'city' | 'facts'>
  name: string
  lead: MonumentFact | null
  sourceRef: (f: MonumentFact) => string
  people: PersonCard[]
  seal?: ReactNode
  /** Ziyaret notu (ibadet mekânı/türbe kuralları): ziyaret ve oyun eylemlerinden önce (CLAUDE.md §5). */
  notice?: { text: string; turkishOnly: boolean } | null
  /** Bilgi görevi adresi; oyun bu kullanıcıya kapalıysa yok. */
  quest: string | null
  onOpenBook: () => void
  onOpenPhotos: () => void
  bookRef: Ref<HTMLButtonElement>
  photosRef: Ref<HTMLButtonElement>
  photo: ExhibitPhoto | null
  photoCount: number
  /** Açık pencere (düğmelerin aria-expanded durumu). */
  openDialog?: 'book' | 'photos' | null
}) {
  const { t, lang } = useLang()
  const intro = lead ? factIn(lead, lang) : null
  const founder = people.find((p) => p.role === 'bani') ?? people[0]
  const place = [d.district, d.city].filter(Boolean).join(', ')
  const facts: [string, string][] = [
    ...(founder ? [[t(founder.role_label), founder.name] as [string, string]] : []),
    [t('Tür'), typeLabel(d.type)],
    ...(place ? [[t('Konum'), place] as [string, string]] : []),
  ]
  const count = d.facts.length
  const cityQ = encodeURIComponent(citySlug(d.city))
  const typeHref = `/eserler?sehir=${cityQ}&tur=${encodeURIComponent(d.type)}`
  return (
    <section className="vk-exh" aria-labelledby="vk-exh-title">
      <div className="vk-exh__inner">
        <div className="vk-exh__text">
          <div className="vk-exh__top">
            <nav className="vk-crumbs" aria-label={t('Koleksiyon yolu')}>
              <ol>
                <li><Link to={`/eserler?sehir=${cityQ}`}>{d.city}</Link></li>
                <li><Link to="/eserler">{t('Tarihî Eserler')}</Link></li>
                <li><Link to={typeHref}>{typeLabel(d.type)}</Link></li>
              </ol>
            </nav>
            {seal}
          </div>
          <h1 id="vk-exh-title" className="vk-exh__title" lang={lang === 'tr' ? 'tr' : undefined}>{name}</h1>
          {intro?.text && (
            <>
              <p className="vk-exh__lead" lang={intro.turkishOnly ? 'tr' : undefined}>{intro.text}</p>
              <p className="vk-exh__cite">
                <Certainty value={lead!.certainty} />
                {t('Kaynak:')} {sourceRef(lead!)}
              </p>
            </>
          )}
          <dl className="vk-exh__facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {notice?.text && (
            <aside className="vk-exh__notice" aria-label={t('Ziyaret uyarısı')}>
              <strong>{t('Ziyaret ederken')}</strong>{' '}
              <span lang={notice.turkishOnly ? 'tr' : undefined}>{notice.text}</span>
            </aside>
          )}
          <div className="vk-exh__actions">
            {quest && <Link to={quest} className="vk-exh__quest">{t('Bilgi Görevine Başla')}</Link>}
            <Link to={`/harita?eser=${encodeURIComponent(d.monument_id)}`} className="vk-exh__map"><MapIcon />{t('Haritada Gör')}</Link>
          </div>
        </div>

        {/* Sergi nişi: iki arşiv nesnesi. Her biri gerçek bir pencere açar (süs düğme yok). */}
        <div className="vk-niche" role="group" aria-label={t('Arşiv')}>
          <div className="vk-niche__shelf">
            <div className="vk-obj">
              <button ref={bookRef} type="button" className="vk-obj__btn vk-obj__btn--book" aria-haspopup="dialog" onClick={onOpenBook}
                aria-expanded={openDialog === 'book'} disabled={count === 0}>
                <span className="vk-tome" aria-hidden="true">
                  <span className="vk-tome__frame"><Semse /></span>
                </span>
                <span className="vk-obj__name">{t('Tarih Defteri')}</span>
                <span className="vk-obj__desc">{count ? t('{n} onaylı tarihî kayıt', { n: count }) : t('Bu eser için henüz onaylı kayıt yok.')}</span>
                {count > 0 && <span className="vk-obj__go">{t('Defteri aç')}</span>}
              </button>
            </div>
            <div className="vk-obj">
              {photo ? (
                <>
                  <button ref={photosRef} type="button" className="vk-obj__btn vk-obj__btn--photo" aria-haspopup="dialog" onClick={onOpenPhotos}
                    aria-expanded={openDialog === 'photos'}>
                    <span className="vk-archframe"><img src={photo.src} alt={photo.alt} loading="eager" decoding="async" /></span>
                    <span className="vk-obj__name">{t('Fotoğraf Arşivi')}</span>
                    <span className="vk-obj__desc">{t('{n} lisanslı fotoğraf', { n: photoCount })}</span>
                    <span className="vk-obj__go">{t('Arşivi aç')}</span>
                  </button>
                  {photo.credit && <p className="vk-obj__credit">{photo.credit}</p>}
                </>
              ) : (
                <div className="vk-obj__btn vk-obj__btn--empty">
                  <span className="vk-archframe vk-archframe--empty" aria-hidden="true" />
                  <span className="vk-obj__name">{t('Fotoğraf Arşivi')}</span>
                  <span className="vk-obj__desc">{t('Bu eser için henüz yayımlanmış fotoğraf yok.')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Öne çıkanlar: 2–3 onaylı kayıt, kısa göndermeyle; bütün kayıtlar Tarih Defteri'nde. */
export function ExhibitHighlights({ facts, total, sourceRef, onOpenBook, headingId }: {
  facts: MonumentFact[]; total: number; sourceRef: (f: MonumentFact) => string; onOpenBook: () => void; headingId: string
}) {
  const { t, lang } = useLang()
  if (!facts.length) return null
  return (
    <section className="vk-hl" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('Bu eserde öne çıkanlar')}</h2>
      <ul>
        {facts.map((f) => {
          const l = factIn(f, lang)
          return (
            <li key={f.fact_id} lang={l.turkishOnly ? 'tr' : undefined}>
              <h3>{l.title}</h3>
              <p>{l.text}</p>
              <p className="vk-hl__ref"><Certainty value={f.certainty} />{sourceRef(f)}</p>
            </li>
          )
        })}
      </ul>
      {total > facts.length && (
        <button type="button" className="vk-hl__all" aria-haspopup="dialog" onClick={onOpenBook}>
          {t('Tüm tarihî kayıtları incele ({n})', { n: total })}
        </button>
      )}
    </section>
  )
}

/** Ayrıntılı künye (açılabilir) ve kaynak yayınlar (sayfada kitap adının tek geçtiği yer). */
export function ExhibitRecord({ monument: d, people, sourceRef, titles, numbered, headingId }: {
  monument: Pick<MonumentDetail, 'alternative_names' | 'address' | 'facts' | 'images'> &
    Partial<Pick<MonumentDetail, 'alternative_names_en' | 'address_en'>>
  people: (PersonCard & { fact?: MonumentFact })[]
  sourceRef: (f: MonumentFact) => string
  titles: string[]
  numbered: boolean
  headingId: string
}) {
  const { t, lang } = useLang()
  const rows: { k: string; v: ReactNode }[] = [
    ...people.map((p) => ({
      k: t(p.role_label),
      v: <>{p.name} <Certainty value={p.certainty} />{p.fact && <span className="vk-rec__ref">{sourceRef(p.fact)}</span>}</>,
    })),
    ...(altNamesIn(d, lang).length ? [{ k: t('Diğer adları'), v: altNamesIn(d, lang).join(', ') }] : []),
    ...(d.address ? [{ k: t('Adres'), v: addressIn(d, lang) }] : []),
    { k: t('Onaylı kayıt'), v: String(d.facts.length) },
    { k: t('Fotoğraf'), v: String(d.images.length) },
  ]
  return (
    <section className="vk-rec" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('Künye ve kaynaklar')}</h2>
      <details className="vk-rec__more">
        <summary>{t('Ayrıntılı künye')}</summary>
        <dl>
          {rows.map(({ k, v }) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </details>
      {titles.length > 0 ? (
        <div className="vk-rec__src">
          <p className="vk-rec__src-h">{titles.length > 1 ? t('Kaynak yayınlar') : t('Kaynak yayın')}</p>
          <ol>
            {titles.map((title, i) => <li key={title}>{numbered && <span>[{i + 1}] </span>}{title}</li>)}
          </ol>
          <p className="vk-rec__note">{t('Sayfa numaraları her bilginin yanında; bütün kayıtlar, alıntı ve kesinlik bilgisiyle Tarih Defteri’nde.')}</p>
        </div>
      ) : <p className="vk-rec__note">{t('Bu eser için henüz onaylı kaynak kaydı yok.')}</p>}
    </section>
  )
}
