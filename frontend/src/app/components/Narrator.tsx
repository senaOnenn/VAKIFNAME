import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { askGuide, getGuideAvailability, preparePhoto, type GuideImage, type GuideTurn } from '../../catalog/guideClient'
import type { AskFact, GuidePhoto, GuideResult } from '../../catalog/types'
import type { MonumentDetail } from '../api'
import { MS_PER_WEIGHT, mouthAt, mouthFrom, visemes, type Mouth } from '../lipsync'
import { nameOf } from '../contentLang'
import { buildScript, LOCAL_GUIDE } from '../narration'
import { smallTalk, type SmallTalk } from '../smallTalk'
import { useLang } from '../i18n'
import { useNarration } from '../speech'
import { FIGURE_LIP_SYNC, FIGURE_VOICE, GuideFigure } from './GuideFigure'
import './narrator.css'

const RATES = [0.85, 1, 1.15]

/** R6.14: rehbere dışarıdan iletilen istek (ana sayfadaki rehber bölümü); `id` her istekte artar. */
export interface GuideRequest {
  id: number
  question?: string
  photo?: File
}

interface Turn {
  question: string
  /** API'ye gitmeyen yerel karşılık (gündelik mesaj; rehber kapalıyken tarihî soru); tarihî iddia içermez. */
  local?: SmallTalk | 'off'
  /** Soruyla gönderilen fotoğrafın önizlemesi (yalnızca bu sayfada; saklanmaz). */
  photo?: string
  /** R6.12: "Tekrar dene" aynı fotoğrafı (onaylanmış hâliyle) yeniden gönderir; yalnızca bu bileşenin belleğinde. */
  image?: { image: GuideImage; previewUrl: string }
  result?: GuideResult
  error?: string
}
/** Rehber sunucusunun durumu: soruluyor, hazır, kapalı (sunucu söyledi) ya da ulaşılamıyor (ağ/zaman aşımı). */
type Availability = 'checking' | 'ready' | 'off' | 'unreachable'
/** Uzun bekleyişte gösterilen ek bilgi (sunucu en geç `deadline_s` içinde cevaplar; arayüz sonsuza dek beklemez). */
const SLOW_MS = 12_000
/** Seçilen dosya için tarayıcı tarafı ön denetim (sunucu yine kendi denetimini yapar: tür, boyut, yüz, üst veri). */
// HEIC/HEIF: Safari çözüp JPEG'e yeniden kodlar; çözemeyen tarayıcıda "işlenemedi" denir (sunucuya ham HEIC gitmez).
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const RAW_MAX_MB = 25 // küçültmeden önce: daha büyüğü tarayıcıda işlenmeye çalışılmaz
const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4)

/** Kamera/görsel simgesi (süs; düğmenin adı görünür metindir). */
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.6" />
    </svg>
  )
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Eserin karakter anlatımı (Faz 4, Faz 8). Rehber karakteri çerçevesiz olarak sayfada belirir; sesli (tarayıcı
 * seslendirmesi) ve altyazılı anlatır, ağzı konuşmayla senkron oynar (`lipsync.ts`); ses otomatik başlamaz. Kullanıcı
 * rehbere yazabilir. Her tarihî cümle onaylı kayda bağlıdır; anlatım bir canlandırmadır.
 */
