import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL, apiGet, apiPost } from '../api/client'
import { VOICE_KADIN, type VoiceProfile } from './narratorVoice'

/**
 * Satır satır seslendirme. Ses yalnızca kullanıcı başlatınca çalışır.
 * - Sunucu seslendirmesi açıksa (`/speech/status`, Faz 8: Google Chirp 3 HD) her cümlenin ses dosyası çalınır; bir sonraki
 *   cümle önceden istenir. Hata olursa o cümle tarayıcı sesiyle okunur.
 * - Değilse tarayıcının o dildeki sesi (Web Speech API; tr-TR, İngilizce anlatımda en-*).
 * - Türkçe ses yoksa veya kullanıcı sessiz modu seçtiyse altyazı, metnin uzunluğuna göre zamanlanarak ilerler (okuma modu).
 */
export type PlayState = 'idle' | 'playing' | 'paused' | 'done'

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null)

/** Türkçe tarayıcı sesi: önce ses profiline uygun ad (varsayılan: önceki rehberin kadın sesleri), yoksa ilk Türkçe ses. */
export function pickTurkishVoice(voices: SpeechSynthesisVoice[], profile: VoiceProfile = VOICE_KADIN): SpeechSynthesisVoice | null {
  const tr = voices.filter((v) => v.lang?.toLowerCase().startsWith('tr'))
  return tr.find((v) => profile.browserPrefer.tr.test(v.name)) ?? tr[0] ?? null
}

/** İngilizce anlatım için tarayıcı sesi (Faz 11): en-US/en-GB içinde önce profile uygun ad, sonra herhangi bir İngilizce ses. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: 'tr' | 'en', profile: VoiceProfile = VOICE_KADIN): SpeechSynthesisVoice | null {
  if (lang === 'tr') return pickTurkishVoice(voices, profile)
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  const main = en.filter((v) => /^en[-_](us|gb)$/i.test(v.lang))
  return main.find((v) => profile.browserPrefer.en.test(v.name)) ?? main[0] ?? en[0] ?? null
}

/** Okuma modunda bir satırın ekranda kalma süresi (ms): yaklaşık dakikada 170 sözcük, en az 2,5 sn. */
export const readingMs = (text: string, rate = 1) => Math.max(2500, (text.split(/\s+/).length / 170) * 60_000) / rate

let speechStatus: Promise<boolean> | null = null
/** Sunucu seslendirmesi açık mı (oturum başına bir kez sorulur; hata = kapalı). */
export function serverSpeechEnabled(): Promise<boolean> {
  speechStatus ??= (apiGet('/speech/status') as Promise<{ enabled?: boolean }>).then((s) => !!s?.enabled, () => false)
  return speechStatus
}
export const resetSpeechStatusForTests = () => {
  speechStatus = null
}

