import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { getGuideAvailability } from '../../catalog/guideClient'
import type { MonumentSummary } from '../api'
import type { City } from '../cities'
import { useGuide } from '../components/GuideWidget'
import { Seal } from '../components/Seal'
import { gamePath } from '../gameCity'
import { useLang } from '../i18n'
import { MonumentStrip, prefersReducedMotion, scrollToId, useEnter, useNear } from './common'
import { mapPoint } from './engine'

/**
 * Hikâyenin altı sahnesi. Her sahne normal sayfa akışında bir bölümdür (`data-scene`); arka plan görseli sabit sahne
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
 * Sabitlenen bölüm (1–2. sahneler): bölüm ekrandan uzun, içindeki çerçeve ekrana yapışır. Metin görselin güvenli
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
          <a href="#sehirler" className="vk-btn vk-s__cta" onClick={(e) => (e.preventDefault(), scrollToId('sehirler'))}>
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
        <Cue to="sehirler" label={t('Haritaya kaydır')} />
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

export function Scene2Map({ cities, pilot }: { cities: City[]; pilot: Pilot }) {
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
    <Chapter id="sehirler" n={2} labelledBy="s2-h">
      <div className="vk-ch__text vk-ch__text--2">
        <p className="vk-ch__eyebrow" style={k(0)}>{t('Türkiye')}</p>
        <h2 id="s2-h" className="vk-ch__h2" tabIndex={-1} data-focus-target style={k(1)}>
          {t('Keşif {from} Başlıyor', { from: pilot.city.ablative, city: pilot.city.name })}
        </h2>
        <p className="vk-ch__lead" style={k(2)}>{t('Anadolu’nun kültürel mirasını keşfetmeye ilk adımını at.')}</p>
      </div>

      {/* Harita görseliyle aynı kutuda (sabit sahne katmanı), gerçek koordinattan yerleşen işaretler. */}
      {/* Ekran boyutunda kırpan kap: görsel boyutundaki işaret katmanı sayfayı yana taşırmasın. */}
      <div className="vk-mapclip" aria-hidden="true">
      <div className="vk-map" data-box="1">
        <div className="vk-map__cam" data-cam="1">
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

