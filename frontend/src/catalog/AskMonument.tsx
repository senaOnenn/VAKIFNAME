import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { askMonument, getAskSuggestions, isAskSuggestion } from './catalogClient'
import { GuideChat } from './GuideChat'
import { closeTesterSession, getGuideAvailability } from './guideClient'
import { TesterLogin } from './TesterLogin'
import './ask-monument.css'
import type { AskFact, AskIdentity, AskResult, AskVerification, GuideAvailability } from './types'

const MAX_QUESTION = 300

type Turn =
  | { id: number; question: string; context: string; state: 'loading' }
  | { id: number; question: string; context: string; state: 'done'; result: AskResult }
  | { id: number; question: string; context: string; state: 'error'; message: string }

const isIdentity = (a: AskFact | AskIdentity): a is AskIdentity => 'kind' in a && a.kind === 'identity'

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Kısa sürede çok soru gönderildi. Lütfen bir dakika sonra tekrar deneyin.'
    if (e.kind === 'network' || e.kind === 'timeout') return 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.'
    return e.message
  }
  return 'Soru gönderilemedi. Lütfen tekrar deneyin.'
}

function Sources({ fact }: { fact: AskFact }) {
  return (
    <p className="ask-card__sources">
      Kaynak:{' '}
      {fact.sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && ' · '}
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {s.publisher} — {s.title}
          </a>
        </span>
      ))}
    </p>
  )
}

export function FactCard({ fact, lead, verification }: { fact: AskFact; lead?: boolean; verification?: AskVerification }) {
  return (
    <article className={`ask-card${lead ? ' ask-card--lead' : ''}`} aria-label={`Onaylı kayıt: ${fact.title}`}>
      <header className="ask-card__head">
        <h5>{fact.title}</h5>
        <span className={`ask-certainty ask-certainty--${fact.certainty}`}>{fact.certainty_label}</span>
      </header>
      <p className="ask-card__text">{fact.text}</p>
      <Sources fact={fact} />
      {/* Doğrulayıcı puanı kalibre edilmiş bir olasılık değil; yüzde olarak gösterilmez. */}
      {verification?.answerable && verification.selected_fact_id === fact.fact_id && (
        <p className="ask-card__verified">
          Otomatik denetim bu kaydı soruyla eşleştirdi · {verification.reason} Denetim yanılabilir; lütfen kaynağı kontrol edin.
        </p>
      )}
      <p className="ask-card__meta">
        {fact.monument_name} · Kayıt {fact.fact_id}
      </p>
    </article>
  )
}

