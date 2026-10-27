import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoldRule, Ornament } from '../components/Ornament'
import './intro.css'

const TITLE = 'VAKIFNAME'
export const INTRO_SEEN_KEY = 'vakifname.introSeen'
const DURATION_MS = 5200
const REDUCED_DURATION_MS = 1800

/** Açılış: VAKIFNAME yazısı belirir, ardından otomatik olarak giriş sayfasına geçilir. Her zaman atlanabilir. */
export default function Intro() {
  const navigate = useNavigate()

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const go = () => {
      try {
        window.sessionStorage.setItem(INTRO_SEEN_KEY, '1')
      } catch {
        /* yoksay */
      }
      navigate('/giris', { replace: true })
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
  }, [navigate])

  return (
    <main className="vk-intro" aria-label="VAKIFNAME açılış">
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
        <p className="vk-intro__tagline">Geçmişin izinde, geleceğe bir miras</p>
      </div>
      <button
        type="button"
        className="vk-link-btn vk-intro__skip"
        onClick={() => navigate('/giris', { replace: true })}
      >
        Geç
      </button>
    </main>
  )
}