export function Scene3City({ pilot }: { pilot: Pilot }) {
  const { t } = useLang()
  const vars = { gen: pilot.city.genitive, city: pilot.city.name }
  return (
    <Chapter id="sehir" n={3} labelledBy="s3-h">
      <div className="vk-ch__text vk-ch__text--3" data-content>
        <p className="vk-ch__place" style={k(0)}>
          <PinIcon /> {pilot.city.name}
        </p>
        <h2 id="s3-h" className="vk-ch__h2" tabIndex={-1} data-focus-target style={k(1)}>{t('{gen} Vakıf Mirasını Keşfet', vars)}</h2>
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

export function Scene4Monuments({ pilot, monuments, loading, error, reload }: {
  pilot: Pilot; monuments: MonumentSummary[]; loading: boolean; error: string | null; reload: () => void
}) {
  const { t } = useLang()
  const enter = useEnter()
  const ref = useRef<HTMLDivElement>(null)
  const near = useNear(ref)
  return (
    <Chapter id="eserler" n={4} labelledBy="s4-h">
      <div ref={ref} className="vk-ch__cards" data-content>
        <div className="vk-ch__cardshead">
          <div className="vk-ch__text vk-ch__text--4">
            <p className="vk-ch__eyebrow" style={k(0)}>{t('Keşfet')}</p>
            <h2 id="s4-h" className="vk-ch__h2" tabIndex={-1} data-focus-target style={k(1)}>{t('Her Eser Bir Hikâye Taşır')}</h2>
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
 * R3.13 Rehber sahnesi: tek soru yolu. Bir soru alanı (yalnızca sunucu `photo: true` derse içinde fotoğraf ekleme) ve
 * "Sor"; en çok üç hazır soru (yalnızca kutuyu doldurur, gönderim ziyaretçinin). Soru ve fotoğraf Rehber sayfasına
 * taşınır (aynı `/guide/ask` hattı; fotoğraf göndermeden önce orada önizleme ve açık onay istenir). Rehber kapalıysa
 * girişler kapalıdır ve bu açıkça yazılır; fotoğraf analizi kapalıysa fotoğraf seçeneği yoktur ve bu söylenir.
 */
export function Scene5Guide() {
  const { t } = useLang()
  const ref = useRef<HTMLDivElement>(null)
  const near = useNear(ref)
  const id = useId()
  const [status, setStatus] = useState<{ enabled: boolean; photo: boolean } | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!near) return
    const ctl = new AbortController()
    getGuideAvailability(ctl.signal).then(
      (a) => setStatus({ enabled: a.enabled, photo: a.enabled && a.photo === true }),
      () => setStatus({ enabled: false, photo: false }),
    )
    return () => ctl.abort()
  }, [near])
  // R6.14: soru (ve fotoğraf) sayfa değiştirmeden sağ alttaki "Rehbere Sor" panelinde açılır; soru panelin sohbetinde
  // bir kez gönderilir. Aktarım anında giriş alanı boşalır: ikinci tıklama ya da Enter aynı soruyu yeniden göndermez.
  const guide = useGuide()
  function ask(e: FormEvent) {
    e.preventDefault()
    const question = q.trim()
    if (!question) return
    guide.ask({ question })
    setQ('')
  }
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file && status?.photo) {
      guide.ask({ photo: file, question: q.trim() || undefined })
      setQ('')
    }
  }
  const off = status?.enabled === false
  const checking = status === null
  return (
    <Chapter id="rehber-tanitim" n={5} labelledBy="s5-h">
      <div ref={ref} className="vk-ch__text vk-ch__text--5" data-content>
        <p className="vk-ch__eyebrow" style={k(0)}>{t('Yapay zekâ rehber')}</p>
        <h2 id="s5-h" className="vk-ch__h2" style={k(1)}>{t('Tarihin Merak Ettiklerini Anlatsın')}</h2>
        <p className="vk-ch__lead" style={k(2)}>{t('Sorularını sor, mimari detayları keşfet, geçmişi kaynaklarla öğren.')}</p>
        <form className="vk-ask" style={k(3)} onSubmit={ask}>
          <label htmlFor={`${id}-q`} className="vk-sr-only">{t('Sorunu yaz')}</label>
          <div className={`vk-ask__field${off ? ' is-off' : ''}`}>
            <input id={`${id}-q`} value={q} maxLength={500} onChange={(e) => setQ(e.target.value)}
              placeholder={t('Örn. Bir külliyede hangi yapılar bulunur?')} disabled={off || checking} />
            {status?.photo && (
              <label className="vk-ask__photo" title={t('Fotoğraf ekle')}>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="vk-sr-only" />
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
                </svg>
                <span className="vk-sr-only">{t('Fotoğraf ekle')}</span>
              </label>
            )}
            <button type="submit" className="vk-ask__send" disabled={off || checking || !q.trim()}>{t('Sor')}</button>
          </div>
          <div className="vk-ask__chips" role="group" aria-label={t('Örnek sorular')}>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="vk-ask__chip" disabled={off || checking} onClick={() => setQ(t(s))}>{t(s)}</button>
            ))}
          </div>
          <p className="vk-ask__fine" role="status">
            {checking
              ? t('Rehberin durumu denetleniyor…')
              : off
                ? t('Rehber şu anda kapalı; soru gönderilemez.')
                : status?.photo
                  ? t('Cevaplar yalnızca onaylı kayıtlardan gelir ve dayandığı kaydı gösterir. Fotoğraf saklanmaz; göndermeden önce onayın istenir.')
                  : t('Cevaplar yalnızca onaylı kayıtlardan gelir ve dayandığı kaydı gösterir. Fotoğrafla soru şu anda kapalı.')}
          </p>
        </form>
      </div>
    </Chapter>
  )
}

