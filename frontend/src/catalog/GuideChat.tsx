import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { Answer, errorMessage, FactCard } from './AskMonument'
import { askMonument } from './catalogClient'
import {
  askGuide,
  GENERAL_SOURCE,
  GUIDE_TIMEOUT_MS,
  type GuideImage,
  type GuideTurn,
  PHOTO_SOURCE,
  type PhotoContext,
  preparePhoto,
} from './guideClient'
import type { AskResult, GuideResult } from './types'

const MAX_QUESTION = 300
const MAX_RAW_MB = 20
const DEFAULT_PHOTO_QUESTION = 'Bu fotoğraftaki yapı hakkında ne söyleyebilirsin?'

type Photo = { image: GuideImage; previewUrl: string }
type Turn = {
  id: number
  question: string
  context: string
  photoUrl: string | null
  /** Ör. eser ziyaretçinin kendi seçimiyle, fotoğrafla eşleştirilmeden soruldu. */
  note?: string
  /** "Tekrar dene" için yalnızca bellekte tutulur (ziyaretçi bu fotoğraf için onay vermişti). */
  photo?: Photo
  /** Bu soru bir fotoğraf analizinin takibi olarak soruldu (fotoğrafın kendisi değil, analiz metni gönderildi). */
  photoContext?: PhotoContext
} & (
  | { state: 'loading'; startedAt: number }
  | { state: 'done'; result: GuideResult }
  | { state: 'error'; message: string }
  | { state: 'search-loading' }
  | { state: 'search-done'; search: AskResult }
)

function guideError(e: unknown): string {
  if (e instanceof ApiError && e.kind === 'timeout')
    return `Cevap ${GUIDE_TIMEOUT_MS / 1000} saniye içinde gelmedi. Sorunuz kota harcamamak için yeniden gönderilmedi.`
  if (e instanceof ApiError && e.status === 409) return 'Önceki sorunuz hâlâ yanıtlanıyor; lütfen o cevabı bekleyin.'
  return errorMessage(e)
}

/**
 * Bekleme göstergesi: geçen süre ve aşamaya göre açıklama. Ücretsiz modelde cevap çoğunlukla 1–6 sn, nadiren yarım
 * dakikadan uzun sürer; sunucu `deadlineS` dolunca kendiliğinden kaynaklı arama cevabı döner, ziyaretçi bunu önceden bilir.
 */
