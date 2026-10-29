import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { askGuide, getGuideAvailability, type GuideTurn } from '../../catalog/guideClient'
import type { GuideResult } from '../../catalog/types'
import type { MonumentDetail } from '../api'
import { MS_PER_WEIGHT, mouthFrom, visemes, type Mouth } from '../lipsync'
import { buildScript, LOCAL_GUIDE } from '../narration'
import { useNarration } from '../speech'
import { GuideCharacter } from './GuideCharacter'
import './narrator.css'

const RATES = [0.85, 1, 1.15]

interface Turn {
  question: string
  result?: GuideResult
  error?: string
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
}: {
  monument: Pick<MonumentDetail, 'monument_id' | 'name' | 'facts'>
  onListened?: () => void
  onAsked?: () => void
}) {
  const id = useId()
  const lines = useMemo(() => buildScript(monument), [monument])
  const n = useNarration(lines, { onDone: onListened })
  const [large, setLarge] = useState(false)
  const [mouth, setMouth] = useState<Mouth>('X')
  const line = lines[n.index]
  const speaking = n.state === 'playing'
  const seqs = useMemo(() => lines.map((l) => visemes(l.spoken)), [lines])
  const cue = n.cue

  // Ağız senkronu: konuşmanın anlık konumundan (kelime sınırı + geçen süre) ağız şekli; hareket azaltılmışsa durağan.
  useEffect(() => {
    if (!speaking || reducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setMouth('X')
      return
    }
    let raf = 0
    const tick = () => {
      const c = cue.current
      const m = c && seqs[c.i] ? mouthFrom(seqs[c.i], c.char, performance.now() - c.at, MS_PER_WEIGHT / n.rate) : 'X'
      setMouth((prev) => (prev === m ? prev : m))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speaking, seqs, cue, n.rate])

  return (
    <section className="vk-narr" aria-labelledby={`${id}-h`}>
      <div className="vk-narr__scene">
        <div className={`vk-narr__char${speaking ? ' is-speaking' : ''}`}>
          <GuideCharacter mouth={mouth} speaking={speaking} />
        </div>
        <div className="vk-narr__talk">
          <div className="vk-narr__who">
            <h2 id={`${id}-h`}>{LOCAL_GUIDE.name}</h2>
            <span>{LOCAL_GUIDE.role}</span>
          </div>
      <div className={`vk-narr__sub${large ? ' vk-narr__sub--large' : ''}`} aria-live={speaking ? 'off' : 'polite'}>
        <p className="vk-narr__line">{line.text}</p>
        {line.source && (
          <p className="vk-narr__src">
            {line.certainty && line.certainty !== 'documented' && (
              <span className="vk-cert vk-cert--uncertain">{line.certainty === 'reported' ? 'Rivayet' : 'Kesin değil'}</span>
            )}
            Kaynak: {line.source}
          </p>
        )}
        <p className="vk-narr__pos" aria-hidden="true">{n.index + 1} / {lines.length}</p>
      </div>
        </div>
      </div>

      <div className="vk-narr__controls" role="group" aria-label="Anlatım denetimleri">
        <button type="button" className="vk-narr__btn" onClick={() => n.goTo(n.index - 1)} disabled={n.index === 0} aria-label="Önceki cümle">‹</button>
        {speaking ? (
          <button type="button" className="vk-btn" onClick={n.pause}>Duraklat</button>
        ) : (
          <button type="button" className="vk-btn" onClick={n.play}>
            {n.state === 'idle' ? 'Dinle' : n.state === 'done' ? 'Baştan dinle' : 'Devam et'}
          </button>
        )}
        <button type="button" className="vk-narr__btn" onClick={() => n.goTo(n.index + 1)} disabled={n.index >= lines.length - 1} aria-label="Sonraki cümle">›</button>
        <label className="vk-narr__opt">
          Hız
          <select value={n.rate} onChange={(e) => n.setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>{r.toLocaleString('tr-TR')}×</option>
            ))}
          </select>
        </label>
        <label className="vk-narr__opt">
          <input type="checkbox" checked={n.muted} onChange={(e) => n.setMuted(e.target.checked)} /> Sessiz (yalnızca altyazı)
        </label>
        <label className="vk-narr__opt">
          <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} /> Büyük altyazı
        </label>
      </div>
      {!n.hasVoice && !n.muted && (
        <p className="vk-narr__note">Tarayıcında Türkçe ses bulunamadı; anlatım altyazıyla ilerler.</p>
      )}
      {n.state === 'done' && <p className="vk-narr__done" role="status">Anlatımı dinledin. ✓</p>}

      <details className="vk-narr__transcript">
        <summary>Anlatımın tam metni</summary>
        <ol>
          {lines.map((l, i) => (
            <li key={i}>
              {l.text}
              {l.source && <small> — {l.source}</small>}
            </li>
          ))}
        </ol>
      </details>

      <GuideChat monumentId={monument.monument_id} onAsked={onAsked} />
    </section>
  )
}

