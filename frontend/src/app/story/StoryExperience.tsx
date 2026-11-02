import { Fragment, useEffect, useRef, useState, type RefObject } from 'react'
import type { MonumentSummary } from '../api'
import type { City } from '../cities'
import { Seal } from '../components/Seal'
import { useLang } from '../i18n'
import { prefersReducedMotion, StoryBar, useReveal } from './common'
import { boxFor, camera, clamp01, coverScale, flowVisibility, mapPoint, MATCH, matchMove, ramp, SCENES, sceneMix, smoothRange, stopsOf, textIn, textOut, type Box, type StopModel } from './engine'
import { useSceneNavigator } from './navigator'
import { Scene1Welcome, Scene2Journey, Scene3Map, Scene4City, Scene5Monuments, Scene6Guide, Scene7Game, StoryFinal, type Pilot } from './scenes'
import './story.css'

const BASE = import.meta.env.BASE_URL
const art = (n: number, w: number) => `${BASE}media/sahne/scene-${n}-${w}.webp?v=${__MEDIA_VERSION__}`

/** Sahne görseli: 1280 px ve özgün genişlik (büyütme yok). Yüklenemezse katman gece zemini olarak kalır. */
function Art({ i }: { i: number }) {
  const [failed, setFailed] = useState(false)
  const s = SCENES[i]
  if (failed) return null
  return (
    <img
      className="vk-layer__img"
      src={art(i + 1, s.w)}
      srcSet={`${art(i + 1, 1280)} 1280w, ${art(i + 1, s.w)} ${s.w}w`}
      // Dikey telefonda görsel ekrandan geniş gösterilir (kırpma ya da odak penceresi).
      sizes="(max-aspect-ratio: 4/5) 200vw, 100vw"
      alt=""
      width={s.w}
      height={s.h}
      decoding="async"
      fetchPriority={i === 0 ? 'high' : 'low'}
      onError={() => setFailed(true)}
    />
  )
}

/** Görselin içindeki ışıklara bağlı süsler (kutunun yüzdesiyle konumlanır; görsel değiştirilmez). */
function Decor({ i }: { i: number }) {
  if (i === 0)
    return (
      <>
        <span className="vk-glow" style={{ left: '94%', top: '57%', ['--s' as string]: '7%' }} />
        <span className="vk-glow vk-glow--slow" style={{ left: '71.5%', top: '40%', ['--s' as string]: '16%' }} />
      </>
    )
  if (i === 2)
    // Haritadaki boyalı fenerler süs: gerçek şehir işaretleriyle karışmasın diye kısılır (yerleri görselden ölçüldü).
    return (
      <>
        {[[27.2, 54.8], [44.6, 55.1], [62.9, 69.6]].map(([x, y]) => (
          <span key={x} className="vk-dim" style={{ left: `${x}%`, top: `${y}%` }} />
        ))}
      </>
    )
  if (i === 5)
    return (
      <>
        <span className="vk-sheen" style={{ left: '58%', top: '10%', width: '36%', height: '52%' }} />
        {PARTICLES.map(([x, y, d], k) => (
          <span key={k} className="vk-mote" style={{ left: `${x}%`, top: `${y}%`, ['--d' as string]: `${d}s` }} />
        ))}
      </>
    )
  if (i === 6)
    return (
      <>
        <span className="vk-glow vk-glow--seal" style={{ left: '74%', top: '83.5%', ['--s' as string]: '6%' }} />
        {PARTICLES.slice(0, 8).map(([x, y, d], k) => (
          <span key={k} className="vk-mote" style={{ left: `${x - 4}%`, top: `${y + 4}%`, ['--d' as string]: `${d}s` }} />
        ))}
      </>
    )
  return null
}

// Altın bilgi parçacıkları: [x %, y %, süre s] (defterin ve çizimlerin çevresi).
const PARTICLES: [number, number, number][] = [
  [62, 30, 7], [66, 48, 9], [70, 22, 8], [74, 40, 10], [78, 28, 7.5], [82, 52, 9.5], [86, 34, 8.5],
  [64, 56, 10.5], [72, 58, 8], [80, 18, 9], [88, 46, 7], [68, 36, 11], [76, 50, 9], [84, 24, 10],
]
// Mühür birleşmesi (6 → 7): parçacıkların başlangıç yönleri (ekranın yüzdesi).
const MERGE: [number, number][] = [
  [-38, -22], [-30, 18], [-18, -34], [-8, 30], [6, -36], [16, 28], [28, -20], [36, 14],
  [-42, 4], [42, -4], [-24, -8], [24, 6], [-12, 16], [12, -18], [0, 34], [0, -30],
]