function Waiting({ startedAt, photo, deadlineS }: { startedAt: number; photo: boolean; deadlineS: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  const text =
    s < 8
      ? photo
        ? 'Fotoğrafın mimarisi inceleniyor…'
        : 'Onaylı kayıtlar aranıyor, cevap yazılıyor…'
      : s < 25
        ? 'Yapay zekâ cevabı hazırlıyor; ücretsiz hizmette bu yarım dakikayı bulabilir.'
        : `Beklenenden uzun sürüyor. En geç ${Math.max(5, deadlineS + 5 - s)} saniye içinde cevap ya da onaylı kayıtlardan arama sonucu gösterilecek.`
  return (
    <p className="ask-loading" role="status">
      <span className="ask-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{text}</span>
      <span className="guide-elapsed" aria-hidden="true">
        {s} sn
      </span>
    </p>
  )
}

/** Kalan günlük yapay zekâ hakkı (yalnızca test oturumunda gösterilir). */
function Quota({ remaining, circuitOpen }: { remaining?: number; circuitOpen?: boolean }) {
  if (remaining === undefined) return null
  if (remaining <= 0)
    return (
      <p className="notice notice--warning guide-quota" role="status">
        Bugünkü yapay zekâ kullanım sınırı doldu. Sorular yarın (UTC gece yarısı) yeniden açılana dek onaylı kayıtlarda arama
        ile cevaplanır.
      </p>
    )
  if (circuitOpen)
    return (
      <p className="notice notice--warning guide-quota" role="status">
        Yapay zekâ sağlayıcısı geçici olarak yanıt vermiyor; bir süre sorular onaylı kayıtlarda arama ile cevaplanır.
      </p>
    )
  return (
    <p className={`guide-quota${remaining <= 5 ? ' notice notice--warning' : ' guide-meta'}`} role="status">
      Bugün kalan yapay zekâ hakkı: {remaining} çağrı (fotoğraflı soru en çok 2 çağrı harcar)
      {remaining <= 5 ? '. Sınır dolunca sorular onaylı kayıtlarda arama ile cevaplanır.' : '.'}
    </p>
  )
}

const answerText = (r: GuideResult) => r.sentences.map((s) => s.text).join(' ')

const NOT_VERIFIED = 'Fotoğraftan yapının kesin kimliği doğrulanamadı.'
const EXPLAIN_MORE_QUESTION = 'Fotoğraftaki mimariyi daha ayrıntılı açıklar mısın?'

/** Sonraki mimari takip sorusu için bu fotoğraf analizinin metni (fotoğrafın kendisi gönderilmez). */
function photoContextOf(result: GuideResult): PhotoContext | undefined {
  const p = result.photo
  if (!p?.description) return undefined
  const match = p.candidates.filter((c) => c.likelihood === 'high')
  return {
    description: p.description.slice(0, 1200),
    features: p.features.slice(0, 6),
    ...(match.length === 1 ? { monument_id: match[0].monument_id } : {}),
  }
}

/**
 * Fotoğrafın Mimari Analizi: tek ana alan. Modelin doğal açıklaması, dikkat çeken özellik etiketleri ve en altta kimlik
 * notu. Kimlik bulunamaması ana sonuç değildir; tarihî bilgi burada değil, onaylı kayıtlar bölümünde gösterilir.
 */
function PhotoAnalysis({ photo }: { photo: NonNullable<GuideResult['photo']> }) {
  const match = photo.candidates.filter((c) => c.likelihood === 'high')
  return (
    <section className="guide-analysis" aria-label="Fotoğrafın Mimari Analizi">
      <h5 className="guide-analysis__title">Fotoğrafın Mimari Analizi</h5>
      <p className="guide-analysis__meta">Yapay zekânın fotoğraftan gözlemi · yanılabilir; tarihî bilgi değildir</p>
      {photo.description && <p className="guide-analysis__text">{photo.description}</p>}
      {photo.features.length > 0 && (
        <div className="guide-analysis__features">
          <h6>Dikkat Çeken Mimari Özellikler</h6>
          <ul className="guide-tags">
            {photo.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {photo.visible_text && <p className="guide-meta">Fotoğrafta okunan yazı: «{photo.visible_text}»</p>}
      {photo.synthetic_signs && photo.synthetic_signs.length > 0 && (
        <div className="guide-synthetic">
          <p className="guide-meta">
            Görselin kurgusal veya yapay zekâyla üretilmiş olabileceğine dair olası işaretler (kesin yargı değildir):
          </p>
          <ul>
            {photo.synthetic_signs.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="guide-analysis__identity">
        {match.length === 1
          ? `Kayıtlı eserlerle karşılaştırma: ${match[0].name} ile yüksek görsel benzerlik (kesin kimlik değildir).`
          : NOT_VERIFIED}
        {photo.metadata_removed.length > 0 && ' Fotoğrafın konum ve cihaz bilgileri gönderilmeden önce silindi.'}
      </p>
    </section>
  )
}

type PhotoHandlers = {
  onUploadAnother: () => void
  /** Aynı fotoğrafı ve soruyu yeniden gönderir (yalnızca ziyaretçi isterse; otomatik tekrar yok). */
  onRetry?: () => void
  /** Soruyu fotoğrafsız sormak için giriş alanına koyar; gönderme kararı ziyaretçinindir. */
  onAskWithoutPhoto: () => void
  /** Analizi derinleştiren takip sorusu (fotoğraf yeniden gönderilmez; önceki analiz bağlam olur). */
  onExplainMore?: () => void
}

/**
 * Fotoğraf sonrası seçenekler. Analiz sonrası: mimariyi daha ayrıntılı açıklama, eseri kendisi seçme (en yakın eser
 * önerilmez; seçim yalnızca tarihî sorunun bağlamıdır), başka fotoğraf. Analiz başarısızsa: tekrar dene, başka fotoğraf,
 * fotoğrafsız sor.
 */
function PhotoActions({
  result,
  onChoose,
  onUploadAnother,
  onRetry,
  onAskWithoutPhoto,
  onExplainMore,
}: { result: GuideResult; onChoose: (mid: string) => void } & PhotoHandlers) {
  const [manual, setManual] = useState(false)
  const actions = result.actions ?? []
  return (
    <div className="guide-nomatch">
      <div className="ask-options" role="group" aria-label="Ne yapmak istersiniz?">
        {actions.includes('retry_photo') && onRetry && (
          <button type="button" className="button button--light" onClick={onRetry}>
            Tekrar dene
          </button>
        )}
        {actions.includes('explain_more') && onExplainMore && (
          <button type="button" className="button button--light" onClick={onExplainMore}>
            Mimariyi daha ayrıntılı açıkla
          </button>
        )}
        {actions.includes('choose_manually') && (result.manual_options?.length ?? 0) > 0 && (
          <button type="button" className="button button--light" aria-expanded={manual} onClick={() => setManual((v) => !v)}>
            Kayıtlı eserlerden birini seç
          </button>
        )}
        {actions.includes('upload_another') && (
          <button type="button" className="button button--light" onClick={onUploadAnother}>
            Başka fotoğraf yükle
          </button>
        )}
        {actions.includes('ask_without_photo') && (
          <button type="button" className="button button--light" onClick={onAskWithoutPhoto}>
            Fotoğraf olmadan soru sor
          </button>
        )}
      </div>
      {manual && (
        <div className="guide-manual">
          <p className="guide-meta">
            Seçtiğiniz eserin onaylı kayıtlarıyla cevap verilir; bu seçim fotoğrafın o esere ait olduğu anlamına gelmez.
          </p>
          <div className="ask-options" role="group" aria-label="Kayıtlı eserler">
            {result.manual_options!.map((o) => (
              <button key={o.monument_id} type="button" className="button button--light" onClick={() => onChoose(o.monument_id)}>
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Cevap paragrafı: her cümlenin ardından dayandığı kayıtların numarası (aşağıdaki kaynak kartlarına bağlantı). */
function GuideAnswer({
  turnId,
  result,
  onPick,
  onChoose,
  onAsk,
  ...handlers
}: {
  turnId: number
  result: GuideResult
  /** Fotoğrafın güvenle benzediği eser seçildiğinde. */
  onPick: (mid: string) => void
  /** Ziyaretçi eseri kendisi seçtiğinde (fotoğrafla eşleştirilmeden). */
  onChoose: (mid: string) => void
  /** Yedek aramanın "bunu mu demek istediniz?" önerisi onaylandığında. */
  onAsk: (question: string, mid: string) => void
} & PhotoHandlers) {
  const order = result.facts.map((f) => f.fact_id)
  const followup = result.status === 'photo_followup'
  const anchor = (fid: string) => `rehber-${turnId}-${fid}`
  if (result.mode === 'fallback_search') {
    return (
      <div className="guide-reply">
        {result.photo && <PhotoAnalysis photo={result.photo} />}
        <p className="notice notice--warning">{result.message}</p>
        {result.search && <Answer result={result.search} onPick={onPick} onAsk={onAsk} />}
      </div>
    )
  }
  return (
    <div className={`guide-reply guide-reply--${result.status}`}>
      {result.photo && <PhotoAnalysis photo={result.photo} />}
      {result.sentences.length > 0 ? (
        <div className="guide-answer" aria-label={followup ? 'Mimari açıklama' : 'Yapay zekâ cevabı'}>
          {result.photo && <p className="guide-answer__section">Onaylı kayıtlardan doğrulanmış tarihî bilgi</p>}
          <p className="guide-answer__label">{result.message}</p>
          <p className="guide-answer__text">
            {result.sentences.map((s, i) => (
              <span key={i}>
                {s.text}
                {s.sources.map((src) => {
                  if (src === GENERAL_SOURCE)
                    return (
                      <span key={src} className="guide-cite guide-cite--general" title="Fotoğraftan bağımsız genel mimari bilgi">
                        genel bilgi
                      </span>
                    )
                  if (src === PHOTO_SOURCE)
                    return (
                      <span key={src} className="guide-cite guide-cite--photo" title="Fotoğraftaki görünüşe dayanır">
                        fotoğraf
                      </span>
                    )
                  const n = order.indexOf(src)
                  if (n < 0)
                    return (
                      <span key={src} className="guide-cite" title="Onaylı eser kimlik kaydı">
                        kimlik
                      </span>
                    )
                  return (
                    <a key={src} className="guide-cite" href={`#${anchor(src)}`} aria-label={`Kaynak ${n + 1}: ${src}`}>
                      {n + 1}
                    </a>
                  )
                })}{' '}
              </span>
            ))}
          </p>
          {result.missing && <p className="guide-missing">Kayıtlarda bulunmayan: {result.missing}</p>}
          {result.removed_claims > 0 && (
            <p className="guide-meta">
              Onaylı kayıtlarla doğrulanamayan {result.removed_claims} ifade cevaptan çıkarıldı.
            </p>
          )}
        </div>
      ) : (
        // Analiz gösterildiyse kimlik notu analizin altındadır; ayrıca ana mesaj olarak tekrarlanmaz.
        result.status !== 'photo_analyzed' && result.message && <p className="guide-reply__message">{result.message}</p>
      )}
      {result.facts.length > 0 && (
        <div className="guide-sources">
          <h5>Kullanılan onaylı kayıtlar ve kaynakları</h5>
          <ol>
            {result.facts.map((f) => (
              <li key={f.fact_id} id={anchor(f.fact_id)}>
                <FactCard fact={f} />
              </li>
            ))}
          </ol>
        </div>
      )}
      {result.options.length > 0 && (
        <div
          className="ask-options"
          role="group"
          aria-label={result.status === 'photo_analyzed' ? 'Sorunuzda andığınız eser' : 'Olası eserler'}
        >
          {result.options.map((o) => (
            <button
              key={o.monument_id}
              type="button"
              className="button button--light"
              onClick={() => (result.status === 'photo_analyzed' ? onChoose(o.monument_id) : onPick(o.monument_id))}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
      {(result.actions?.length ?? 0) > 0 && (
        <PhotoActions result={result} onChoose={onChoose} {...handlers} />
      )}
    </div>
  )
}

/**
 * Yapay zekâ tarih rehberi: serbest soru, isteğe bağlı fotoğraf, takip soruları. Cevap yalnızca onaylı kayıtlara
 * dayanır ve her cümlenin kaynağı gösterilir; backend kayıtlarla doğrulayamadığı ifadeleri çıkarır.
 */
export function GuideChat({
  monumentId,
  monumentName,
  suggestions,
  maxImageMb,
  photoEnabled = true,
  remainingToday,
  circuitOpen,
  deadlineS = 50,
  onAnswered,
  onLogout,
}: {
  monumentId: string
  monumentName: string
  suggestions: string[]
  maxImageMb: number
  /** Sunucuda yüz taraması hazır değilse fotoğraf eklenemez. */
  photoEnabled?: boolean
  remainingToday?: number
  circuitOpen?: boolean
  deadlineS?: number
  /** Her cevaptan sonra kalan kota yenilensin diye. */
  onAnswered?: () => void
  /** Verilirse test oturumunu kapatma düğmesi gösterilir. */
  onLogout?: () => void
}) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [consent, setConsent] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const nextId = useRef(1)
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [noPhotoHint, setNoPhotoHint] = useState(false)
  const logRef = useRef<HTMLOListElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const busy = turns.some((t) => t.state === 'loading' || t.state === 'search-loading')

  useEffect(() => {
    const last = logRef.current?.lastElementChild as HTMLElement | null
    last?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [turns])

  async function onFile(file: File | undefined) {
    setPhotoError(null)
    if (!file) return
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && file.type !== '') {
      setPhotoError('Yalnızca JPEG, PNG veya WebP fotoğraf eklenebilir.')
      return
    }
    if (file.size > MAX_RAW_MB * 1024 * 1024) {
      setPhotoError(`Fotoğraf en çok ${MAX_RAW_MB} MB olabilir.`)
      return
    }
    try {
      const prepared = await preparePhoto(file)
      if ((prepared.image.data.length * 3) / 4 > maxImageMb * 1024 * 1024) {
        setPhotoError(`Fotoğraf küçültüldükten sonra da ${maxImageMb} MB sınırını aşıyor.`)
        return
      }
      setPhoto(prepared)
      setConsent(false)
    } catch {
      setPhotoError('Fotoğraf okunamadı. Başka bir fotoğraf deneyin.')
    }
  }

  function historyFor(context: string): GuideTurn[] {
    return turns
      .filter((t): t is Turn & { state: 'done'; result: GuideResult } => t.state === 'done' && t.context === context)
      .slice(-4)
      .map((t) => ({
        question: t.question.slice(0, MAX_QUESTION),
        answer: (t.result.mode === 'generative' ? answerText(t.result) || t.result.message : t.result.message).slice(0, 1500),
      }))
  }

  async function send(
    text: string,
    context: string,
    image: Photo | null,
    extraHistory: GuideTurn[] = [],
    note?: string,
    consented = false,
    photoContext?: PhotoContext,
  ) {
    const q = (text.trim() || (image ? DEFAULT_PHOTO_QUESTION : '')).slice(0, MAX_QUESTION)
    if (q.length < 2 || busy || (image && !consent && !consented)) return
    setNoPhotoHint(false)
    const id = nextId.current++
    const history = [...historyFor(context), ...extraHistory].slice(-4)
    setTurns((ts) => [
      ...ts,
      {
        id,
        question: q,
        context,
        photoUrl: image?.previewUrl ?? null,
        photo: image ?? undefined,
        photoContext: image ? undefined : photoContext,
        note,
        state: 'loading',
        startedAt: Date.now(),
      },
    ])
    setQuestion('')
    setPhoto(null)
    setConsent(false)
    try {
      const result = await askGuide(q, context, history, image ? { ...image.image, consent: true } : null, photoContext)
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, state: 'done', result } : t)))
    } catch (e) {
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, state: 'error', message: guideError(e) } : t)))
    } finally {
      onAnswered?.()
    }
  }

  /** Yapay zekâ cevabı gelmediğinde aynı soru, kota harcamadan, onaylı kayıtlarda aranır (yalnızca ziyaretçi isterse). */
  async function searchInstead(turn: Turn) {
    if (busy) return
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, state: 'search-loading' } : t)))
    try {
      const search = await askMonument(turn.question, turn.context)
      setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, state: 'search-done', search } : t)))
    } catch (e) {
      setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, state: 'error', message: errorMessage(e) } : t)))
    }
  }

  // Takip sorusu en son cevaplanan eser bağlamında sorulur (ziyaretçi başka bir eseri adıyla sorabilir).
  const lastContext = [...turns].reverse().find((t) => t.state === 'done' && t.result.monument)
  const context = lastContext && lastContext.state === 'done' ? lastContext.result.monument!.monument_id : monumentId

  /**
   * Sohbet hâlâ fotoğraf üzerineyse (son tur fotoğraf analizi ya da onun takibiyse) sonraki soru analiz metniyle birlikte
   * gönderilir: mimari soru fotoğraf yeniden gönderilmeden cevaplanır, tarihî soru yalnızca doğrulanmış eser için.
   * Ziyaretçi eseri kendisi seçince veya fotoğrafsız bir soruya geçince bağlam düşer.
   */
  const lastTurn = turns[turns.length - 1]
  const activePhotoContext =
    lastTurn && lastTurn.state === 'done' ? (photoContextOf(lastTurn.result) ?? lastTurn.photoContext) : undefined

  function explainMore(turn: Turn) {
    const ctx = turn.state === 'done' ? (photoContextOf(turn.result) ?? turn.photoContext) : undefined
    if (ctx) void send(EXPLAIN_MORE_QUESTION, turn.context, null, [], undefined, false, ctx)
  }

  function pick(turn: Turn, mid: string) {
    // Fotoğraf yeniden gönderilmez: önceki gözlem yalnızca bağlam olarak eklenir (ek görsel analiz ücreti yok).
    const extra: GuideTurn[] =
      turn.state === 'done' && turn.result.photo?.description
        ? [{ question: `(fotoğraf) ${turn.question}`, answer: `Fotoğraftan gözlem: ${turn.result.photo.description}` }]
        : []
    void send(turn.question, mid, null, extra)
  }

  /** Fotoğraf analizi başarısız olduğunda ziyaretçinin istediği tek seferlik yeniden gönderim (aynı onaylı fotoğraf). */
  function retry(turn: Turn) {
    if (turn.photo) void send(turn.question, turn.context, turn.photo, [], undefined, true)
  }

  /** Fotoğrafsız soru: soru giriş alanına konur, ziyaretçi düzenleyip kendisi gönderir (açık eser hakkında sorulur). */
  function askWithoutPhoto(turn: Turn) {
    setPhoto(null)
    setQuestion(turn.question.slice(0, MAX_QUESTION))
    setNoPhotoHint(true)
    inputRef.current?.focus()
  }

  // Ziyaretçinin kendi seçimi: fotoğraf gözlemi bağlam olarak eklenmez, böylece model fotoğrafı seçilen esere bağlamaz.
  function choose(turn: Turn, mid: string) {
    void send(turn.question, mid, null, [], 'Bu cevap fotoğrafla eşleştirilmeden, seçtiğiniz eserin onaylı kayıtlarına dayanır.')
  }

  return (
    <section id="esere-sor" className="ask-monument ask-monument--guide" aria-labelledby="esere-sor-title">
      <header className="ask-monument__head">
        <h3 id="esere-sor-title">
          Esere Sor <span className="ask-beta">Deneme sürümü · yapay zekâ rehberi</span>
        </h3>
        <p className="ask-monument__notice">
          Sorunuzu serbestçe yazın{photoEnabled ? ' veya bir fotoğraf ekleyin' : ''}. Cevabı yapay zekâ, yalnızca yayın onayı verilmiş tarihî
          kayıtlardan yazar; her cümlenin dayandığı kayıt ve bağımsız kaynakları altta gösterilir. Kayıtlarda olmayan
          bilgiyi tahmin etmez. Cevap veren {monumentName} ya da tarihî bir kişi değildir. Yapay zekâ yanılabilir; önemli
          bilgileri kaynağından kontrol edin.
        </p>
        <Quota remaining={remainingToday} circuitOpen={circuitOpen} />
        {onLogout && (
          <button type="button" className="button button--light guide-logout" onClick={onLogout} disabled={busy}>
            Test oturumunu kapat
          </button>
        )}
      </header>

      {suggestions.length > 0 && turns.length === 0 && (
        <div className="ask-suggestions" role="group" aria-label="Örnek sorular (isteğe bağlı)">
          {suggestions.map((s) => (
            <button key={s} type="button" className="ask-chip" onClick={() => send(s, monumentId, null)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      <ol className="ask-log" ref={logRef} aria-live="polite" aria-label="Sorular ve cevaplar">
        {turns.map((t) => (
          <li key={t.id} className="ask-turn">
            <div className="ask-bubble">
              {t.photoUrl && <img className="guide-thumb" src={t.photoUrl} alt="Sorunuzla gönderilen fotoğraf" />}
              <p>
                <span className="visually-hidden">Sorunuz: </span>
                {t.question}
              </p>
            </div>
            {t.state === 'loading' && <Waiting startedAt={t.startedAt} photo={t.photoUrl !== null} deadlineS={deadlineS} />}
            {t.state === 'error' && (
              <div className="guide-reply">
                <p className="notice notice--warning" role="alert">
                  {t.photoUrl ? `Fotoğraf şu anda analiz edilemedi. ${t.message}` : t.message}
                </p>
                {t.photoUrl ? (
                  // Fotoğraflı soruda açık eserin kayıtları fotoğrafın cevabıymış gibi aranmaz.
                  <PhotoActions
                    result={{ actions: ['retry_photo', 'upload_another', 'ask_without_photo'] } as GuideResult}
                    onChoose={() => {}}
                    onUploadAnother={() => galleryRef.current?.click()}
                    onRetry={t.photo ? () => retry(t) : undefined}
                    onAskWithoutPhoto={() => askWithoutPhoto(t)}
                  />
                ) : (
                  <div className="ask-options">
                    <button type="button" className="button button--light" onClick={() => void searchInstead(t)} disabled={busy}>
                      Onaylı kayıtlarda ara (yapay zekâsız)
                    </button>
                  </div>
                )}
              </div>
            )}
            {t.state === 'search-loading' && (
              <p className="ask-loading" role="status">
                Onaylı kayıtlarda aranıyor…
              </p>
            )}
            {t.state === 'search-done' && (
              <div className="guide-reply">
                <p className="guide-meta">Yapay zekâsız arama sonucu (onaylı kayıtların kendi metni):</p>
                <Answer
                  result={t.search}
                  onPick={(mid) => void send(t.question, mid, null)}
                  onAsk={(q, mid) => void send(q, mid, null)}
                />
              </div>
            )}
            {t.note && <p className="guide-meta guide-turn-note">{t.note}</p>}
            {t.state === 'done' && (
              <GuideAnswer
                turnId={t.id}
                result={t.result}
                onPick={(mid) => pick(t, mid)}
                onChoose={(mid) => choose(t, mid)}
                onAsk={(q, mid) => void send(q, mid, null)}
                onUploadAnother={() => galleryRef.current?.click()}
                onRetry={t.photo ? () => retry(t) : undefined}
                onAskWithoutPhoto={() => askWithoutPhoto(t)}
                onExplainMore={() => explainMore(t)}
              />
            )}
          </li>
        ))}
      </ol>

      {photo && (
        <div className="guide-preview">
          <img src={photo.previewUrl} alt="Eklenecek fotoğrafın önizlemesi" />
          <div>
            <p className="guide-meta">
              Fotoğraf, konum ve cihaz bilgileri silinip yüz taramasından geçtikten sonra analiz için OpenRouter üzerinden
              NVIDIA Nemotron modeline gönderilir ve VAKIFNAME'de saklanmaz. Ücretsiz hizmette sağlayıcı gönderilen
              içeriği kaydedebilir.
            </p>
            <label className="guide-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              Fotoğrafta insan yüzü, kişisel bilgi veya gizli belge olmadığını onaylıyorum.
            </label>
            <button type="button" className="button button--light" onClick={() => setPhoto(null)}>
              Fotoğrafı kaldır
            </button>
          </div>
        </div>
      )}
      {photoError && (
        <p className="notice notice--warning" role="alert">
          {photoError}
        </p>
      )}

      {noPhotoHint && (
        <p className="guide-meta guide-nophoto" role="status">
          Fotoğraf kullanılmadan, {monumentName} hakkındaki onaylı kayıtlardan cevaplanır. Sorunuzu düzenleyip «Sor» ile
          gönderin.
        </p>
      )}
      <form
        className="ask-form guide-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send(question, context, photo, [], undefined, false, photo ? undefined : activePhotoContext)
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          {monumentName} hakkında sorunuz
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={question}
          maxLength={MAX_QUESTION}
          placeholder={
            photo
              ? 'Fotoğraf hakkında sorunuz (isteğe bağlı)…'
              : activePhotoContext
                ? 'Fotoğraftaki mimari hakkında sorun (ör. kubbeler, minareler, malzeme)…'
                : `${monumentName} hakkında bir soru yazın…`
          }
          onChange={(e) => setQuestion(e.target.value)}
          autoComplete="off"
          enterKeyHint="send"
        />
        {photoEnabled && (
          <div className="guide-photo-buttons">
            <button type="button" className="button button--light" onClick={() => galleryRef.current?.click()} disabled={busy}>
              Fotoğraf ekle
            </button>
            <button type="button" className="button button--light guide-camera" onClick={() => cameraRef.current?.click()} disabled={busy}>
              Kamerayla çek
            </button>
          </div>
        )}
        <input
          ref={galleryRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Galeriden fotoğraf seç"
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Kamerayla fotoğraf çek"
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || (question.trim().length < 2 && !photo) || (photo !== null && !consent)}
        >
          {busy ? 'Yanıtlanıyor…' : 'Sor'}
        </button>
      </form>
    </section>
  )
}