export function useNarration(
  lines: { spoken: string; text: string }[],
  opts: { onDone?: () => void; monumentId?: string; lang?: 'tr' | 'en'; voiceProfile?: VoiceProfile } = {},
) {
  const profile = opts.voiceProfile ?? VOICE_KADIN
  const [state, setState] = useState<PlayState>('idle')
  const [index, setIndex] = useState(0)
  const [rate, setRate] = useState(1)
  const [muted, setMuted] = useState(false)
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)
  // R3.3: ses beklenirken (sunucu sesi açık ya da tarayıcı sesi var) bu cümle sessiz kaldıysa; altyazı okuma modunda ilerler.
  const [lineSilent, setLineSilent] = useState(false)
  const timer = useRef<number | null>(null)
  const run = useRef(0) // her başlatmada artar; eski geri çağrılar yok sayılır
  // Ağız senkronu için konuşmanın anlık konumu: satır, son kelimenin karakter konumu ve o anın zamanı (Faz 8).
  const cue = useRef<{ i: number; char: number; at: number } | null>(null)
  // Sunucu sesiyle oynatılan cümle (ağız senkronu oynatma anından hesaplanır).
  const audio = useRef<{ i: number; el: HTMLAudioElement } | null>(null)
  const [serverVoice, setServerVoice] = useState(false)
  const urls = useRef(new Map<string, Promise<string>>())
  const monumentId = opts.monumentId
  const lang = opts.lang ?? 'tr'

  useEffect(() => {
    if (!monumentId) return
    let alive = true
    serverSpeechEnabled().then((on) => alive && setServerVoice(on))
    return () => {
      alive = false
    }
  }, [monumentId])

  const audioUrl = useCallback(
    (text: string) => {
      const key = `${lang}|${text}`
      let p = urls.current.get(key)
      if (!p) {
        p = (apiPost(`/monuments/${encodeURIComponent(monumentId!)}/speech`, { text, lang }) as Promise<{ url: string }>).then(
          (r) => `${API_BASE_URL}${r.url}`,
        )
        p.catch(() => urls.current.delete(key))
        urls.current.set(key, p)
      }
      return p
    },
    [monumentId, lang],
  )
  const onDone = useRef(opts.onDone)
  onDone.current = opts.onDone

  useEffect(() => {
    const s = synth()
    if (!s) return
    const load = () => setVoice(pickVoice(s.getVoices(), lang, profile))
    load()
    s.addEventListener?.('voiceschanged', load)
    return () => s.removeEventListener?.('voiceschanged', load)
  }, [lang, profile])

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    cue.current = null
    if (audio.current) {
      audio.current.el.onended = null
      audio.current.el.onerror = null
      audio.current.el.pause()
      audio.current = null
    }
    synth()?.cancel()
  }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

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
      setLineSilent(false)
      const next = () => run.current === myRun && playFrom(i + 1)
      const s = synth()
      const browserVoice = () => {
        if (!s || !voice) {
          // Sunucu sesi bu cümlede alınamadı ve tarayıcı sesi de yok. (İkisi de baştan yoksa `hasVoice` notu söyler.)
          if (serverVoice) setLineSilent(true)
          cue.current = { i, char: 0, at: now() }
          timer.current = window.setTimeout(next, readingMs(lines[i].text, rate))
          return
        }
        const u = new SpeechSynthesisUtterance(lines[i].spoken)
        u.voice = voice
        u.lang = voice.lang || (lang === 'en' ? 'en-US' : 'tr-TR')
        u.rate = rate
        u.onstart = () => {
          if (run.current === myRun) cue.current = { i, char: 0, at: now() }
        }
        u.onboundary = (e) => {
          if (run.current === myRun && e.charIndex >= 0) cue.current = { i, char: e.charIndex, at: now() }
        }
        u.onend = () => {
          if (run.current === myRun) cue.current = null
          next()
        }
        u.onerror = (e) => {
          if (run.current === myRun && e.error !== 'interrupted' && e.error !== 'canceled') {
            setLineSilent(true)
            timer.current = window.setTimeout(next, readingMs(lines[i].text, rate))
          }
        }
        s.speak(u)
      }
      if (!muted && serverVoice && monumentId && typeof Audio !== 'undefined') {
        audioUrl(lines[i].spoken).then(
          (url) => {
            if (run.current !== myRun) return
            const el = new Audio(url)
            el.playbackRate = rate
            el.onended = () => {
              if (run.current === myRun) audio.current = null
              next()
            }
            el.onerror = () => {
              if (run.current === myRun) {
                audio.current = null
                browserVoice()
              }
            }
            audio.current = { i, el }
            el.play().catch(() => {
              if (run.current === myRun) {
                audio.current = null
                browserVoice()
              }
            })
            if (i + 1 < lines.length) audioUrl(lines[i + 1].spoken).catch(() => undefined) // sonraki cümle hazır olsun
          },
          () => run.current === myRun && browserVoice(),
        )
        return
      }
      if (!muted) {
        browserVoice()
      } else {
        cue.current = { i, char: 0, at: now() }
        timer.current = window.setTimeout(next, readingMs(lines[i].text, rate))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, muted, voice, rate, serverVoice, monumentId, audioUrl, lang],
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
    hasVoice: !!voice || serverVoice,
    /** Bu cümlenin sesi çalınamadı (sunucu ve tarayıcı sesi kullanılamadı); altyazı okuma modunda ilerliyor. */
    lineSilent: lineSilent && !muted,
    serverVoice,
    cue,
    audio,
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