function Stage({ loadUpTo }: { loadUpTo: number }) {
  return (
    <div className="vk-stage" aria-hidden="true">
      {SCENES.map((_, i) => (
        <Fragment key={i}>
          <div className={`vk-layer vk-layer--${i + 1}`} data-layer={i}>
            <div className="vk-box" data-box={i}>
              <div className="vk-cam" data-cam={i}>
                {i < loadUpTo && <Art i={i} />}
                <Decor i={i} />
              </div>
            </div>
            <div className={`vk-veil vk-veil--${i + 1}`} />
          </div>
          {/* 1 → 2 ve 2 → 3 geçişlerinin ara katmanları: iki görselin üstünde, haritanın altında */}
          {i === 1 && (
            <>
              <div className="vk-shade" />
              <div className="vk-stars" />
            </>
          )}
          {/* 3 → 4: Bursa'nın altın ışığı (harita ve panoramanın üstünde) */}
          {i === 3 && <div className="vk-bloom" />}
        </Fragment>
      ))}
      <div className="vk-merge">
        {MERGE.map(([dx, dy], k) => (
          <span key={k} className="vk-merge__mote" style={{ ['--dx' as string]: `${dx}vmin`, ['--dy' as string]: `${dy}vmin` }} />
        ))}
        <span className="vk-merge__seal"><Seal kind="gold" label="" size={150} /></span>
      </div>
    </div>
  )
}

/**
 * Kaydırma motoru: tek pasif dinleyici, karede bir ölçüm. Sahne konumlarından katman opaklıklarını ve kamera hareketini
 * hesaplar, değerleri doğrudan stile yazar (React yeniden çizmez). Görseller sahne yaklaşınca yüklenir.
 */
