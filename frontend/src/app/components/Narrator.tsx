import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { askGuide, getGuideAvailability, type GuideTurn } from '../../catalog/guideClient'
import type { GuideResult } from '../../catalog/types'
import type { MonumentDetail } from '../api'
import { MS_PER_WEIGHT, mouthAt, mouthFrom, visemes, type Mouth } from '../lipsync'
import { buildScript, LOCAL_GUIDE } from '../narration'
import { useLang } from '../i18n'
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
  monument: Pick<MonumentDetail, 'monument_id' | 'name' | 'name_en' | 'facts'>
  onListened?: () => void
  onAsked?: () => void
}) {
  const id = useId()
  const { t, locale, lang } = useLang()
  // İngilizce anlatım yalnızca onaylı İngilizce kayıtlardan; eserde hiç yoksa Türkçe anlatım çalar ve bu söylenir.
  const scriptLang = lang === 'en' && monument.facts.some((f) => f.text_en) ? 'en' : 'tr'
  const lines = useMemo(() => buildScript(monument, 6, scriptLang), [monument, scriptLang])
  const n = useNarration(lines, { onDone: onListened, monumentId: monument.monument_id, lang: scriptLang })
  const [large, setLarge] = useState(false)
  const [mouth, setMouth] = useState<Mouth>('X')
  const line = lines[n.index]
  const speaking = n.state === 'playing'
  const seqs = useMemo(() => lines.map((l) => visemes(l.spoken)), [lines])
  const cue = n.cue
  const playing = n.audio

  // Ağız senkronu: konuşmanın anlık konumundan (kelime sınırı + geçen süre) ağız şekli; hareket azaltılmışsa durağan.
  useEffect(() => {
    if (!speaking || reducedMotion() || typeof requestAnimationFrame === 'undefined') {
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
      <div className="vk-narr__scene">
        <div className={`vk-narr__char${speaking ? ' is-speaking' : ''}`}>
          <GuideCharacter mouth={mouth} speaking={speaking} />
        </div>
        <div className="vk-narr__talk">
          <div className="vk-narr__who">
            <h2 id={`${id}-h`}>{t(LOCAL_GUIDE.name)}</h2>
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
      {n.state === 'done' && <p className="vk-narr__done" role="status">{t('Anlatımı dinledin. ✓')}</p>}

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

      <GuideChat monumentId={monument.monument_id} onAsked={onAsked} />
    </section>
  )
}

function GuideChat({ monumentId, onAsked }: { monumentId: string; onAsked?: () => void }) {
  const id = useId()
  const { t, lang } = useLang()
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
      const result = await askGuide(question, monumentId, history, null, undefined, lang)
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, result } : t)))
      onAsked?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('Rehber şu anda yanıt veremiyor.')
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: message } : t)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vk-chat">
      <h3 id={`${id}-h`}>{t('Rehbere sor')}</h3>
      {enabled === false && <p className="vk-narr__note">{t('Rehber şu anda soru alamıyor. Anlatımı dinleyebilir ve kaynakları okuyabilirsin.')}</p>}
      <ol className="vk-chat__log" aria-live="polite" aria-labelledby={`${id}-h`}>
        {turns.map((turn, i) => (
          <li key={i} className="vk-chat__turn">
            <p className="vk-chat__q">{turn.question}</p>
            {!turn.result && !turn.error && <p className="vk-chat__a vk-chat__a--wait">{t('Rehber düşünüyor…')}</p>}
            {turn.error && <p className="vk-chat__a vk-chat__a--err">{turn.error}</p>}
            {turn.result && <Answer r={turn.result} />}
          </li>
        ))}
      </ol>
      {enabled !== false && (
        <form className="vk-chat__form" onSubmit={send}>
          <label htmlFor={`${id}-q`} className="vk-sr-only">{t('Rehbere sorun')}</label>
          <input
            id={`${id}-q`}
            value={q}
            maxLength={500}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Örn. Bu eseri kim yaptırdı?')}
            disabled={busy || enabled === null}
          />
          <button type="submit" className="vk-btn" disabled={busy || !q.trim()}>{t('Sor')}</button>
        </form>
      )}
    </div>
  )
}

function Answer({ r }: { r: GuideResult }) {
  const { t } = useLang()
  const facts = new Map(r.facts.map((f) => [f.fact_id, f]))
  if (r.sentences.length === 0) return <p className="vk-chat__a">{r.message}</p>
  const used = [...new Set(r.sentences.flatMap((s) => s.sources))].map((sid) => facts.get(sid)).filter(Boolean)
  return (
    <div className="vk-chat__a">
      <p>{r.sentences.map((s) => s.text).join(' ')}</p>
      {used.length > 0 && (
        <p className="vk-chat__src">
          {t('Dayandığı kayıtlar:')} {used.map((f) => f!.title).join(' · ')}
        </p>
      )}
      {r.mode === 'fallback_search' && <p className="vk-chat__src">{r.message}</p>}
    </div>
  )
}