export function Answer({
  result,
  onPick,
  onAsk,
}: {
  result: AskResult
  onPick: (monumentId: string) => void
  /** "Bunu mu demek istediniz?" önerisi onaylanınca düzeltilmiş soru o eser bağlamında yeniden sorulur. */
  onAsk?: (question: string, monumentId: string) => void
}) {
  const a = result.answer
  // Rehberin yedek aramasındaki sonuç istemcide ayrıca doğrulanmadığı için öneriler burada da süzülür.
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions.filter(isAskSuggestion) : []
  return (
    <div className={`ask-reply ask-reply--${result.status}`}>
      <p className="ask-reply__message">{result.message}</p>
      {a && isIdentity(a) && (
        <article className="ask-card ask-card--lead" aria-label="Onaylı eser kimliği kaydı">
          <p className="ask-card__text">{a.text}</p>
          <p className="ask-card__meta">
            {a.certainty_label} · {a.monument_name}
          </p>
        </article>
      )}
      {a && !isIdentity(a) && <FactCard fact={a} lead verification={result.verification} />}
      {result.related.length > 0 && (
        <details className="ask-related">
          <summary>İlgili diğer onaylı kayıtlar ({result.related.length})</summary>
          {result.related.map((f) => (
            <FactCard key={f.fact_id} fact={f} />
          ))}
        </details>
      )}
      {result.site_notice && <p className="notice">Eser için yayımlanmış ziyaret notu: {result.site_notice}</p>}
      {onAsk && suggestions.length > 0 && (
        <div className="ask-options" role="group" aria-label="Önerilen soru">
          {suggestions.map((s) => (
            <button
              key={s.fact_id}
              type="button"
              className="button button--light"
              onClick={() => onAsk(s.question, s.monument_id)}
            >
              Evet, “{s.question}” · {s.monument_name}
            </button>
          ))}
        </div>
      )}
      {result.options.length > 0 && (
        <div className="ask-options" role="group" aria-label="Eser seçenekleri">
          {result.options.map((o) => (
            <button key={o.monument_id} type="button" className="button button--light" onClick={() => onPick(o.monument_id)}>
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Esere Sor: ziyaretçi doğal Türkçe soru sorar; cevap yalnızca yayın onaylı olgulardan, metni değiştirilmeden ve
 * bağımsız kaynaklarıyla gelir. Yapay zekâ metin üretmez; cevap veren tarihî bir kişi değildir.
 */
export function AskMonument({ monumentId, monumentName }: { monumentId: string; monumentName: string }) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [enabled, setEnabled] = useState(true)
  const [guide, setGuide] = useState<GuideAvailability | null>(null)
  const nextId = useRef(1)
  const inputId = useId()
  const busy = turns.some((t) => t.state === 'loading')
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const ctl = new AbortController()
    getAskSuggestions(monumentId, ctl.signal).then(setSuggestions, (e) => {
      setSuggestions([])
      // Sunucuda özellik kapatıldıysa (503) bölüm gösterilmez.
      if (e instanceof ApiError && e.status === 503) setEnabled(false)
    })
    return () => ctl.abort()
  }, [monumentId])

  useEffect(() => {
    // Yapay zekâ rehberi sunucuda açık değilse (kapalı, test anahtarı yok veya hata) mevcut arama kullanılır.
    const ctl = new AbortController()
    getGuideAvailability(ctl.signal).then(setGuide, () => setGuide(null))
    return () => ctl.abort()
  }, [])

  function refreshGuide() {
    getGuideAvailability().then(setGuide, () => setGuide(null))
  }

  useEffect(() => {
    const last = logRef.current?.lastElementChild as HTMLElement | null
    last?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [turns])

  async function send(text: string, context: string = monumentId) {
    const q = text.trim()
    if (q.length < 2 || busy) return
    const id = nextId.current++
    setTurns((ts) => [...ts, { id, question: q, context, state: 'loading' }])
    setQuestion('')
    try {
      const result = await askMonument(q, context)
      setTurns((ts) => ts.map((t) => (t.id === id ? { id, question: q, context, state: 'done', result } : t)))
    } catch (e) {
      setTurns((ts) => ts.map((t) => (t.id === id ? { id, question: q, context, state: 'error', message: errorMessage(e) } : t)))
    }
  }

  if (guide?.enabled)
    return (
      <GuideChat
        monumentId={monumentId}
        monumentName={monumentName}
        suggestions={suggestions}
        maxImageMb={guide.max_image_mb ?? 6}
        photoEnabled={guide.photo !== false}
        remainingToday={guide.tester ? guide.remaining_today : undefined}
        circuitOpen={guide.circuit_open}
        deadlineS={guide.deadline_s}
        onAnswered={refreshGuide}
        onLogout={guide.tester ? () => void closeTesterSession().finally(refreshGuide) : undefined}
      />
    )
  if (!enabled) return null
  return (
    <section id="esere-sor" className="ask-monument" aria-labelledby="esere-sor-title">
      <header className="ask-monument__head">
        <h3 id="esere-sor-title">
          Esere Sor <span className="ask-beta">Deneme sürümü</span>
        </h3>
        <p className="ask-monument__notice">
          Cevaplar yalnızca yayın onayı verilmiş tarihî kayıtlardan, metni değiştirilmeden ve kaynaklarıyla gösterilir.
          Yapay zekâ yeni metin üretmez; cevap veren {monumentName} ya da tarihî bir kişi değildir. Kayıtlarda olmayan bir
          bilgiyi tahmin etmez, açıkça söyler. Deneme aşamasındadır: gösterilen kayıt sorunuzu tam karşılamıyorsa kaynak
          bağlantısından kontrol edin.
        </p>
      </header>

      {suggestions.length > 0 && turns.length === 0 && (
        <div className="ask-suggestions" role="group" aria-label="Örnek sorular">
          {suggestions.map((s) => (
            <button key={s} type="button" className="ask-chip" onClick={() => send(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      <ol className="ask-log" ref={logRef} aria-live="polite" aria-label="Sorular ve cevaplar">
        {turns.map((t) => (
          <li key={t.id} className="ask-turn">
            <p className="ask-bubble">
              <span className="visually-hidden">Sorunuz: </span>
              {t.question}
            </p>
            {t.state === 'loading' && (
              <p className="ask-loading" role="status">
                <span className="ask-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                Onaylı kayıtlarda aranıyor…
              </p>
            )}
            {t.state === 'error' && (
              <p className="notice notice--warning" role="alert">
                {t.message}
              </p>
            )}
            {t.state === 'done' && (
              <Answer result={t.result} onPick={(mid) => send(t.question, mid)} onAsk={(q, mid) => send(q, mid)} />
            )}
          </li>
        ))}
      </ol>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send(question)
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          {monumentName} hakkında sorunuz
        </label>
        <input
          id={inputId}
          type="text"
          value={question}
          maxLength={MAX_QUESTION}
          placeholder={`${monumentName} hakkında bir soru yazın…`}
          onChange={(e) => setQuestion(e.target.value)}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="button button--primary" disabled={busy || question.trim().length < 2}>
          {busy ? 'Aranıyor…' : 'Sor'}
        </button>
      </form>
      {guide?.tester_login && <TesterLogin onOpened={refreshGuide} />}
    </section>
  )
}