function useStoryEngine(root: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, onNeed: (n: number) => void, model: StopModel) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const reduced = prefersReducedMotion()
    const bursa = mapPoint(29.061, 40.1885)
    const layers = [...el.querySelectorAll<HTMLElement>('[data-layer]')]
    const sections = [...el.querySelectorAll<HTMLElement>('[data-scene]')]
    const cams = SCENES.map((_, i) => [...el.querySelectorAll<HTMLElement>(`[data-cam="${i}"]`)])
    const boxes = SCENES.map((_, i) => [...el.querySelectorAll<HTMLElement>(`[data-box="${i}"]`)])
    const merge = el.querySelector<HTMLElement>('.vk-merge')
    const shade = el.querySelector<HTMLElement>('.vk-shade')
    const stars = el.querySelector<HTMLElement>('.vk-stars')
    const bloom = el.querySelector<HTMLElement>('.vk-bloom')
    const frames = sections.map((s) => s.querySelector<HTMLElement>('.vk-ch__frame'))
    const veils = layers.map((L) => L.querySelector<HTMLElement>('.vk-veil'))
    const marks = sections.map((s) => s.querySelector<HTMLElement>('.vk-snapmark'))
    const contents = sections.map((s) => s.querySelector<HTMLElement>('[data-content]'))
    const tvs = sections.map(() => 1)
    const entered = sections.map(() => false)
    // Sabitlenen bölüm: çerçevesi ekrana yapışıyorsa. Telefonda içeriği ekrandan uzun sahneler akışta kalır (CSS).
    let pinned: boolean[] = sections.map(() => false)
    let tops: number[] = []
    let heights: number[] = []
    let rest: Box[] = []
    let frame = 0
    let need = 2
    // Panolar ve testler için: sahnenin dinlenme anı (sabit aralığın ortası) ve geçiş bölgesi.
    const w = window as unknown as { __vkRest?: (i: number) => number | null; __vkZone?: number; __vkStops?: () => number[] }
    w.__vkZone = 0.45
    w.__vkRest = (i) => stopsOf(model)[i] ?? null
    w.__vkStops = () => stopsOf(model)

    const geometry = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      // İçeriği ekrana sığmayan sahne (büyük yazı, %200 yakınlaştırma, alçak pencere) sabitlenmez, akışta okunur.
      // Eşik çift yönlü (40 px pay): düzen değişince ölçü salınmasın.
      sections.forEach((s, i) => {
        const c = contents[i]
        if (!c || reduced) return
        // Doğal içerik yüksekliği: çocukların toplamı + aralıklar (süs taşmaları ve konumlandırma kutusu sayılmaz).
        const kids = [...c.children] as HTMLElement[]
        const gap = parseFloat(getComputedStyle(c).rowGap) || 0
        const needH = kids.reduce((h, k) => h + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1) + 96
        const was = s.hasAttribute('data-flow')
        if (!was && needH > vh) s.setAttribute('data-flow', '')
        else if (was && needH < vh - 40) s.removeAttribute('data-flow')
      })
      pinned = frames.map((f) => !!f && getComputedStyle(f).position === 'sticky')
      tops = sections.map((s) => s.getBoundingClientRect().top + window.scrollY)
      heights = sections.map((s) => s.offsetHeight)
      sections.forEach((s, i) => s.toggleAttribute('data-flowing', !pinned[i]))
      const ends = sections.map((_, i) => {
        const c = contents[i]
        return !pinned[i] && c ? c.getBoundingClientRect().bottom + window.scrollY + 24 : tops[i] + heights[i]
      })
      Object.assign(model, { tops, heights, pinned, vh, ends, docEnd: Math.max(0, document.documentElement.scrollHeight - vh) })
      // Dokunmatik yapışma noktası: sabitlenen bölümde dinlenme anı (akıştaki bölümde bölümün kendisi yapışır).
      const stops = stopsOf(model)
      marks.forEach((mk, i) => {
        if (mk) mk.style.top = `${pinned[i] ? stops[i] - tops[i] : 0}px`
      })
      rest = SCENES.map((_, i) => boxFor(i, vw, vh))
      boxes.forEach((list, i) => {
        const b = rest[i]
        for (const n of list) {
          n.style.left = `${b.left}px`
          n.style.top = `${b.top}px`
          n.style.width = `${b.width}px`
          n.style.height = `${b.height}px`
          n.classList.toggle('is-window', b.window)
          n.dataset.fade = b.fade ?? 'both'
        }
      })
    }
    const update = () => {
      frame = 0
      if (tops.length !== SCENES.length) return
      const vh = window.innerHeight
      const ym = window.scrollY + vh / 2
      const mix = sceneMix(tops, ym, vh * 0.45)
      // Sabitlenen bölümler: ilerleme ve metin görünürlüğü (metin geçiş anında ekranda olmaz).
      // Metin: girişi süreye bağlı (sahne oturunca `data-in` ile sırayla belirir), çıkışı kaydırmaya bağlı (`--tvo`:
      // sonraki geçiş başlarken çekilir; geri kaydırmada aynı yoldan döner). `--tv`: ikisinin birleşimi (perde, harita).
      const pin = sections.map((s, i) => {
        // Sonraki sahnenin geçişi başlarken bu sahnenin içeriği çekilir (akıştaki bölümde de mühür/ışık düğmenin
        // arkasından geçmesin).
        const nextOut = 1 - ramp(mix.b[i + 1] ?? 0, 0, 0.3)
        let inn: number
        let out: number
        let p: number | null = null
        if (!pinned[i]) {
          inn = flowVisibility(tops[i] - window.scrollY, vh)
          out = nextOut
        } else {
          p = (window.scrollY - tops[i]) / Math.max(1, heights[i] - vh)
          inn = textIn(p, i === 0)
          out = Math.min(textOut(p), nextOut)
        }
        if (reduced) inn = out = 1
        const tv = Math.min(inn, out)
        tvs[i] = tv
        s.style.setProperty('--tv', tv.toFixed(3))
        s.style.setProperty('--tvo', out.toFixed(3))
        // Giriş eşiği çift yönlü: sahneye girerken bir kez tetiklenir, sahnenin önüne geri çıkınca sıfırlanır.
        if (!entered[i] && inn >= 0.6 && out > 0.5) entered[i] = true
        else if (entered[i] && inn <= 0.05) entered[i] = false
        s.toggleAttribute('data-in', entered[i])
        s.toggleAttribute('data-show', tv > 0.05)
        return p === null ? null : clamp01(p)
      })
      el.dataset.scene = String(mix.active + 1)
      const m = mix.b[6] ?? 0
      el.style.setProperty('--m', m.toFixed(4))
      if (merge) merge.style.visibility = !reduced && m > 0 && m < 1 ? 'visible' : 'hidden'
      let bloomOn = 0
      let sheenOn = 0
      // Harita işaretleri haritanın görünürlüğünü izler (4. sahne üstüne binince solar).
      el.style.setProperty('--map', (mix.b[2] * (1 - mix.b[3])).toFixed(4))
      const doc = document.documentElement
      bar.current?.style.setProperty('--story', clamp01(window.scrollY / Math.max(1, doc.scrollHeight - vh)).toFixed(4))
      bar.current?.toggleAttribute('data-solid', window.scrollY > 24)
      let shadeOn = 0
      let starsOn = 0
      layers.forEach((L, i) => {
        const vis = mix.visible[i]
        L.style.visibility = vis ? 'visible' : 'hidden'
        if (!vis) return
        const bIn = mix.b[i]
        const bOut = mix.b[i + 1] ?? 0
        const mIn = MATCH[i]
        const mOut = MATCH[i + 1]
        let opacity = bIn
        let tf: string
        let origin: string
        let feather = 0
        if (!reduced && mIn && bIn > 0 && bIn < 1) {
          // Bu sahne eşleştirmeli geçişle giriyor
          const a = anchor(i - 1, mIn.out)
          const mm = matchMove(mIn, bIn, a, anchor(i, mIn.in), 'in')
          opacity = smoothRange(bIn, mIn.fade[0], mIn.fade[1])
          const sc = rest[i].window ? mm.scale : coverScale(rest[i], mm.ox / 100, mm.oy / 100, mm.scale, mm.dx, mm.dy, window.innerWidth, vh)
          tf = `translate3d(${mm.dx.toFixed(1)}px, ${mm.dy.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`
          origin = `${mm.ox}% ${mm.oy}%`
          feather = mm.scale < 1 ? clamp01((1 - mm.scale) / 0.25) : 0
          const bump = Math.sin(Math.PI * bIn)
          if (mIn.shade) {
            // Gölge, iki figürün birlikte görünebileceği karışım penceresini tümüyle örter (hayalet figür olmasın).
            shadeOn = mIn.shade * Math.min(smoothRange(bIn, mIn.fade[0] - 0.16, mIn.fade[0] - 0.02), 1 - smoothRange(bIn, mIn.fade[1] + 0.02, mIn.fade[1] + 0.16))
            shade?.style.setProperty('transform', `translate3d(${mm.mx.toFixed(1)}px, ${mm.my.toFixed(1)}px, 0)`)
          }
          if (mIn.stars) starsOn = bump
          const at = `translate3d(${mm.mx.toFixed(1)}px, ${mm.my.toFixed(1)}px, 0)`
          if (mIn.bloom) {
            bloomOn = Math.sin(Math.PI * clamp01(bIn * 1.25))
            bloom?.style.setProperty('transform', at)
          }
          if (mIn.sheen) sheenOn = bump
          if (mIn.merge) merge?.style.setProperty('transform', at)
          // Dairesel açılım: gelen görsel ortak öğenin çevresinden (Bursa'nın ışığı) genişleyen bir daireyle görünür.
          for (const n of cams[i]) {
            n.classList.toggle('is-iris', !!mIn.iris)
            if (mIn.iris) {
              n.style.setProperty('--ix', `${mm.ox}%`)
              n.style.setProperty('--iy', `${mm.oy}%`)
              n.style.setProperty('--ir', `${(smoothRange(bIn, 0.04, 0.92) * 130).toFixed(2)}%`)
            }
          }
          if (mIn.iris) opacity = Math.max(opacity, smoothRange(bIn, 0.02, 0.12))
        } else if (!reduced && mOut && bOut > 0 && bOut < 1) {
          // Bu sahne eşleştirmeli geçişle çıkıyor (altta tam opak kalır)
          const mm = matchMove(mOut, bOut, anchor(i, mOut.out), anchor(i + 1, mOut.in), 'out')
          // Genişleyerek çıkan görsel ötelense de ekranı kaplar (kenarda ince şerit kalmasın); geri çekilen (2 → 3) kaplamaz.
          const sc = rest[i].window || mOut.outScale < 1 ? mm.scale : coverScale(rest[i], mm.ox / 100, mm.oy / 100, mm.scale, mm.dx, mm.dy, window.innerWidth, vh)
          tf = `translate3d(${mm.dx.toFixed(1)}px, ${mm.dy.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`
          origin = `${mm.ox}% ${mm.oy}%`
          // Belirgin biçimde geri çekilen görselin (2 → 3) kenarı geçişin başında erir; oval bir çerçeve gibi okunmasın.
          feather = mOut.outScale < 0.9 ? smoothRange(bOut, 0, 0.3) : 0
        } else {
          // Sahnede dururken hafif kayma; sabitlenen bölümde ilerlemeye, diğerlerinde konuma göre
          const u = pin[i] ?? clamp01((ym - tops[i]) / Math.max(1, heights[i]))
          const c = camera(i, pinned[i] ? 1 : bIn, pinned[i] && !pinned[i + 1] ? bOut : MATCH[i + 1] ? 0 : bOut, u, bursa)
          tf = reduced ? 'none' : `translate3d(${c.tx}%, ${c.ty.toFixed(3)}%, 0) scale(${c.scale.toFixed(4)})`
          origin = `${c.ox}% ${c.oy}%`
        }
        L.style.opacity = opacity.toFixed(4)
        // Okunurluk perdesi yalnızca metin ekrandayken: geçiş anında görüntü gereksiz kararmaz.
        const veil = veils[i]
        if (veil) veil.style.opacity = (reduced ? 1 : tvs[i]).toFixed(3)
        if (!(mIn?.iris && bIn > 0 && bIn < 1)) for (const n of cams[i]) n.classList.remove('is-iris')
        for (const n of cams[i]) {
          n.style.transform = reduced ? 'none' : tf
          n.style.transformOrigin = origin
          n.style.setProperty('--fe', feather.toFixed(3))
          n.classList.toggle('is-feather', feather > 0.001)
        }
      })
      if (shade) shade.style.opacity = shadeOn.toFixed(3)
      if (stars) stars.style.opacity = starsOn.toFixed(3)
      if (bloom) bloom.style.opacity = bloomOn.toFixed(3)
      el.style.setProperty('--sheen', sheenOn.toFixed(3))
      if (mix.active + 2 > need) {
        need = Math.min(SCENES.length, mix.active + 2)
        onNeed(need)
      }
    }
    function anchor(i: number, f: [number, number]) {
      const b = rest[i]
      return { x: b.left + f[0] * b.width, y: b.top + f[1] * b.height }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const relayout = () => {
      geometry()
      onScroll()
    }
    relayout()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', relayout)
    // Katalog ve kartlar gelince bölüm yükseklikleri değişir.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null
    ro?.observe(el)
    // Sahne içeriği (kartlar, yazı boyutu) değişince de yeniden ölçülür: sığmayan sahne akışa geçer.
    contents.forEach((c) => c && ro?.observe(c))
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', relayout)
      ro?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [root, bar, onNeed])
}