function GuideChat({ monumentId, onAsked }: { monumentId: string; onAsked?: () => void }) {
  const id = useId()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [q, setQ] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const ctl = new AbortController()
    getGuideAvailability(ctl.signal).then(
      (a) => setEnabled(a.enabled),
      () => setEnabled(false),
    )
    return () => ctl.abort()
  }, [])

  async function send(e: FormEvent) {
    e.preventDefault()
    const question = q.trim()
    if (!question || busy) return
    setQ('')
    setBusy(true)
    const history: GuideTurn[] = turns
      .filter((t) => t.result)
      .slice(-3)
      .map((t) => ({ question: t.question, answer: t.result!.sentences.map((s) => s.text).join(' ') || t.result!.message }))
    setTurns((ts) => [...ts, { question }])
    try {
      const result = await askGuide(question, monumentId, history, null)
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, result } : t)))
      onAsked?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rehber şu anda yanıt veremiyor.'
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: message } : t)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vk-chat">
      <h3 id={`${id}-h`}>Rehbere sor</h3>
      {enabled === false && <p className="vk-narr__note">Rehber şu anda soru alamıyor. Anlatımı dinleyebilir ve kaynakları okuyabilirsin.</p>}
      <ol className="vk-chat__log" aria-live="polite" aria-labelledby={`${id}-h`}>
        {turns.map((t, i) => (
          <li key={i} className="vk-chat__turn">
            <p className="vk-chat__q">{t.question}</p>
            {!t.result && !t.error && <p className="vk-chat__a vk-chat__a--wait">Rehber düşünüyor…</p>}
            {t.error && <p className="vk-chat__a vk-chat__a--err">{t.error}</p>}
            {t.result && <Answer r={t.result} />}
          </li>
        ))}
      </ol>
      {enabled !== false && (
        <form className="vk-chat__form" onSubmit={send}>
          <label htmlFor={`${id}-q`} className="vk-sr-only">Rehbere sorun</label>
          <input
            id={`${id}-q`}
            value={q}
            maxLength={500}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Örn. Bu eseri kim yaptırdı?"
            disabled={busy || enabled === null}
          />
          <button type="submit" className="vk-btn" disabled={busy || !q.trim()}>Sor</button>
        </form>
      )}
    </div>
  )
}

function Answer({ r }: { r: GuideResult }) {
  const facts = new Map(r.facts.map((f) => [f.fact_id, f]))
  if (r.sentences.length === 0) return <p className="vk-chat__a">{r.message}</p>
  const used = [...new Set(r.sentences.flatMap((s) => s.sources))].map((sid) => facts.get(sid)).filter(Boolean)
  return (
    <div className="vk-chat__a">
      <p>{r.sentences.map((s) => s.text).join(' ')}</p>
      {used.length > 0 && (
        <p className="vk-chat__src">
          Dayandığı kayıtlar: {used.map((f) => f!.title).join(' · ')}
        </p>
      )}
      {r.mode === 'fallback_search' && <p className="vk-chat__src">{r.message}</p>}
    </div>
  )
}
