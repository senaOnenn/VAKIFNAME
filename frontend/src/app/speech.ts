import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Satır satır seslendirme (Web Speech API, tr-TR). Ses yalnızca kullanıcı başlatınca çalışır. Türkçe ses yoksa veya
 * kullanıcı sessiz modu seçtiyse altyazı, metnin uzunluğuna göre zamanlanarak kendiliğinden ilerler (okuma modu).
 */
export type PlayState = 'idle' | 'playing' | 'paused' | 'done'

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null)

export function pickTurkishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const tr = voices.filter((v) => v.lang?.toLowerCase().startsWith('tr'))
  return tr.find((v) => /yelda|emel|filiz|female|kadın/i.test(v.name)) ?? tr[0] ?? null
}

/** Okuma modunda bir satırın ekranda kalma süresi (ms): yaklaşık dakikada 170 sözcük, en az 2,5 sn. */
export const readingMs = (text: string, rate = 1) => Math.max(2500, (text.split(/\s+/).length / 170) * 60_000) / rate

export function useNarration(lines: { spoken: string; text: string }[], opts: { onDone?: () => void } = {}) {
  const [state, setState] = useState<PlayState>('idle')
  const [index, setIndex] = useState(0)
  const [rate, setRate] = useState(1)
  const [muted, setMuted] = useState(false)
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)
  const timer = useRef<number | null>(null)
  const run = useRef(0) // her başlatmada artar; eski geri çağrılar yok sayılır
  const onDone = useRef(opts.onDone)
  onDone.current = opts.onDone

  useEffect(() => {
    const s = synth()
    if (!s) return
    const load = () => setVoice(pickTurkishVoice(s.getVoices()))
    load()
    s.addEventListener?.('voiceschanged', load)
    return () => s.removeEventListener?.('voiceschanged', load)
  }, [])

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    synth()?.cancel()
  }

  const playFrom = useCallback(
    (i: number) => {
      clear()
      const myRun = ++run.current
      if (i >= lines.length) {
        setState('done')
        onDone.current?.()
        return
      }
      setIndex(i)
      setState('playing')
      const next = () => run.current === myRun && playFrom(i + 1)
      const s = synth()
      if (!muted && s && voice) {
        const u = new SpeechSynthesisUtterance(lines[i].spoken)
        u.voice = voice
        u.lang = voice.lang || 'tr-TR'
        u.rate = rate
        u.onend = next
        u.onerror = (e) => {
          // İptal (kullanıcı durdurdu / satır atladı) hata sayılmaz; diğer hatalarda okuma moduna düşülür.
          if (run.current === myRun && e.error !== 'interrupted' && e.error !== 'canceled') {
            timer.current = window.setTimeout(next, readingMs(lines[i].text, rate))
          }
        }
        s.speak(u)
      } else {
        timer.current = window.setTimeout(next, readingMs(lines[i].text, rate))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, muted, voice, rate],
  )

  const pause = useCallback(() => {
    run.current++
    clear()
    setState('paused')
  }, [])

  // Sayfadan çıkınca konuşma kesilir.
  useEffect(() => () => {
    run.current++
    clear()
  }, [])

  return {
    state,
    index,
    rate,
    muted,
    hasVoice: !!voice,
    play: () => playFrom(state === 'done' ? 0 : index),
    pause,
    goTo: (i: number) => (state === 'playing' ? playFrom(i) : setIndex(Math.max(0, Math.min(lines.length - 1, i)))),
    setRate: (r: number) => {
      setRate(r)
      if (state === 'playing') pause()
    },
    setMuted: (m: boolean) => {
      setMuted(m)
      if (state === 'playing') pause()
    },
  }
}
