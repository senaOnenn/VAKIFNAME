import { useEffect } from 'react'
import { GoldRule, Ornament } from '../components/Ornament'
import { useLang } from '../i18n'
import './intro.css'

const TITLE = 'VAKIFNAME'
export const INTRO_SEEN_KEY = 'vakifname.introSeen'
const DURATION_MS = 5200
const REDUCED_DURATION_MS = 1800

/** Açılış: VAKIFNAME yazısı belirir, ardından tanıtım sayfası açılır (`onDone`). Her zaman atlanabilir. */
export default function Intro({ onDone }: { onDone: () => void }) {
  const { t } = useLang()

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const go = () => {
      try {
        window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
      } catch {
        /* yoksay */
      }
      onDone()
    }
    const t = window.setTimeout(go, reduced ? REDUCED_DURATION_MS : DURATION_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') go()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDone])

  return (
    <main className="vk-intro" aria-label={t('VAKIFNAME açılış')}>
      <div className="vk-intro__halo" aria-hidden="true" />
      <Ornament className="vk-intro__ornament" />
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
      <button
        type="button"
        className="vk-link-btn vk-intro__skip"
        onClick={() => {
          try {
            window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
          } catch {
            /* yoksay */
          }
          onDone()
        }}
      >
        {t('Geç')}
      </button>
    </main>
  )
}
