import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getGuideAvailability } from '../../catalog/guideClient'
import type { MonumentSummary } from '../api'
import type { City } from '../cities'
import { Seal } from '../components/Seal'
import { VakfiyePuzzle, type PieceState } from '../components/VakfiyePuzzle'
import { gamePath } from '../gameCity'
import { useLang } from '../i18n'
import { MonumentStrip, prefersReducedMotion, scrollToId, useEnter, useNear } from './common'
import { mapPoint } from './engine'

/**
 * Hikâyenin yedi sahnesi. Her sahne normal sayfa akışında bir bölümdür (`data-scene`); arka plan görseli sabit sahne
 * katmanındadır (StoryExperience). Metin ve düğmeler gerçek HTML'dir. Şehir adı ve sayılar katalogdan gelir (CLAUDE.md §1).
 */

export interface Pilot {
  city: City
  /** Katalogda bu şehirdeki yayımlanmış eser sayısı. */
  count: number
}

function Cue({ to, label }: { to: string; label: string }) {
  const { t } = useLang()
  return (
    <button type="button" className="vk-cue" onClick={() => scrollToId(to)} aria-label={label}>
      <span aria-hidden="true" className="vk-cue__text">{t('Kaydır')}</span>
      <span className="vk-cue__line" aria-hidden="true" />
    </button>
  )
}

const k = (n: number) => ({ ['--k' as string]: n })

/**
 * Sabitlenen bölüm (1–3. sahneler): bölüm ekrandan uzun, içindeki çerçeve ekrana yapışır. Metin görselin güvenli
 * bölgesinde durur; motorun yazdığı `--tv` ile belirir ve geçişten önce çekilir (geçiş anında ekranda metin olmaz).
 */
function Chapter({ id, n, labelledBy, children }: { id: string; n: number; labelledBy: string; children: ReactNode }) {
  return (
    <section id={id} data-scene={n} data-pin="" className={`vk-ch vk-ch--${n}`} aria-labelledby={labelledBy}>
      {/* Dokunmatik yapışma noktası (motor dinlenme anına yerleştirir) */}
      <span className="vk-snapmark" aria-hidden="true" />
      <div className="vk-ch__frame">{children}</div>
    </section>
  )
}

export function Scene1Welcome({ hasFilm, onFilm }: { hasFilm: boolean; onFilm: () => void }) {
  const { t } = useLang()
  return (
    <Chapter id="hosgeldin" n={1} labelledBy="s1-h">
      <div className="vk-ch__text vk-ch__text--1" data-content>
        <p className="vk-ch__eyebrow" style={k(0)}>{t('Vakıf Eserleri Envanter Projesi')}</p>
        <h1 id="s1-h" className="vk-ch__h1" style={k(1)}>{t('Geçmişi Keşfet, Mirası Yaşat.')}</h1>
        <p className="vk-ch__lead" style={k(2)}>{t('Yüzyılların izini sür, vakıf eserlerinin hikâyelerini keşfet.')}</p>
        <div className="vk-s__ctas" style={k(3)}>
          <a href="#yolculuk" className="vk-btn vk-s__cta" onClick={(e) => (e.preventDefault(), scrollToId('yolculuk'))}>
            {t('Keşfe Başla')} <span className="vk-s__arrow" aria-hidden="true">↓</span>
          </a>
          {hasFilm && (
            <button type="button" className="vk-s__ghost" onClick={onFilm}>
              <span aria-hidden="true">▶</span> {t('Tanıtım filmini izle')}
            </button>
          )}
        </div>
      </div>
      <div className="vk-ch__cue" style={k(4)}>
        <Cue to="yolculuk" label={t('Yolculuğa kaydır')} />
      </div>
    </Chapter>
  )
}

export function Scene2Journey() {
  const { t } = useLang()
  return (
    <Chapter id="yolculuk" n={2} labelledBy="s2-h">
      <div className="vk-ch__text vk-ch__text--2" data-content>
        <p className="vk-ch__eyebrow" style={k(0)}>{t('Yolculuk')}</p>
        <h2 id="s2-h" className="vk-ch__h2" tabIndex={-1} data-focus-target style={k(1)}>{t('Her Yolculuk Bir Adımla Başlar')}</h2>
        <p className="vk-ch__lead" style={k(2)}>{t('Tarihî sokaklardan yüzyıllık hikâyelere uzanan bir keşif seni bekliyor.')}</p>
        <div style={k(3)}>
          <Cue to="sehirler" label={t('Haritaya kaydır')} />
        </div>
      </div>
    </Chapter>
  )
}