// Sayılar yazıyla (başlık dili sakin ve editoryal kalsın); daha büyük sayılarda rakam.
const WORDS = {
  tr: ['Sıfır', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz', 'On', 'On bir', 'On iki'],
  en: ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'],
}

/**
 * R6.1 Oyun tanıtımı: "Kayıp Vakfiyenin İzinde". Arşiv odasının görseli (vakfiye parçaları, mühürler) sahnenin asıl
 * öğesidir; solda yalnızca etiket, başlık, kısa açıklama ve iki eylem durur. Parça sayısı katalogdaki eser sayısından
 * gelir (oyunda her eser bir parçadır; `GET /route` → `total`). "Oyun Nasıl Oynanır?" kısa bir pencere açar (yerel
 * `<dialog>`): sunucudaki kurallar aynen anlatılır, yeni kural yoktur.
 */
export function Scene6Game({ pilot }: { pilot: Pilot }) {
  const { t, lang } = useLang()
  const enter = useEnter()
  const id = useId()
  const dlg = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [howOpen, setHowOpen] = useState(false)
  const go = (to: string) => (e: { preventDefault: () => void }) => (e.preventDefault(), enter(to))
  const n = pilot.count
  const word = n > 0 ? (WORDS[lang === 'en' ? 'en' : 'tr'][n] ?? String(n)) : ''
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    if (howOpen && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!howOpen && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [howOpen])
  const close = () => {
    setHowOpen(false)
    opener.current?.focus({ preventScroll: true })
  }
  return (
    <Chapter id="oyun-tanitim" n={6} labelledBy="s6-h">
      <div className="vk-ch__text vk-ch__text--6" data-content>
        <p className="vk-ch__eyebrow" style={k(0)}>VAKIFNAME · {t('Kayıp Vakfiye')}</p>
        <h2 id="s6-h" className="vk-ch__h2 vk-game6__h" style={k(1)}>{t('Kayıp Vakfiyenin İzinde')}</h2>
        <p className="vk-ch__lead" style={k(2)}>
          {word && t('{n} tarihî eser. {n} kayıp parça.', { n: word }) + ' '}
          {t('Geçmişin izlerini takip et, vakfiyeyi yeniden bir araya getir.')}
        </p>
        <div className="vk-s__ctas" style={k(3)}>
          <a href="/oyun" className="vk-btn vk-s__cta" onClick={go('/oyun')}>{t('Maceraya Başla')}</a>
          <button ref={opener} type="button" className="vk-s__ghost" aria-haspopup="dialog" aria-expanded={howOpen}
            aria-controls={`${id}-how`} onClick={() => setHowOpen(true)}>
            {t('Oyun Nasıl Oynanır?')}
          </button>
        </div>
        <p className="vk-game6__path" style={k(3.8)}>{t('Eserleri keşfet · Mühürleri kazan · Vakfiyeyi tamamla')}</p>
      </div>

      <dialog ref={dlg} id={`${id}-how`} className="vk-howto" aria-labelledby={`${id}-how-h`} onClose={() => setHowOpen(false)}
        onCancel={(e) => (e.preventDefault(), close())}>
        <div className="vk-howto__head">
          <h3 id={`${id}-how-h`}>{t('Oyun nasıl oynanır?')}</h3>
          <button type="button" className="vk-howto__close" onClick={close}>{t('Kapat')}</button>
        </div>
        <p className="vk-howto__intro">
          {t('Vakfiyenin kayıp parçaları eserlerde saklı. Bir eser seç, bilgi görevini oyna; her bilgi mührü bir parçayı yerine oturtur.')}
        </p>
        <ol className="vk-howto__steps">
          <li>
            <span className="vk-howto__n" aria-hidden="true">I</span>
            <div>
              <strong>{t('Eseri seç')}</strong>
              <p>{t('Bursa’nın eserlerinden dilediğini seç; hepsi baştan açık. Hikâyeyi dinlemek ve rehbere sormak isteğe bağlı.')}</p>
            </div>
          </li>
          <li>
            <span className="vk-howto__n"><Seal kind="knowledge" label={t('Bilgi mührü')} size={34} /></span>
            <div>
              <strong>{t('Rozeti Al')}</strong>
              <p>{t('5 kısa sorudan en az 4’ünü doğru yanıtla: bilgi mührü senin, vakfiyenin bir parçası yerine oturur.')}</p>
            </div>
          </li>
          <li>
            <span className="vk-howto__n"><Seal kind="gold" label={t('Altın mühür')} size={34} /></span>
            <div>
              <strong>{t('Ziyaret et (bonus)')}</strong>
              <p>{t('Eseri yerinde ziyaret et; konumun doğrulanınca mührün ve parçan altına döner. Konumun kaydedilmez.')}</p>
            </div>
          </li>
        </ol>
        <p className="vk-howto__note">
          {t('Her adım XP kazandırır; aynı başarı ikinci kez sayılmaz. Bütün parçalar bulununca vakfiye tamamlanır.')}
        </p>
        <div className="vk-howto__actions">
          <a href="/oyun" className="vk-btn vk-s__cta" onClick={(e) => (close(), go('/oyun')(e))}>{t('Maceraya Başla')}</a>
          <a href={gamePath.route(pilot.city.slug)} className="vk-howto__link" onClick={(e) => (close(), go(gamePath.route(pilot.city.slug))(e))}>
            {t('{city} rotasını gör', { city: pilot.city.name })}
          </a>
        </div>
      </dialog>
    </Chapter>
  )
}