/**
 * Ana sayfanın 7 sahnelik hikâyesi: karşılama → yolculuk → Türkiye haritası → şehir → eserler → rehber → oyun ve final.
 * Kaydırma kilitlenmez; sahneler arasında sert kesme yoktur. Hareket azaltılmışsa yalnızca yumuşak geçiş kalır.
 */
export function StoryExperience({ cities, pilot, monuments, loading, error, reload, hasFilm, onFilm }: {
  cities: City[]; pilot: Pilot; monuments: MonumentSummary[]; loading: boolean; error: string | null; reload: () => void
  hasFilm: boolean; onFilm: () => void
}) {
  const { t } = useLang()
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLElement>(null)
  const [loadUpTo, setLoadUpTo] = useState(2)
  const onNeed = useRef((n: number) => setLoadUpTo((v) => Math.max(v, n))).current
  const model = useRef<StopModel>({ tops: [], heights: [], pinned: [], vh: 0, docEnd: 0 }).current
  useStoryEngine(root, bar, onNeed, model)
  useSceneNavigator(root, model)
  useReveal(root, monuments.length)
  return (
    <div ref={root} className="vk-x" data-scene="1">
      <Stage loadUpTo={loadUpTo} />
      <StoryBar barRef={bar} />
      <main className="vk-x__main" aria-label={t('VAKIFNAME tanıtım hikâyesi')}>
        <Scene1Welcome hasFilm={hasFilm} onFilm={onFilm} />
        <Scene2Journey />
        <Scene3Map cities={cities} pilot={pilot} />
        <Scene4City pilot={pilot} />
        <Scene5Monuments pilot={pilot} monuments={monuments} loading={loading} error={error} reload={reload} />
        <Scene6Guide />
        <Scene7Game pilot={pilot} />
        <StoryFinal />
      </main>
    </div>
  )
}