/** Harita üstündeki işaretler (yalnızca fare/dokunma için; klavye ve ekran okuyucu aynı seçimi lejanttan yapar). */
type Marker = { cities: City[]; x: number; y: number; east: boolean }
function markers(cities: City[]): Marker[] {
  const out: Marker[] = []
  for (const c of cities) {
    const p = mapPoint(c.lng, c.lat)
    // Birbirine çok yakın "yakında" şehirler tek etikette toplanır (İzmir ile Manisa bu ölçekte üst üste biner).
    const near = out.find((m) => !c.open && !m.cities[0].open && Math.hypot(m.x - p.x, (m.y - p.y) * 0.5625) < 3)
    if (near) near.cities.push(c)
    else out.push({ cities: [c], x: p.x, y: p.y, east: c.lng > 34 })
  }
  return out
}

export function Scene3Map({ cities, pilot }: { cities: City[]; pilot: Pilot }) {
  const { t } = useLang()
  const [note, setNote] = useState('')
  const [chosen, setChosen] = useState(false)
  const choose = (c: City) => {
    if (!c.open) {
      setNote(t('{city} yakında VAKIFNAME’de. Şimdilik keşfe {open} ile başla.', { city: c.name, open: pilot.city.name }))
      return
    }
    setNote('')
    setChosen(true)
    window.setTimeout(() => scrollToId('sehir'), prefersReducedMotion() ? 0 : 450)
  }
  const label = (c: City) => (c.open ? (pilot.count ? t('{n} Eser Aktif', { n: pilot.count }) : t('Aktif')) : t('Yakında'))
  const open = cities.filter((c) => c.open)
  const soon = cities.filter((c) => !c.open)
  return (
    <Chapter id="sehirler" n={3} labelledBy="s3-h">
      <div className="vk-ch__text vk-ch__text--3">
        <p className="vk-ch__eyebrow" style={k(0)}>{t('Türkiye')}</p>
        <h2 id="s3-h" className="vk-ch__h2" tabIndex={-1} data-focus-target style={k(1)}>
          {t('Keşif {from} Başlıyor', { from: pilot.city.ablative, city: pilot.city.name })}
        </h2>
        <p className="vk-ch__lead" style={k(2)}>{t('Anadolu’nun kültürel mirasını keşfetmeye ilk adımını at.')}</p>
      </div>

      {/* Harita görseliyle aynı kutuda (sabit sahne katmanı), gerçek koordinattan yerleşen işaretler. */}
      {/* Ekran boyutunda kırpan kap: görsel boyutundaki işaret katmanı sayfayı yana taşırmasın. */}
      <div className="vk-mapclip" aria-hidden="true">
      <div className="vk-map" data-box="2">
        <div className="vk-map__cam" data-cam="2">
          {markers(cities).map((m) => {
            const isOpen = m.cities[0].open
            return (
              <button
                key={m.cities.map((c) => c.slug).join('-')}
                type="button"
                tabIndex={-1}
                // Etiket yönü: açık şehir üstte, toplu etiket altta, diğerleri sağda (dar haritada çakışmasın).
                className={`vk-mark vk-mark--${isOpen ? 'top' : m.cities.length > 1 ? 'bottom' : m.east ? 'left' : 'right'}${isOpen ? ' vk-mark--open' : ''}${isOpen && chosen ? ' is-chosen' : ''}`}
                style={{ left: `${m.x}%`, top: `${m.y}%` }}
                onClick={() => choose(m.cities[0])}
              >
                <span className="vk-mark__dot" />
                <span className="vk-mark__label">
                  <strong>{m.cities.map((c) => c.name).join(' · ')}</strong>
                  <span>{label(m.cities[0])}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      </div>

      {/* Şehir seçimi (klavye ve ekran okuyucu bunu kullanır; telefonda haritanın altında sade bir panel) */}
      <div className="vk-cities" style={k(3)}>
        <ul aria-label={t('Şehirler')}>
          {[...open, ...soon].map((c) => (
            <li key={c.slug} className={c.open ? 'is-open' : undefined}>
              <button type="button" className={`vk-chipcity${c.open ? ' vk-chipcity--open' : ''}`} onClick={() => choose(c)}>
                <span className="vk-chipcity__name">{c.name}</span>
                <span className="vk-chipcity__note">{label(c)}</span>
                {c.open && <span className="vk-chipcity__go" aria-hidden="true">→</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="vk-map__note" role="status">{note}</p>
      </div>
    </Chapter>
  )
}

const PinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
)

export function Scene4City({ pilot }: { pilot: Pilot }) {
  const { t } = useLang()
  const vars = { gen: pilot.city.genitive, city: pilot.city.name }
  return (
    <Chapter id="sehir" n={4} labelledBy="s4-h">
      <div className="vk-ch__text vk-ch__text--4" data-content>
        <p className="vk-ch__place" style={k(0)}>
          <PinIcon /> {pilot.city.name}
        </p>
        <h2 id="s4-h" className="vk-ch__h2" tabIndex={-1} data-focus-target style={k(1)}>{t('{gen} Vakıf Mirasını Keşfet', vars)}</h2>
        {/* "Osmanlı'nın ilk başkenti" gibi tarihî bir iddia onaylı katalogda kaynaklı kayıt olmadan yazılmaz (CLAUDE.md §4). */}
        <p className="vk-ch__lead" style={k(2)}>{t('{gen} yüzyıllık izini, envanterde belgelenmiş eserleriyle sür.', vars)}</p>
        <div className="vk-ch__row" style={k(3)}>
          {pilot.count > 0 && (
            <p className="vk-stat">
              <strong>{pilot.count}</strong> <span>{t('Tarihî Eser')}</span>
            </p>
          )}
          <a href="#eserler" className="vk-btn vk-s__cta" onClick={(e) => (e.preventDefault(), scrollToId('eserler'))}>
            {t('Eserleri Keşfet')} <span className="vk-s__arrow" aria-hidden="true">↓</span>
          </a>
        </div>
      </div>
    </Chapter>
  )
}

export function Scene5Monuments({ pilot, monuments, loading, error, reload }: {
  pilot: Pilot; monuments: MonumentSummary[]; loading: boolean; error: string | null; reload: () => void
}) {
  const { t } = useLang()
  const enter = useEnter()
  const ref = useRef<HTMLDivElement>(null)
  const near = useNear(ref)
  return (
    <Chapter id="eserler" n={5} labelledBy="s5-h">
      <div ref={ref} className="vk-ch__cards" data-content>
        <div className="vk-ch__cardshead">
          <div className="vk-ch__text vk-ch__text--5">
            <p className="vk-ch__eyebrow" style={k(0)}>{t('Keşfet')}</p>
            <h2 id="s5-h" className="vk-ch__h2" tabIndex={-1} data-focus-target style={k(1)}>{t('Her Eser Bir Hikâye Taşır')}</h2>
            <p className="vk-ch__lead" style={k(2)}>{t('{gen} vakıf mirasını yakından tanı.', { gen: pilot.city.genitive, city: pilot.city.name })}</p>
          </div>
          <a href="/eserler" className="vk-btn vk-btn--ghost vk-s__ghostbtn vk-ch__all" style={k(2.5)} onClick={(e) => (e.preventDefault(), enter('/eserler'))}>
            {t('Tüm Eserleri Gör')}
          </a>
        </div>
        {loading && monuments.length === 0 && <p className="vk-s__state" role="status">{t('Eserler yükleniyor…')}</p>}
        {error && (
          <p className="vk-s__state vk-s__state--error" role="alert">
            {t('Eserler yüklenemedi:')} {error} <button type="button" className="vk-link-btn" onClick={reload}>{t('Tekrar dene')}</button>
          </p>
        )}
        {monuments.length > 0 && <MonumentStrip monuments={monuments} near={near} timeline />}
      </div>
    </Chapter>
  )
}

/** Rehbere örnek soru: yalnızca kutuyu doldurur (gönderim ziyaretçinin). Tarihî bir iddia değildir. */
const SUGGESTIONS = ['Bu eseri kim yaptırdı?', 'Bir külliyede hangi yapılar bulunur?', 'Vakfiye nedir?']

/**
 * Rehber sahnesi: gerçek bir sohbetin nasıl başladığı. Soru ve fotoğraf Rehber sayfasına taşınır (aynı `/guide/ask`
 * hattı; fotoğraf göndermeden önce orada açık onay istenir). Rehber kapalıysa girişler kapalıdır ve bu açıkça yazılır.
 */
export function Scene6Guide() {
  const { t } = useLang()
  const enter = useEnter()
  const ref = useRef<HTMLDivElement>(null)
  const near = useNear(ref)
  const id = useId()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!near) return
    const ctl = new AbortController()
    getGuideAvailability(ctl.signal).then((a) => setEnabled(a.enabled), () => setEnabled(false))
    return () => ctl.abort()
  }, [near])
  function ask(e: FormEvent) {
    e.preventDefault()
    if (q.trim()) enter('/rehber', { question: q.trim() })
  }
  const pick = (question?: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) enter('/rehber', question ? { photo: file, question } : { photo: file })
  }
  const off = enabled === false
  return (
    <Chapter id="rehber-tanitim" n={6} labelledBy="s6-h">
      <div ref={ref} className="vk-ch__text vk-ch__text--6" data-content>
        <p className="vk-ch__eyebrow" style={k(0)}>{t('Yapay zekâ rehber')}</p>
        <h2 id="s6-h" className="vk-ch__h2" style={k(1)}>{t('Tarihin Merak Ettiklerini Anlatsın')}</h2>
        <p className="vk-ch__lead" style={k(2)}>{t('Sorularını sor, mimari detayları keşfet, geçmişi kaynaklarla öğren.')}</p>
        <div className="vk-guide" style={k(3)}>
          <p className={`vk-guide__status${off ? ' is-off' : enabled ? ' is-on' : ''}`} role="status">
            <span className="vk-guide__dot" aria-hidden="true" />
            {enabled === null ? t('Rehberin durumu denetleniyor…') : off ? t('Rehber şu anda kapalı; soru gönderilemez.') : t('Rehber açık')}
          </p>
          <form className="vk-guide__ask" onSubmit={ask}>
            <label htmlFor={`${id}-q`} className="vk-guide__label">{t('Metinle Sor')}</label>
            <div className="vk-guide__row">
              <input id={`${id}-q`} value={q} maxLength={500} onChange={(e) => setQ(e.target.value)} placeholder={t('Örn. Bir külliyede hangi yapılar bulunur?')} disabled={off} />
              <button type="submit" className="vk-btn" disabled={off || !q.trim()}>{t('Sor')}</button>
            </div>
            <div className="vk-guide__chips" aria-label={t('Örnek sorular')} role="group">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="vk-guide__chip" disabled={off} onClick={() => setQ(t(s))}>{t(s)}</button>
              ))}
            </div>
          </form>
          <div className="vk-guide__tools">
            <label className={`vk-guide__tool${off ? ' is-disabled' : ''}`}>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick()} disabled={off} className="vk-sr-only" />
              <strong>{t('Fotoğraf Ekle')}</strong>
              <span>{t('Eserin fotoğrafını seç; rehber katalogdaki eserlerle eşleştirmeye çalışır.')}</span>
            </label>
            <label className={`vk-guide__tool${off ? ' is-disabled' : ''}`}>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick(t('Bu fotoğraftaki yapının mimari ayrıntılarını anlatır mısın?'))} disabled={off} className="vk-sr-only" />
              <strong>{t('Mimariyi Analiz Et')}</strong>
              <span>{t('Kubbe, kapı, kitabe gibi ayrıntıları sor; kaynakta yoksa “bulamadım” der.')}</span>
            </label>
          </div>
          <p className="vk-guide__fine">{t('Cevaplar yalnızca onaylı kayıtlardan gelir ve dayandığı kaydı gösterir. Fotoğraf saklanmaz; göndermeden önce onayın istenir.')}</p>
        </div>
        <div className="vk-s__ctas" style={k(4)}>
          <a href="/rehber" className="vk-btn vk-s__cta" onClick={(e) => (e.preventDefault(), enter('/rehber'))}>{t('AI Rehberi Aç')}</a>
        </div>
      </div>
    </Chapter>
  )
}

