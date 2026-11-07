import { useCallback, useEffect } from 'react'
import { GoldRule } from '../components/Ornament'
import { useLang } from '../i18n'
import './intro.css'

const TITLE = 'VAKIFNAME'
export const INTRO_SEEN_KEY = 'vakifname.introSeen'
/** Yazının ekranda kaldığı süre; ardından perde çözülür. */
const SHOW_MS = 4300
const REDUCED_SHOW_MS = 1500
/** Perdenin çözülme süresi (intro.css'teki geçişle aynı). */
export const INTRO_FADE_MS = 1100
const REDUCED_FADE_MS = 200

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Açılış: VAKIFNAME yazısı belirir; süre dolunca (ya da "Geç", Esc, Enter) `onLeave` çağrılır ve tanıtım sayfası
 * perdenin altında açılır. Perde yavaşça çözülür, bitince `onDone` (7 Kasım: ani geçiş yumuşatıldı). Her zaman atlanabilir.
 */
export default function Intro({ leaving, onLeave, onDone }: { leaving: boolean; onLeave: () => void; onDone: () => void }) {
  const { t } = useLang()

  const leave = useCallback(() => {
    try {
      window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    } catch {
      /* yoksay */
    }
    onLeave()
  }, [onLeave])

  useEffect(() => {
    if (leaving) return
    const timer = window.setTimeout(leave, reducedMotion() ? REDUCED_SHOW_MS : SHOW_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') leave()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [leaving, leave])

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(onDone, reducedMotion() ? REDUCED_FADE_MS : INTRO_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, onDone])

  return (
    <main
      className={`vk-intro${leaving ? ' vk-intro--leaving' : ''}`}
      aria-label={t('VAKIFNAME açılış')}
      aria-hidden={leaving || undefined}
    >
      <div className="vk-intro__halo" aria-hidden="true" />
      <div className="vk-intro__center">
        <h1 className="vk-intro__title" aria-label={TITLE}>
          {TITLE.split('').map((ch, i) => (
            <span key={i} className="vk-intro__letter" style={{ ['--i' as string]: i }} aria-hidden="true">
              {ch}
            </span>
          ))}
        </h1>
        <GoldRule className="vk-intro__rule" />
        <p className="vk-intro__tagline">{t('Geçmişin izinde, geleceğe bir miras')}</p>
      </div>
      {!leaving && (
        <button type="button" className="vk-link-btn vk-intro__skip" onClick={leave}>
          {t('Geç')}
        </button>
      )}
    </main>
  )
}