export function Narrator({
  monument,
  onListened,
  onAsked,
  initialTab = 'listen',
  requestTab,
  active = true,
  titleHidden = false,
}: {
  monument: Pick<MonumentDetail, 'monument_id' | 'name' | 'name_en' | 'facts'>
  onListened?: () => void
  onAsked?: () => void
  /** R3.9: açılıştaki sekme (rehber paneli sohbetle açılır). */
  initialTab?: 'listen' | 'ask'
  /** Dışarıdan sekme isteği (R6.7: görev ekranındaki "Hikâyeyi dinle"); `n` her istekte artar. */
  requestTab?: { tab: 'listen' | 'ask'; n: number } | null
  /** R3.9: görünmüyorken (panel kapalı) anlatım duraklar; arka planda ses çalmaz. */
  active?: boolean
  /** R3.9: başlık yalnızca ekran okuyucuya (panelin kendi başlığı var). */
  titleHidden?: boolean
}) {
  const id = useId()
  const { t, locale, lang } = useLang()
  // İngilizce anlatım yalnızca onaylı İngilizce kayıtlardan; eserde hiç yoksa Türkçe anlatım çalar ve bu söylenir.
  const scriptLang = lang === 'en' && monument.facts.some((f) => f.text_en) ? 'en' : 'tr'
  const lines = useMemo(() => buildScript(monument, 6, scriptLang), [monument, scriptLang])
  const n = useNarration(lines, { onDone: onListened, monumentId: monument.monument_id, lang: scriptLang, voiceProfile: FIGURE_VOICE })
  const [large, setLarge] = useState(false)
  const [mouth, setMouth] = useState<Mouth>('X')
  const line = lines[n.index]
  const speaking = n.state === 'playing'
  const seqs = useMemo(() => lines.map((l) => visemes(l.spoken)), [lines])
  const cue = n.cue
  const playing = n.audio
  // Anlatım ve soru-cevap iki sekmede: eser önce gelir, soru sorma ikinci adımdır. İki panel de bağlı kalır (anlatımın
  // yeri ve sohbet geçmişi korunur); anlatım çalarken soru sekmesine geçilirse ses duraklar (altyazısız ses çalmasın).
  const [tab, setTab] = useState<'listen' | 'ask'>(initialTab)
  useEffect(() => {
    if (requestTab) setTab(requestTab.tab)
  }, [requestTab])
  const tabRefs = useRef<Record<'listen' | 'ask', HTMLButtonElement | null>>({ listen: null, ask: null })
  const TABS = [{ key: 'listen', label: t('Anlatım') }, { key: 'ask', label: t('Rehberle Konuş') }] as const
  useEffect(() => {
    if (!active && speaking) n.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  function choose(next: 'listen' | 'ask', focus = false) {
    if (next === 'ask' && speaking) n.pause()
    setTab(next)
    if (focus) tabRefs.current[next]?.focus()
  }
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const keys: Record<string, 'listen' | 'ask'> = {
      ArrowRight: tab === 'listen' ? 'ask' : 'listen', ArrowLeft: tab === 'listen' ? 'ask' : 'listen', Home: 'listen', End: 'ask',
    }
    const next = keys[e.key]
    if (!next) return
    e.preventDefault()
    choose(next, true)
  }

  // Ağız senkronu: konuşmanın anlık konumundan (kelime sınırı + geçen süre) ağız şekli; hareket azaltılmışsa durağan.
  // Çizim ağız şekli gösteremiyorsa (R3.3 portresi, varyant yok) hiç hesaplanmaz; ses ve altyazı bundan bağımsızdır.
  useEffect(() => {
    if (!FIGURE_LIP_SYNC || !speaking || reducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setMouth('X')
      return
    }
    let raf = 0
    const tick = () => {
      const a = playing.current
      const c = cue.current
      // Sunucu sesi: oynatma anı / süre; tarayıcı sesi: son kelime sınırı + geçen süre.
      const m = a && seqs[a.i] && a.el.duration > 0 && !a.el.paused
        ? mouthAt(seqs[a.i], a.el.currentTime / a.el.duration)
        : c && seqs[c.i] ? mouthFrom(seqs[c.i], c.char, performance.now() - c.at, MS_PER_WEIGHT / n.rate) : 'X'
      setMouth((prev) => (prev === m ? prev : m))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speaking, seqs, cue, playing, n.rate])

  return (
    <section className="vk-narr" aria-labelledby={`${id}-h`}>
      <div className="vk-narr__head">
        <h2 id={`${id}-h`} className={titleHidden ? 'vk-sr-only' : undefined}>{t('Eserin hikâyesi')}</h2>
        <div className="vk-narr__tabs" role="tablist" aria-label={t('Anlatım ve sorular')}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`${id}-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              className="vk-narr__tab"
              onClick={() => choose(key)}
              onKeyDown={onTabKey}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="vk-narr__panel" role="tabpanel" id={`${id}-panel-listen`} aria-labelledby={`${id}-tab-listen`} hidden={tab !== 'listen'}>
      <div className="vk-narr__scene">
        <div className={`vk-narr__char${speaking ? ' is-speaking' : ''}`}>
          <GuideFigure mouth={mouth} speaking={speaking} />
        </div>
        <div className="vk-narr__talk">
          <div className="vk-narr__who">
            <h3>{t(LOCAL_GUIDE.name)}</h3>
            <span>{t(LOCAL_GUIDE.role)}</span>
          </div>
      <div className={`vk-narr__sub${large ? ' vk-narr__sub--large' : ''}`} aria-live={speaking ? 'off' : 'polite'}>
        <p className="vk-narr__line" lang={scriptLang !== lang ? scriptLang : undefined}>{line.text}</p>
        {line.source && (
          <p className="vk-narr__src">
            {line.certainty && line.certainty !== 'documented' && (
              <span className="vk-cert vk-cert--uncertain">{line.certainty === 'reported' ? t('Rivayet') : t('Kesin değil')}</span>
            )}
            {t('Kaynak:')} {line.source}
          </p>
        )}
        <p className="vk-narr__pos" aria-hidden="true">{n.index + 1} / {lines.length}</p>
      </div>
        </div>
      </div>

      <div className="vk-narr__controls" role="group" aria-label={t('Anlatım denetimleri')}>
        <button type="button" className="vk-narr__btn" onClick={() => n.goTo(n.index - 1)} disabled={n.index === 0} aria-label={t('Önceki cümle')}>‹</button>
        {speaking ? (
          <button type="button" className="vk-btn" onClick={n.pause}>{t('Duraklat')}</button>
        ) : (
          <button type="button" className="vk-btn" onClick={n.play}>
            {n.state === 'idle' ? t('Dinle') : n.state === 'done' ? t('Baştan dinle') : t('Devam et')}
          </button>
        )}
        <button type="button" className="vk-narr__btn" onClick={() => n.goTo(n.index + 1)} disabled={n.index >= lines.length - 1} aria-label={t('Sonraki cümle')}>›</button>
        <label className="vk-narr__opt">
          {t('Hız')}
          <select value={n.rate} onChange={(e) => n.setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>{r.toLocaleString(locale)}×</option>
            ))}
          </select>
        </label>
        <label className="vk-narr__opt">
          <input type="checkbox" checked={n.muted} onChange={(e) => n.setMuted(e.target.checked)} /> {t('Sessiz (yalnızca altyazı)')}
        </label>
        <label className="vk-narr__opt">
          <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} /> {t('Büyük altyazı')}
        </label>
      </div>
      {scriptLang !== lang && (
        <p className="vk-narr__note">{t('Bu eserin İngilizce anlatımı henüz onaylanmadı; anlatım Türkçe.')}</p>
      )}
      {!n.hasVoice && !n.muted && (
        <p className="vk-narr__note">
          {scriptLang === 'en'
            ? t('Tarayıcında İngilizce ses bulunamadı; anlatım altyazıyla ilerler.')
            : t('Tarayıcında Türkçe ses bulunamadı; anlatım altyazıyla ilerler.')}
        </p>
      )}
      {/* Tek canlı bölge, her zaman bağlı (içerik değişince ekran okuyucu duyurur): cümlenin sesi yok / anlatım bitti. */}
      <div role="status" className="vk-narr__live">
        {n.lineSilent && n.hasVoice && <p className="vk-narr__note">{t('Bu cümlenin sesi şu anda yok; altyazıyla ilerliyor.')}</p>}
        {n.state === 'done' && <p className="vk-narr__done">{t('Anlatımı dinledin. ✓')}</p>}
      </div>

      <details className="vk-narr__transcript">
        <summary>{t('Anlatımın tam metni')}</summary>
        <ol>
          {lines.map((l, i) => (
            <li key={i} lang={scriptLang !== lang ? scriptLang : undefined}>
              {l.text}
              {l.source && <small> — {l.source}</small>}
            </li>
          ))}
        </ol>
      </details>
      </div>

      <div className="vk-narr__panel" role="tabpanel" id={`${id}-panel-ask`} aria-labelledby={`${id}-tab-ask`} hidden={tab !== 'ask'}>
        <GuideTalk monument={monument} onAsked={onAsked} />
      </div>
    </section>
  )
}

/**
 * Rehberle Konuş (R3.2): yerel rehberle konuşma alanı. İki mod: "Sohbet et" (gündelik mesajlara yerel, tarihî iddiasız
 * karşılık) ve "Kaynaklara sor" (yalnızca tarihî sorular). İki modda da tarihî soru aynı kaynaklı hattan geçer: her cümle
 * onaylı kayda bağlıdır, kaynak yoksa tahmin edilmez. Rehber bir canlandırmadır; tarihî kişiler adına konuşulmaz (K4).
 * Tek `GuideChat`: mod değişince konuşma geçmişi korunur. Fotoğraflı soru burada sunulmaz (görsel model ve yüz denetimi
 * doğrulanmadı; R5).
 * "Canlı Vasiyet" adı bu bölüme verilmez: o ad `docs/CANLI_VASIYET.md`'deki editör onaylı özel tarihî anlatıma aittir (ayrı aşama).
 */
function GuideTalk({ monument, onAsked }: {
  monument: Pick<MonumentDetail, 'monument_id' | 'name' | 'name_en'>
  onAsked?: () => void
}) {
  const id = useId()
  const { t, lang } = useLang()
  const [mode, setMode] = useState<'chat' | 'sources'>('chat')
  const MODES = [
    { key: 'chat', label: t('Sohbet et'), hint: t('Selamlaş, rehberle konuş; tarihî sorular yine kaynaklı cevaplanır.') },
    { key: 'sources', label: t('Kaynaklara sor'), hint: t('Yalnızca eserle ilgili tarihî sorular; her cümle onaylı kayda dayanır.') },
  ] as const
  return (
    <div className="vk-talk">
      <div className="vk-talk__head">
        <h3 id={`${id}-h`}>{t('Rehberle Konuş')}</h3>
        <p className="vk-talk__label">{t('Yerel rehberle sohbet · canlandırma')}</p>
      </div>
      <p className="vk-talk__rules">
        {t('Rehber kurgusal bir yerel rehberdir; tarihî kişiler adına konuşmaz. Tarihî bilgiler yalnızca onaylı kayıtlardan, kaynağıyla verilir; kayıtlarda olmayan bilgi tahmin edilmez.')}
      </p>
      <fieldset className="vk-talk__modes">
        <legend className="vk-sr-only">{t('Konuşma modu')}</legend>
        {MODES.map(({ key, label, hint }) => (
          <label key={key} className="vk-talk__mode">
            {/* Ad yalnızca mod adı; açıklama ayrı okunur (aynı metin ad ve açıklamada iki kez okunmasın). */}
            <input type="radio" name={`${id}-mode`} value={key} checked={mode === key} onChange={() => setMode(key)}
              aria-labelledby={`${id}-${key}-name`} aria-describedby={`${id}-${key}-hint`} />
            <span className="vk-talk__mode-name" id={`${id}-${key}-name`}>{label}</span>
            <span className="vk-talk__mode-hint" id={`${id}-${key}-hint`}>{hint}</span>
          </label>
        ))}
      </fieldset>
      {/* R5.3: fotoğrafla soru, yalnızca sunucu hazır derse (yüz denetimi + görsel sağlayıcı) görünür; iki modda da kaynaklı hat. */}
      <GuideChat monumentId={monument.monument_id} onAsked={onAsked} mode={mode} hideHeading monumentName={nameOf(monument, lang)} allowPhoto />
    </div>
  )
}

/**
 * Rehberle yazışma. `monumentId` yoksa soru bütün onaylı katalogda aranır (Rehber sayfası). `allowPhoto`: fotoğrafla soru
 * (ziyaretçi fotoğrafta yüz, kişisel bilgi veya gizli belge olmadığını onaylar; fotoğraf saklanmaz, bkz. guide_routes.py).
 * `initial`: ana sayfadan gelen soru (rehber açıksa bir kez gönderilir) ya da seçilmiş fotoğraf.
 * `mode` (Rehberle Konuş): `chat` gündelik mesajlara yerel, tarihî iddiasız karşılık verir; `sources` gündelik mesajda
 * mod ipucu verir. İki modda da diğer her mesaj aynı kaynaklı hattan (`/guide/ask`) geçer. `mode` yoksa davranış eskisi gibi.
 */
export function GuideChat({ monumentId, onAsked, placeholder = 'Örn. Bu eseri kim yaptırdı?', allowPhoto = false, initial, mode,
  hideHeading = false, monumentName, request, onRequestDone }: {
  monumentId: string | null; onAsked?: () => void; placeholder?: string; allowPhoto?: boolean
  initial?: { question?: string; photo?: File }
  mode?: 'chat' | 'sources'; hideHeading?: boolean; monumentName?: string
  /** R6.14: başka bir yerden (ana sayfadaki rehber bölümü) gelen istek. Numarası başına bir kez işlenir; soru bu sohbetin
   * kendi gönderme yolundan geçer (selamlaşma yerelde, tarihî soru kaynaklı hatta), fotoğraf önizlemeye konur. */
  request?: GuideRequest | null
  /** İstek işlendi (sağlayıcı bekleyen isteği siler; sayfa geçişinde tekrar gönderilmez). */
  onRequestDone?: (id: number) => void
}) {
  const id = useId()
  const { t, lang } = useLang()
  // R6.10: durum ne olursa olsun yazma kutusu kullanılabilir; selamlaşma her zaman yerelde cevaplanır.
  const [avail, setAvail] = useState<Availability>('checking')
  const enabled = avail === 'ready' ? true : avail === 'off' ? false : null
  const [slow, setSlow] = useState(false)
  const pending = useRef<AbortController | null>(null)
  // R5.3: sunucu fotoğrafa hazır mı (yerel yüz denetimi + görsel sağlayıcı). Bilinmiyor ya da kapalıysa fotoğraf yok.
  const [photoReady, setPhotoReady] = useState(false)
  const [maxImageMb, setMaxImageMb] = useState(6)
  const [q, setQ] = useState(initial?.question ?? '')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<{ image: GuideImage; previewUrl: string } | null>(null)
  const [consent, setConsent] = useState(false)
  const [photoNote, setPhotoNote] = useState('')
  const autoAsked = useRef(false)

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setPhotoNote('')
    setConsent(false)
    setPhoto(null)
    if (file.type && !PHOTO_TYPES.includes(file.type)) {
      setPhotoNote(t('Bu dosya türü desteklenmiyor. JPEG, PNG ya da WebP bir fotoğraf seç.'))
      return
    }
    if (file.size > RAW_MAX_MB * 1024 * 1024) {
      setPhotoNote(t('Dosya çok büyük (en çok {n} MB). Daha küçük bir fotoğraf seç.', { n: RAW_MAX_MB }))
      return
    }
    try {
      const prepared = await preparePhoto(file)
      // Tarayıcı fotoğrafı küçültüp yeniden kodlar; yine de sunucu sınırını aşıyorsa gönderilmez.
      if (base64Bytes(prepared.image.data) > maxImageMb * 1024 * 1024) {
        setPhotoNote(t('Dosya çok büyük (en çok {n} MB). Daha küçük bir fotoğraf seç.', { n: maxImageMb }))
        return
      }
      setPhoto(prepared)
    } catch {
      setPhotoNote(t('Fotoğraf işlenemedi. Başka bir JPEG, PNG ya da WebP fotoğraf dene.'))
    }
  }
  const canPhoto = allowPhoto && enabled === true && photoReady
  // Ana sayfadan gelen fotoğraf yalnızca sunucu fotoğrafa hazırsa hazırlanır; değilse hiç işlenmez ve gönderilmez.
  const initialPhotoDone = useRef(false)
  useEffect(() => {
    if (!allowPhoto || !initial?.photo || enabled === null || initialPhotoDone.current) return
    initialPhotoDone.current = true
    if (canPhoto) void pickPhoto(initial.photo)
    else setPhotoNote(t('Fotoğraf analizi şu anda kapalı; sorunu metinle sorabilirsin.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, photoReady])

  const [check, setCheck] = useState(0)
  // Yeni mesaj eklenince son tur görünür alana getirilir (panelde yalnızca konuşma kayar, yazma kutusu altta kalır).
  const logRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const last = logRef.current?.lastElementChild as HTMLElement | null | undefined
    if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'nearest' })
  }, [turns])
  useEffect(() => {
    const ctl = new AbortController()
    setAvail('checking')
    getGuideAvailability(ctl.signal).then(
      (a) => {
        setPhotoReady(a.enabled && a.photo === true)
        if (typeof a.max_image_mb === 'number' && a.max_image_mb > 0) setMaxImageMb(a.max_image_mb)
        setAvail(a.enabled ? 'ready' : 'off')
      },
      () => !ctl.signal.aborted && setAvail('unreachable'),
    )
    return () => ctl.abort()
  }, [check])
  // Bileşen kalkınca bekleyen soru iptal edilir (yarım kalan istek sonsuz "bekleniyor" bırakmaz).
  useEffect(() => () => pending.current?.abort(), [])

  // Ana sayfadan gelen soru: rehber açıksa bir kez kendiliğinden gönderilir; kapalıysa kutuda kalır.
  useEffect(() => {
    if (enabled && initial?.question && !initial.photo && !autoAsked.current) {
      autoAsked.current = true
      void ask(initial.question.trim(), null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  function send(e: FormEvent) {
    e.preventDefault()
    const question = q.trim() || (photo ? t('Bu fotoğraftaki yapı hangisi?') : '')
    if (!question || busy) return
    if (photo && !consent) {
      setPhotoNote(t('Fotoğrafı göndermek için onay kutusunu işaretle.'))
      return
    }
    submit(question, photo)
  }
  // R6.10: tamamen gündelik mesaj ("Selam", "Teşekkürler") hiçbir sayfada API'ye gitmez: kaynak taranmaz, model
  // çağrılmaz; tarihî iddia içermeyen yerel karşılık gösterilir (CLAUDE.md §4). Tarihî soru kaynaklı hattan geçer.
  function submit(question: string, withPhoto: typeof photo) {
    const kind = !withPhoto ? smallTalk(question) : null
    if (kind || avail === 'off') {
      setQ('')
      setTurns((ts) => [...ts, { question, local: kind ?? 'off' }])
      return
    }
    void ask(question, withPhoto)
  }

  // R6.14: dışarıdan gelen istek. Rehberin durumu belli olunca ve önceki soru bitince, numarası başına yalnızca bir kez
  // işlenir (yeniden çizim, panelin kapanıp açılması veya sayfa geçişi aynı soruyu ikinci kez göndermez).
  const handled = useRef(0)
  useEffect(() => {
    if (!request || request.id <= handled.current || avail === 'checking' || busy) return
    handled.current = request.id
    onRequestDone?.(request.id)
    const question = request.question?.trim() ?? ''
    if (request.photo) {
      // Fotoğraf onay gerektirir: önizlemeye konur, soru kutuya yazılır; ziyaretçi onaylayıp gönderir.
      if (question) setQ(question)
      if (canPhoto) void pickPhoto(request.photo)
      else setPhotoNote(t('Fotoğraf analizi şu anda kapalı; sorunu metinle sorabilirsin.'))
      return
    }
    if (question) submit(question, null)
    // Odak panelin yazma kutusuna geçer: ziyaretçi sohbete buradan devam eder (panel açıldığında içerik henüz yüklenmemiş
    // olabildiği için çerçeve odağı başlıkta bırakmıştı).
    document.getElementById(`${id}-q`)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, avail, busy])

  const LOCAL_REPLY: Record<SmallTalk | 'off', string> = monumentName ? {
    greeting: t('Merhaba! Ben bu eserin yerel rehberiyim; bir canlandırmayım. {name} hakkında merak ettiğini sorabilirsin. Tarihî bilgileri yalnızca onaylı kaynaklardan aktarırım.', { name: monumentName }),
    how: t('İyiyim, teşekkür ederim. {name} hakkında ne öğrenmek istersin? Örneğin kimin yaptırdığını ya da yapının özelliklerini sorabilirsin.', { name: monumentName }),
    who: t('Ben VAKIFNAME’nin yerel rehberiyim; bir canlandırmayım, tarihî bir kişi değilim. {name} hakkındaki sorularını onaylı kayıtlardan cevaplarım; kayıtlarda olmayan bilgiyi tahmin etmem.', { name: monumentName }),
    thanks: t('Rica ederim! Başka bir sorun olursa buradayım.'),
    bye: t('Görüşmek üzere! Eseri yerinde ziyaret edersen ziyaret uyarılarına dikkat etmeyi unutma.'),
    off: t('Tarihî soruları şu anda cevaplayamıyorum; rehber kapalı. Eserin kaynaklı kayıtlarını Tarih Defteri’nde okuyabilirsin.'),
  } : {
    greeting: t('Merhaba! Ben VAKIFNAME’nin yerel rehberiyim; bir canlandırmayım. Vakıf eserleri hakkında merak ettiğini sorabilirsin. Tarihî bilgileri yalnızca onaylı kaynaklardan aktarırım.'),
    how: t('İyiyim, teşekkür ederim. Hangi eseri merak ediyorsun? Örneğin bir yapıyı kimin yaptırdığını sorabilirsin.'),
    who: t('Ben VAKIFNAME’nin yerel rehberiyim; bir canlandırmayım, tarihî bir kişi değilim. Eserlerle ilgili sorularını onaylı kayıtlardan cevaplarım; kayıtlarda olmayan bilgiyi tahmin etmem.'),
    thanks: t('Rica ederim! Başka bir sorun olursa buradayım.'),
    bye: t('Görüşmek üzere! Bir eseri yerinde ziyaret edersen ziyaret uyarılarına dikkat etmeyi unutma.'),
    off: t('Tarihî soruları şu anda cevaplayamıyorum; rehber kapalı. Eserlerin kaynaklı kayıtlarını eser sayfalarındaki Tarih Defteri’nde okuyabilirsin.'),
  }
  const modePlaceholder = mode === 'chat' ? t('Selam ver ya da eser hakkında bir şey sor…') : t(placeholder)

  async function ask(question: string, withPhoto: { image: GuideImage; previewUrl: string } | null, retry = false) {
    setQ('')
    setPhoto(null)
    setConsent(false)
    setPhotoNote('')
    setBusy(true)
    setSlow(false)
    const history: GuideTurn[] = turns
      .filter((t) => t.result)
      .slice(-3)
      .map((t) => ({ question: t.question, answer: t.result!.sentences.map((s) => s.text).join(' ') || t.result!.message }))
    // Tekrar denemede başarısız tur yerinde yenilenir (aynı soru iki kez listelenmez).
    setTurns((ts) => (retry ? ts.slice(0, -1) : ts).concat({ question, photo: withPhoto?.previewUrl, image: withPhoto ?? undefined }))
    const ctl = new AbortController()
    pending.current = ctl
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS)
    try {
      const image = withPhoto && canPhoto ? { ...withPhoto.image, consent: true as const } : null
      const result = await askGuide(question, monumentId, history, image, ctl.signal, lang)
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, result } : t)))
      setAvail('ready')
      onAsked?.()
    } catch (err) {
      if (ctl.signal.aborted) return // durduruldu (tur `stop` içinde işaretlendi) ya da bileşen kapandı
      const kind = err instanceof ApiError ? err.kind : null
      const message = kind === 'network' ? t('Rehbere ulaşılamadı. Bağlantını kontrol edip tekrar dene.')
        : kind === 'timeout' ? t('Rehber zamanında cevap veremedi. Biraz sonra tekrar dene.')
          : err instanceof Error ? err.message : t('Rehber şu anda yanıt veremiyor.')
      if (kind === 'network') setAvail('unreachable')
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: message } : t)))
    } finally {
      clearTimeout(slowTimer)
      if (pending.current === ctl) {
        pending.current = null
        setBusy(false)
        setSlow(false)
      }
    }
  }
  function stop() {
    const ctl = pending.current
    if (!ctl) return
    pending.current = null
    // Durdurulan tur hata olarak kalır; "Tekrar dene" aynı soruyu yeniden gönderir.
    const message = t('Soruyu durdurdun.')
    setTurns((ts) => ts.map((x, i) => (i === ts.length - 1 && !x.result ? { ...x, error: message } : x)))
    setBusy(false)
    setSlow(false)
    ctl.abort()
  }

  return (
    <div className="vk-chat">
      {!hideHeading && (
        <>
          <h3 id={`${id}-h`}>{monumentId ? t('Bu eser hakkında soru sor') : t('Kaynaklara soru sor')}</h3>
          <p className="vk-chat__intro">
            {t('Cevaplar yalnızca onaylı tarihî kayıtlardan derlenir; her cevabın kaynağı altında gösterilir. Kayıtlarda olmayan bilgi tahmin edilmez.')}
          </p>
        </>
      )}
      {avail === 'off' && <p className="vk-narr__note">{t('Soru sorma şu anda kullanılamıyor. Anlatımı dinleyebilir ve kaynakları okuyabilirsin.')}</p>}
      {avail === 'unreachable' && (
        <p className="vk-narr__note vk-chat__offline" role="status">
          {t('Rehbere şu anda ulaşılamıyor. Selamlaşabilirsin; tarihî sorular bağlantı gelince cevaplanır.')}{' '}
          <button type="button" className="vk-link-btn" onClick={() => setCheck((n) => n + 1)}>{t('Bağlantıyı yeniden dene')}</button>
        </p>
      )}
      <ol ref={logRef} className="vk-chat__log" aria-live="polite" {...(hideHeading ? { 'aria-label': t('Konuşma') } : { 'aria-labelledby': `${id}-h` })}>
        {turns.map((turn, i) => (
          <li key={i} className="vk-chat__turn">
            <p className="vk-chat__q">
              {turn.photo && <img className="vk-chat__thumb" src={turn.photo} alt={t('Gönderilen fotoğraf')} />}
              {turn.question}
            </p>
            {turn.local ? (
              <div className="vk-chat__a vk-chat__a--local">
                <p className="vk-chat__who">{t('Rehber · canlandırma')}</p>
                <p>{LOCAL_REPLY[turn.local]}</p>
              </div>
            ) : (
              <>
                {!turn.result && !turn.error && (
                  <div className="vk-chat__a vk-chat__a--wait">
                    <p>{turn.photo ? t('Fotoğraf inceleniyor; gizlilik denetimi ve kaynak eşleştirmesi yapılıyor…') : t('Kaynaklar taranıyor…')}</p>
                    {slow && <p className="vk-chat__slow">{t('Cevap biraz uzun sürüyor; en geç bir dakika içinde sonuçlanır.')}</p>}
                    <button type="button" className="vk-link-btn" onClick={stop}>{t('Durdur')}</button>
                  </div>
                )}
                {turn.error && (
                  <div className="vk-chat__a vk-chat__a--err" role="alert">
                    <p>{turn.error}</p>
                    {i === turns.length - 1 && !busy && (
                      <button type="button" className="vk-link-btn" onClick={() => void ask(turn.question, turn.image ?? null, true)}>{t('Tekrar dene')}</button>
                    )}
                  </div>
                )}
                {turn.result && <Answer r={turn.result} labelled={!!mode} />}
              </>
            )}
          </li>
        ))}
      </ol>
      {(
        <form className="vk-chat__form" onSubmit={send}>
          <label htmlFor={`${id}-q`} className="vk-sr-only">{t('Sorunu yaz')}</label>
          <input
            id={`${id}-q`}
            value={q}
            maxLength={500}
            onChange={(e) => setQ(e.target.value)}
            placeholder={modePlaceholder}
            readOnly={busy}
            aria-busy={busy || undefined}
          />
          <button type="submit" className="vk-btn" disabled={busy || (!q.trim() && !photo)}>{t('Sor')}</button>
          {allowPhoto && !canPhoto && photoNote && <p className="vk-chat__photo-off" role="status">{photoNote}</p>}
          {canPhoto && (
            <div className="vk-chat__photo">
              {photo ? (
                <figure className="vk-chat__preview">
                  <img src={photo.previewUrl} alt={t('Seçilen fotoğraf')} />
                  <figcaption>
                    <label className="vk-chat__consent">
                      <input type="checkbox" checked={consent} onChange={(e) => (setConsent(e.target.checked), setPhotoNote(''))} />
                      {t('Fotoğrafta yüz, kişisel bilgi veya gizli belge yok; göndermeyi onaylıyorum. Fotoğraf saklanmaz.')}
                    </label>
                    <button type="button" className="vk-link-btn" onClick={() => (setPhoto(null), setConsent(false))}>{t('Fotoğrafı kaldır')}</button>
                  </figcaption>
                </figure>
              ) : (
                <label className="vk-chat__pick">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="vk-sr-only"
                    disabled={busy}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => (void pickPhoto(e.target.files?.[0]), (e.target.value = ''))}
                  />
                  <CameraIcon /> {t('Fotoğraf ekle')}
                </label>
              )}
              {photoNote && <p className="vk-chat__a--err" role="alert">{photoNote}</p>}
            </div>
          )}
        </form>
      )}
    </div>
  )
}

/** Onaylı, kaynak bağlantısı olan kayıt mı (kaynaklı aramanın cevabı da yalnızca böyleyse gösterilir)? */
function isSourcedFact(a: unknown): a is AskFact {
  if (!a || typeof a !== 'object') return false
  const f = a as Partial<AskFact>
  return typeof f.fact_id === 'string' && typeof f.title === 'string' && typeof f.text === 'string'
    && Array.isArray(f.sources) && f.sources.some((s) => typeof s?.url === 'string' && s.url.startsWith('https://'))
}

/** Her kaydın kesinlik etiketi ve kaynak bağlantıları (yalnızca https; yeni sekmede). */
function References({ facts }: { facts: AskFact[] }) {
  const { t } = useLang()
  const hid = useId()
  return (
    <div className="vk-chat__refs-wrap">
      <p className="vk-chat__refs-h" id={hid}>{t('Kaynaklar')}</p>
      <ul className="vk-chat__refs" aria-labelledby={hid}>
        {facts.map((f) => (
          <li key={f.fact_id} className="vk-chat__ref">
            <span className="vk-chat__ref-title">{f.title}</span>
            <span className="vk-chat__ref-meta">
              {f.certainty_label && <span className={`vk-chat__cert vk-chat__cert--${f.certainty}`}>{f.certainty_label}</span>}
              {f.sources.filter((s) => s.url.startsWith('https://')).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.publisher || s.title}</a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * R5.3: fotoğraf bir esere güvenle eşleşmedi ya da analiz edilemedi. Sunucunun dürüst mesajı ve (varsa) önerdiği
 * katalog eserleri gösterilir; bunlar tarihî iddia değil, eser sayfasına bağlantıdır. Başarılı analiz gibi gösterilmez.
 */
function PhotoOutcome({ r, observed }: { r: GuideResult; observed: boolean }) {
  const { t } = useLang()
  const routed = useInRouterContext()
  const href = (id: string) => `/eser/${encodeURIComponent(id)}`
  const link = (o: { monument_id: string; name: string }) =>
    routed ? <Link to={href(o.monument_id)}>{o.name}</Link> : <a href={href(o.monument_id)}>{o.name}</a>
  const named = r.options ?? []
  const manual = (r.manual_options ?? []).filter((o) => !named.some((n) => n.monument_id === o.monument_id))
  return (
    // Betimleme varsa eşleşmeme ikincil bilgidir (betimlemenin ardından, daha sakin); yoksa ana mesajdır.
    <div className={`vk-chat__a vk-chat__a--note${observed ? ' vk-chat__a--secondary' : ''}`}>
      <p>{r.message}</p>
      {r.status === 'photo_not_matched' && named.length > 0 && (
        <>
          <p className="vk-chat__src">{t('Sorduğun eser fotoğrafla güvenle eşleşmedi; eser sayfasından karşılaştırabilirsin:')}</p>
          <ul className="vk-chat__options">
            {named.map((o) => <li key={o.monument_id}>{link(o)}</li>)}
          </ul>
        </>
      )}
      {r.status === 'photo_not_matched' && manual.length > 0 && (
        // Tarafsız katalog listesi: fotoğrafın adayı değildir, ziyaretçi eseri kendisi seçmek isterse.
        <details className="vk-chat__manual">
          <summary>{t('Eseri kendin seçmek istersen')}</summary>
          <ul className="vk-chat__options">
            {manual.map((o) => <li key={o.monument_id}>{link(o)}</li>)}
          </ul>
        </details>
      )}
      <p className="vk-chat__src">{t('Başka bir fotoğraf deneyebilir ya da sorunu fotoğrafsız yazabilirsin.')}</p>
    </div>
  )
}

/**
 * R5.7: "Fotoğrafta görülenler" — görsel modelin, sunucu denetiminden geçmiş betimlemesi. Tarihî kaynak değildir; kaynaklı
 * cevaptan ayrı ve önce gösterilir. Gözlem boşsa ya da tamamen elendiyse (observed: false) hiç gösterilmez.
 */
function PhotoObservation({ p }: { p: GuidePhoto }) {
  const { t } = useLang()
  const id = useId()
  if (!(p.observed ?? Boolean(p.description || p.features.length))) return null
  return (
    <section className="vk-chat__seen" aria-labelledby={id}>
      <h4 id={id}>{t('Fotoğrafta görülenler')}</h4>
      <p className="vk-chat__seen-note">{t('Yapay zekânın fotoğraftan görsel yorumu; onaylı tarihî kaynak değildir.')}</p>
      {p.description && <p>{p.description}</p>}
      {p.features.length > 0 && (
        <ul className="vk-chat__seen-tags" aria-label={t('Görülen öğeler')}>
          {p.features.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      {p.architecture_explanation && <p>{p.architecture_explanation}</p>}
      {p.material_guess && <p className="vk-chat__seen-note">{t('Malzeme izlenimi (kesin değil):')} {p.material_guess}</p>}
      {p.visible_text && <p className="vk-chat__seen-note">{t('Fotoğrafta okunan yazı:')} <q>{p.visible_text}</q></p>}
    </section>
  )
}

/** `labelled` (Rehberle Konuş): kaynaklı cevabın üstüne "Kaynaklı cevap" yazılır; yerel karşılıktan ayrışsın. */
function Answer({ r, labelled = false }: { r: GuideResult; labelled?: boolean }) {
  const { t } = useLang()
  const observed = !!r.photo && (r.photo.observed ?? Boolean(r.photo.description || r.photo.features.length))
  const seen = r.photo ? <PhotoObservation p={r.photo} /> : null
  // Fotoğraflı cevapta kaynaklı kısım her zaman etiketlenir: görsel yorumla karışmasın.
  const label = (labelled || observed) && <p className="vk-chat__who">{t('Kaynaklı cevap')}</p>
  const facts = new Map(r.facts.map((f) => [f.fact_id, f]))
  if (r.sentences.length === 0) {
    // Yapay zekâ cevap veremedi: sunucunun kaynaklı aramasında onaylı bir kayıt bulunduysa o kaydın özgün metni
    // (yapay zekâ üretimi değil) kaynaklarıyla gösterilir; bulunamadıysa sunucunun dürüst mesajı.
    const found = r.mode === 'fallback_search' && r.search?.status === 'answered' && isSourcedFact(r.search.answer)
      ? r.search.answer : null
    if (!found) {
      if (r.status === 'photo_not_matched' || r.status === 'photo_analysis_failed') {
        return <>{seen}<PhotoOutcome r={r} observed={observed} /></>
      }
      const note = r.status === 'insufficient_evidence' || r.status === 'not_found'
      return <>{seen}<p className={`vk-chat__a${note ? ' vk-chat__a--note' : ''}${observed ? ' vk-chat__a--secondary' : ''}`}>{r.message}</p></>
    }
    return (
      <>
      {seen}
      <div className="vk-chat__a">
        {label}
        <p className="vk-chat__src">{r.message}</p>
        <p className="vk-chat__found"><strong>{found.title}.</strong> {found.text}</p>
        <References facts={[found]} />
      </div>
      </>
    )
  }
  const used = [...new Set(r.sentences.flatMap((s) => s.sources))].map((sid) => facts.get(sid)).filter(Boolean) as AskFact[]
  return (
    <>
    {seen}
    <div className="vk-chat__a">
      {label}
      <p>{r.sentences.map((s) => s.text).join(' ')}</p>
      {used.length > 0 && <References facts={used} />}
      {r.mode === 'fallback_search' && <p className="vk-chat__src">{r.message}</p>}
    </div>
    </>
  )
}
