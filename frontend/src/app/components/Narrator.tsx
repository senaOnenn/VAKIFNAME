import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { askGuide, getGuideAvailability, type GuideTurn } from '../../catalog/guideClient'
import type { GuideResult } from '../../catalog/types'
import type { MonumentDetail } from '../api'
import { buildScript, LOCAL_GUIDE } from '../narration'
import { useNarration } from '../speech'
import { Ornament } from './Ornament'
import './narrator.css'

const VIDEO_SRC = `${import.meta.env.BASE_URL}media/narrator-guide.mp4`
const RATES = [0.85, 1, 1.15]

interface Turn {
  question: string
  result?: GuideResult
  error?: string
}

/**
 * Eserin karakter anlatımı (Faz 4). Rehber sesli (tarayıcı seslendirmesi) ve altyazılı anlatır; ses otomatik başlamaz.
 * Kullanıcı rehbere yazabilir ("Esere Sor" yerine). Her tarihî cümle onaylı kayda bağlıdır; anlatım bir canlandırmadır.
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
  const video = useRef<HTMLVideoElement>(null)
  const [videoOk, setVideoOk] = useState(true)
  const [large, setLarge] = useState(false)
  const line = lines[n.index]
  const speaking = n.state === 'playing'

  useEffect(() => {
    const v = video.current
    if (!v) return
    try {
      if (speaking) void v.play()?.catch(() => undefined)
      else v.pause()
    } catch {
      /* jsdom / otomatik oynatma engeli: görüntü sabit kalır */
    }
  }, [speaking])

  return (
    <section className="vk-narr" aria-labelledby={`${id}-h`}>
      <div className={`vk-narr__stage${speaking ? ' is-speaking' : ''}`}>
        {videoOk ? (
          <video
            ref={video}
            className="vk-narr__video"
            src={VIDEO_SRC}
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
            onError={() => setVideoOk(false)}
          />
        ) : (
          <div className="vk-narr__medallion" aria-hidden="true">
            <Ornament className="vk-narr__orn" />
          </div>
        )}
        <div className="vk-narr__who">
          <h2 id={`${id}-h`}>{LOCAL_GUIDE.name}</h2>
          <span>{LOCAL_GUIDE.role}</span>
        </div>
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