// Örnek yapboz (gerçek ilerleme değildir; "Örnek görünüm" diye yazılır): birkaç parça bulunmuş, biri ziyaretle altın.
const SAMPLE: PieceState[] = ['found', 'gold', 'missing', 'found', 'missing', 'missing', 'found', 'missing', 'missing', 'missing']

export function Scene7Game({ pilot }: { pilot: Pilot }) {
  const { t } = useLang()
  const enter = useEnter()
  const go = (to: string) => (e: { preventDefault: () => void }) => (e.preventDefault(), enter(to))
  return (
    <Chapter id="oyun-tanitim" n={7} labelledBy="s7-h">
      <div className="vk-ch__text vk-ch__text--7" data-content>
        <p className="vk-ch__eyebrow" style={k(0)}>{t('Oyun')}</p>
        <h2 id="s7-h" className="vk-ch__h2" style={k(1)}>{t('Keşfet. Çöz. Mirası Tamamla.')}</h2>
        <p className="vk-ch__lead" style={k(2)}>{t('Görevleri tamamla, kayıp vakfiye parçalarını bul ve keşif rozetlerini kazan.')}</p>
        <div className="vk-quest">
          <section className="vk-quest__card vk-quest__card--vakfiye" style={k(3)} aria-labelledby="q-vakfiye">
            <h3 id="q-vakfiye">{t('Kayıp Vakfiye')}</h3>
            <VakfiyePuzzle pieces={SAMPLE} labels={SAMPLE.map((_, n) => t('Örnek parça {n}', { n: n + 1 }))} />
            <p>
              {pilot.count > 0 && t('{n} eser, {n} parça.', { n: pilot.count }) + ' '}
              {t('Her bilgi mührü vakfiyenin bir parçasını yerine oturtur; eseri ziyaret edince parça altınlaşır.')}
            </p>
            <p className="vk-quest__sample">{t('Örnek görünüm')}</p>
          </section>
          <section className="vk-quest__card" style={k(3.6)} aria-labelledby="q-muhur">
            <h3 id="q-muhur">{t('Mühürler ve rozetler')}</h3>
            <p className="vk-quest__seal">
              <Seal kind="knowledge" label={t('Bilgi mührü')} size={46} />
              <span><strong>{t('Bilgi mührü')}</strong> {t('“Rozeti Al”: 5 kısa sorudan en az 4 doğru.')}</span>
            </p>
            <p className="vk-quest__seal">
              <Seal kind="gold" label={t('Altın mühür')} size={46} />
              <span><strong>{t('Altın mühür')}</strong> {t('Eseri yerinde ziyaret edince bilgi mührün altına dönüşür.')}</span>
            </p>
          </section>
          <section className="vk-quest__card" style={k(4.2)} aria-labelledby="q-rota">
            <h3 id="q-rota">{t('Tarihî Rotalar')}</h3>
            <p>{t('En yakın açık eserden başla; her bilgi mührü rotada yeni bir eserin kilidini açar.')}</p>
          </section>
        </div>
        <div className="vk-s__ctas" style={k(4.8)}>
          <a href="/oyun" className="vk-btn vk-s__cta" onClick={go('/oyun')}>{t('Maceraya Başla')}</a>
          <a href={gamePath.route(pilot.city.slug)} className="vk-btn vk-btn--ghost vk-s__ghostbtn" onClick={go(gamePath.route(pilot.city.slug))}>
            {t('Rotaları Keşfet')}
          </a>
        </div>
      </div>
    </Chapter>
  )
}

/** Final: sahnenin sonu, slogan ve uygulamaya geçiş (son görsel arkada kalır). */
export function StoryFinal() {
  const { t } = useLang()
  const enter = useEnter()
  return (
    <div className="vk-final">
      <p className="vk-final__slogan vk-rv">{t('Geçmişi Keşfet, Mirası Yaşat.')}</p>
      <div className="vk-s__ctas vk-s__ctas--center vk-rv" style={{ ['--i' as string]: 1 }}>
        <a href="/eserler" className="vk-btn vk-s__cta" onClick={(e) => (e.preventDefault(), enter('/eserler'))}>{t('Uygulamaya geç')}</a>
        <Link to="/giris" className="vk-btn vk-btn--ghost vk-s__ghostbtn">{t('Giriş yap veya hesap aç')}</Link>
      </div>
      <p className="vk-final__foot"><Link to="/gizlilik">{t('Aydınlatma metni')}</Link></p>
    </div>
  )
}
