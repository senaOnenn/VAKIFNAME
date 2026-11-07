import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { mediaUrl, typeLabel, type MonumentSummary } from '../api'
import { creditIn, nameOf, textIn } from '../contentLang'
import { LangSwitch, useLang } from '../i18n'
import { displayName, startGuest, useAuth } from '../session'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Aynı sayfadaki sahneye yumuşak kaydırır; odak da hedefe geçer (klavye ile gelen için). */
export function scrollToId(id: string) {
  // Ana sayfa hikâyesinde sahne gezgini aynı durak modeliyle götürür (bkz. navigator.ts).
  const nav = (window as unknown as { __vkGoto?: (id: string) => boolean }).__vkGoto
  if (nav?.(id)) return
  const el = document.getElementById(id)
  if (!el) return
  const frame = el.querySelector<HTMLElement>('.vk-ch__frame')
  const pinned = !!frame && getComputedStyle(frame).position === 'sticky'
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth'
  if (pinned) {
    // Sabitlenen sahnede metnin tam göründüğü ana (sabit aralığın %30'u) gidilir; bölümün başında metin henüz yoktur.
    const top = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top + Math.max(0, el.offsetHeight - window.innerHeight) * 0.3, behavior })
  } else el.scrollIntoView({ behavior, block: 'start' })
  el.querySelector<HTMLElement>('[data-focus-target]')?.focus({ preventScroll: true })
}

/** Uygulama bölümüne geçiş: oturum yoksa misafir olarak (ana sayfadaki her çağrı doğrudan bölüme götürür). */
export function useEnter() {
  const auth = useAuth()
  const navigate = useNavigate()
  return useCallback(
    (to: string, state?: unknown) => {
      // Halka açık bölümlere geçişte misafir tercihi hatırlanır; oyun (R6.2) hesap ister, oraya misafir olarak girilmez.
      if (auth.status === 'none' && !to.startsWith('/oyun') && !to.startsWith('/pasaport')) startGuest()
      navigate(to, state === undefined ? undefined : { state })
    },
    [auth.status, navigate],
  )
}

/** Ana sayfanın üst menüsü: Keşfet (aynı sayfada eserler), Harita, Oyun (R6.10: rehber sağ alttaki düğmede); ilerleme çizgisi `--story`. */
export function StoryBar({ barRef }: { barRef: RefObject<HTMLElement | null> }) {
  const { t } = useLang()
  const auth = useAuth()
  const enter = useEnter()
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault()
    setOpen(false)
    enter(to)
  }
  const links = (
    <>
      <a href="#eserler" className="vk-story__navlink" onClick={(e) => (e.preventDefault(), setOpen(false), scrollToId('eserler'))}>{t('Keşfet')}</a>
      <a href="/harita" className="vk-story__navlink" onClick={go('/harita')}>{t('Harita')}</a>
      <a href="/oyun" className="vk-story__navlink" onClick={go('/oyun')}>{t('Oyun')}</a>
    </>
  )
  return (
    <header ref={barRef} className="vk-story__bar">
      <Link to="/" className="vk-story__mark">VAKIFNAME</Link>
      <nav aria-label={t('Ana menü')} className="vk-story__nav">{links}</nav>
      <div className="vk-story__end">
        <LangSwitch />
        {auth.status === 'none' ? (
          <Link to="/giris" className="vk-story__login">{t('Giriş yap')}</Link>
        ) : (
          <Link to="/hesap" className="vk-story__login" aria-label={t('Hesap: {name}', { name: displayName(auth) })}>{displayName(auth)}</Link>
        )}
        <button type="button" className="vk-story__menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
          {t('Menü')}
        </button>
      </div>
      <nav id={menuId} aria-label={t('Ana menü')} className="vk-story__drawer" hidden={!open}>
        {links}
        {auth.status === 'none' ? (
          <Link to="/giris" className="vk-story__navlink">{t('Giriş yap')}</Link>
        ) : (
          <Link to="/hesap" className="vk-story__navlink">{t('Hesap')}</Link>
        )}
      </nav>
      <span className="vk-story__progress" aria-hidden="true" />
    </header>
  )
}

