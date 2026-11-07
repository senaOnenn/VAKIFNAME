import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useLoad } from './api'
import { PageLoading } from './PageLoading'
import { characterOf } from './characters'
import { KasifPortrait } from './components/KasifPortrait'
import { PuzzleIcon } from './components/Icons'
import { gamePath, useLastGameCity } from './gameCity'
import { useLang } from './i18n'
import { loadPlayerProfile, PlayerContext, PlayerLoadError, STAGE_LABEL, XP_REASON } from './player'
import { NEXT_PARAM } from './RequireAccount'
import './game-layout.css'

const BASE = import.meta.env.BASE_URL
const ROOM = `${BASE}media/sahne/scene-7-1920.webp?v=${__MEDIA_VERSION__}`

/**
 * Oyun bölgesi (R6.5): arşiv odası. Arka planda ana sayfanın son sahnesi (vakfiye parçaları, mühürler) kısık ışıkla;
 * üstte oyun çubuğu: oyunun adı, menü (Keşif Masası, Şehir seç, Rotam, Mühür Defteri) ve oyuncunun kâşifi (portre,
 * seviye, XP). Oyunun kuralları ve ilerlemesi sunucudadır; burada yalnızca gösterilir.
 */
export default function GameLayout() {
  const { t } = useLang()
  const { pathname, search } = useLocation()
  // R6.3: ilk oyunda karakter seçilir. Profil sunucudan gelir; yüklenemezse oyun açılmaz (varsayılan karakter atanmaz).
  // R6.4: profil (karakter, XP, seviye) her oyun sayfasında ve görevden sonra (`refresh`) sunucudan yeniden okunur.
  const loaded = useLoad((s) => loadPlayerProfile(s), [pathname])
  const data = loaded.data?.profile ?? null
  const fail = loaded.data?.fail ?? (loaded.error ? 'error' : null)
  const hero = fail ? null : characterOf(data?.character?.id)
  const prog = fail ? null : (data?.progress ?? null)
  const here = encodeURIComponent(pathname + search)
  // Ödül bildirimi: XP sunucuda arttıysa (önceki okumaya göre) kısa bir "+N XP" notu; ilk okumada gösterilmez.
  const seen = useRef<{ xp: number; level: number } | null>(null)
  const [toast, setToast] = useState<{ gained: number; reason: string; level: number | null } | null>(null)
  useEffect(() => {
    if (!prog) return
    const before = seen.current
    seen.current = { xp: prog.xp, level: prog.level }
    if (!before || prog.xp <= before.xp) return
    const top = prog.recent[0]
    setToast({ gained: prog.xp - before.xp, reason: top ? XP_REASON[top.source] : '', level: prog.level > before.level ? prog.level : null })
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [prog])
  const remembered = useLastGameCity()
  const city = /^\/oyun\/rota\/([^/]+)/.exec(pathname)?.[1] ?? remembered
  const items = [
    { to: gamePath.home, label: 'Vakfiye Odası', active: pathname === gamePath.home },
    { to: gamePath.cities, label: 'Şehir seç', active: pathname === gamePath.cities },
    ...(city ? [{ to: gamePath.route(city), label: 'Rotam', active: pathname.startsWith('/oyun/rota/') || pathname.startsWith('/oyun/eser/') }] : []),
    { to: '/pasaport', label: 'Mühür Defteri', active: false },
  ]
  return (
    <div className="vk-gamezone" style={{ ['--room' as string]: `url("${ROOM}")` }}>
      <div className="vk-gamezone__room" aria-hidden="true">
        {DUST.map(([x, y, d, z], k) => (
          <span key={k} className="vk-gamezone__dust" style={{ left: `${x}%`, top: `${y}%`, ['--d' as string]: `${-d}s`, ['--z' as string]: `${z}px` }} />
        ))}
      </div>
      <div className="vk-gamebar">
        <div className="vk-gamebar__inner">
          <Link to={gamePath.home} className="vk-gamebar__id">
            <span className="vk-gamebar__icon"><PuzzleIcon /></span>
            <span>
              <span className="vk-gamebar__eyebrow">{t('Oyun')}</span>
              <span className="vk-gamebar__title">{t('Kayıp Vakfiye')}</span>
            </span>
          </Link>
          <nav aria-label={t('Oyun menüsü')} className="vk-gamebar__nav">
            {items.map(({ to, label, active }) => (
              <Link key={label} to={to} className={`vk-gamebar__link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                {t(label)}
              </Link>
            ))}
          </nav>
          {hero && prog && (
            <div className="vk-gamebar__hero" data-stage={prog.stage}>
              <Link to={`/oyun/karakter?${NEXT_PARAM}=${here}`} className="vk-gamebar__hero-link" aria-label={t('Kâşifin: {name}. Kâşifini değiştir', { name: t(hero.name) })}>
                <span className="vk-gamebar__face" aria-hidden="true">
                  <KasifPortrait id={hero.id} stage={prog.stage} crop="bust" className="vk-gamebar__portrait" />
                </span>
                <span className="vk-gamebar__who">
                  <span className="vk-gamebar__hero-label">{t('Kâşifin')}</span>
                  <span className="vk-gamebar__hero-name">{t(hero.name)}</span>
                </span>
              </Link>
              <div className="vk-gamebar__level">
                <span className="vk-gamebar__level-text">
                  {t('Seviye {n}', { n: prog.level })} <span aria-hidden="true">·</span> {t(STAGE_LABEL[prog.stage])}
                </span>
                {prog.next_level_xp !== null ? (
                  <progress className="vk-gamebar__meter" max={prog.next_level_xp - prog.level_xp} value={prog.xp - prog.level_xp}
                    aria-label={t('Seviye {n} için ilerleme: {have} / {need} XP', { n: prog.level + 1, have: prog.xp - prog.level_xp, need: prog.next_level_xp - prog.level_xp })} />
                ) : null}
                <span className="vk-gamebar__xp">
                  {prog.next_level_xp !== null ? t('{xp} / {next} XP', { xp: prog.xp, next: prog.next_level_xp }) : t('{xp} XP · en üst seviye', { xp: prog.xp })}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {fail ? (
        <main className="vk-page">
          <PlayerLoadError fail={fail} onRetry={loaded.reload} className="vk-page__state vk-page__state--error" />
        </main>
      ) : !data ? (
        <main className="vk-page"><p className="vk-page__state" role="status">{t('Oyuncu profili yükleniyor…')}</p></main>
      ) : !data.character ? (
        <Navigate to={`/oyun/karakter?${NEXT_PARAM}=${here}`} replace />
      ) : (
        <PlayerContext.Provider value={{ refresh: loaded.reload, profile: data }}>
          <Suspense fallback={<PageLoading />}><Outlet /></Suspense>
        </PlayerContext.Provider>
      )}
      <p className="vk-xptoast" role="status" aria-live="polite" hidden={!toast}>
        {toast && (
          <>
            <strong>{t('+{n} XP', { n: toast.gained })}</strong>
            {toast.reason && <> <span aria-hidden="true">·</span> {t(toast.reason)}</>}
            {toast.level && <> <span aria-hidden="true">·</span> {t('Yeni seviye: {n}', { n: toast.level })}</>}
          </>
        )}
      </p>
    </div>
  )
}

// Odadaki altın zerrecikler: [x %, y %, faz s, boyut px]; çok yavaş, yalnızca hareket azaltılmamışsa (CSS).
const DUST: [number, number, number, number][] = [
  [62, 28, 3, 3], [70, 44, 11, 2], [78, 22, 7, 3], [84, 52, 15, 2], [66, 60, 5, 2], [90, 34, 9, 3], [74, 70, 13, 2], [58, 48, 17, 2],
]