/** Öge ekrana yaklaşınca (bir ekran boyu kala) `true`: fotoğraflar ilk açılışta indirilmesin. */
export function useNear(ref: RefObject<HTMLElement | null>, margin = '100% 0px'): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setNear(true), io.disconnect()), { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, near, margin])
  return near
}

/**
 * Yatay eser şeridi: masaüstünde üç kart, telefonda ~1,2 kart; oklarla, fareyle/dokunarak ve klavyeyle kaydırılır.
 * Kilit ya da durum gösterilmez; fotoğraf ve metin onaylı katalogdandır (atıf satırıyla).
 */
export function MonumentStrip({ monuments, near, timeline = false }: { monuments: MonumentSummary[]; near: boolean; timeline?: boolean }) {
  const { t, lang } = useLang()
  const auth = useAuth()
  const track = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ start: true, end: false })
  const [shown, setShown] = useState(false)

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }, [])
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, monuments.length])
  // Kartlar ekrana girince sırayla belirir (bir kez).
  useEffect(() => {
    const el = track.current
    // Zaman çizelgesindeki sahnede kartların belirmesini sahnenin kaydırma ilerlemesi yönetir (--tv, --k).
    if (!el || timeline || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return setShown(true)
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setShown(true), io.disconnect()), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  function page(dir: 1 | -1) {
    const el = track.current
    const card = el?.querySelector('li')
    if (!el || !card) return
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0
    const step = card.getBoundingClientRect().width + gap
    // Bir "sayfa" = ekranda görünen kart sayısı kadar; ölçü yoksa görünür genişlik kadar.
    const left = step > 0 ? step * Math.max(1, Math.round(el.clientWidth / step)) : el.clientWidth
    el.scrollBy({ left: dir * left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }
  const enter = () => {
    if (auth.status === 'none') startGuest()
  }

  return (
    <div className="vk-strip">
      <div className="vk-strip__controls">
        <button type="button" className="vk-strip__arrow" onClick={() => page(-1)} disabled={edges.start} aria-label={t('Önceki eserler')}>‹</button>
        <button type="button" className="vk-strip__arrow" onClick={() => page(1)} disabled={edges.end} aria-label={t('Sonraki eserler')}>›</button>
      </div>
      <ul ref={track} className={`vk-strip__track${shown ? ' is-in' : ''}`} onScroll={measure} tabIndex={0} aria-label={t('Eserler')}>
        {monuments.map((m, i) => {
          const name = nameOf(m, lang)
          const lead = textIn(m.lead, m.lead_en, lang)
          return (
            <li
              key={m.monument_id}
              className={`vk-strip__item${timeline ? ' vk-strip__item--tl' : ''}`}
              style={timeline ? { ['--k' as string]: 3 + Math.min(i, 3) * 0.7 } : { ['--i' as string]: Math.min(i, 5) }}
            >
              <article className="vk-scard">
                <Link to={`/eser/${encodeURIComponent(m.monument_id)}`} className="vk-scard__link" onClick={enter}>
                  <div className="vk-scard__media">
                    {m.cover && near ? <img src={mediaUrl(m.cover.file)} alt={t('{name} görünümü', { name })} loading="lazy" decoding="async" width={640} height={480} /> : <div className="vk-scard__noimg" />}
                  </div>
                  <div className="vk-scard__body">
                    <span className="vk-scard__type">{typeLabel(m.type)} · {m.district}</span>
                    <h3 className="vk-scard__name">{name}</h3>
                    {lead.text && <p className="vk-scard__lead" lang={lead.turkishOnly ? 'tr' : undefined}>{lead.text}</p>}
                    <span className="vk-scard__more">{t('Keşfet')} <span aria-hidden="true">→</span></span>
                  </div>
                </Link>
                {m.cover?.attribution && <p className="vk-scard__credit">{creditIn(m.cover.attribution, lang)}</p>}
              </article>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Ekrana giren `.vk-rv` ögeleri sırayla belirir (bir kez). Hareket azaltılmışsa hemen görünür. */
export function useReveal(root: RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const items = root.current?.querySelectorAll<HTMLElement>('.vk-rv:not(.is-in)') ?? []
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      items.forEach((el) => el.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))),
      { threshold: 0.15 },
    )
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [root, key])
}
