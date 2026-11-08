import { useEffect, type RefObject } from 'react'
import { prefersReducedMotion } from './common'
import { nextStop, stopsOf, tripEase, type StopModel } from './engine'

/**
 * Tek kaydırma = bir sahne. Motorla aynı durak modelini (StopModel) kullanır; geçişin kendisi kaydırma konumuna bağlı
 * zaman çizelgesinde oynar, burada yalnızca hedef durağa yumuşak bir kaydırma yapılır. Geçiş tarihî bir gezinin
 * temposunda ilerler (3,1–3,6 sn): eski sahnenin metni kademeli çekilirken kamera yavaşça kalkar, iki görselin geçişi
 * okunur bir hızla oynar, yeni sahne uzun bir varışla yerine oturur (bkz. `tripEase`). Vardıktan sonra sahne kısa bir
 * süre (DWELL_MS) oturur.
 *
 * - Fare tekerleği ve dokunmatik yüzey: aynı yöndeki küçük hareketler toplanır; eşik aşılınca bir sonraki durağa gidilir.
 *   Gidiş sürerken ve ardından hareket ~220 ms durulana kadar aynı yönde gelen olaylar (dokunmatik yüzeyin atalet
 *   kuyruğu, hızlı çevrilen teker) yutulur: tek hareket iki-üç sahne atlatmaz. Gidiş sürerken ters yönde yeni bir
 *   hareket yolculuğu geri çevirir (kullanıcı uzun geçişe kilitlenmez). Yatay ağırlıklı hareket (kart şeridi) ve
 *   Ctrl+teker (yakınlaştırma) karışmaz. İçeriği ekrandan uzun (akıştaki) sahnede, içerik bitene kadar yerel kaydırma
 *   sürer.
 * - Klavye: ↓ PageDown Boşluk / ↑ PageUp Shift+Boşluk / Home End; yazı alanında, düğmede (Boşluk) ve yatay oklarda
 *   karışmaz. Bilinçli tuş basışı oturma süresini beklemez (yalnızca basılı tutulan tuşun tekrarı bekler); gidiş
 *   sürerken ters yön tuşu geri çevirir. Gidişten sonra odak yeni sahnenin başlığına taşınır.
 * - Dokunmatik ekran (8 Kasım): teker gibi, sabit sahnede dikey parmak hareketi sayfayı kaydırmaz, yalnızca yön verir
 *   (tarayıcının atalet kaydırması gidişle çekişip görüntüyü titretmesin). Parmak kalkınca dikey hareket ≥ 40 px ise
 *   yönündeki bir sonraki durağa gidilir (kısa bir kaydırma da sahne değiştirir; uzun kaydırma iki sahne atlamaz).
 *   Geçiş sırasında ekrana yalnızca dokunulursa geçiş yarıda kalmaz, hedefine tamamlanır. Yatay hareket (kart şeridi),
 *   yazı alanı ve uzun içerikli sahnenin içi yereldir (tarayıcı kaydırır, gidiş başlamaz). Yedek olarak CSS
 *   scroll-snap duraklara yapıştırır (`scroll-snap-stop: always`).
 * - Hareket azaltılmışsa hiçbiri devrede değildir: düz, kilitsiz sayfa kaydırması.
 */
const THRESHOLD = 30
const QUIET_MS = 220
/**
 * Geçiş süreleri (ms), hedef durağa göre: 1 → 2 … 5 → 6 (R6.2: final durağı yok). Görev 36D'de 0,85–1,3 sn, 36E başında 2,3–2,7 sn
 * idi; o sürelerde görsel geçişi ~0,5 sn'ye sıkışıyor, sahne değişimi slayt gibi okunuyordu. Haritadan Bursa'ya iniş
 * (2 → 3, altın ışıkla açılım) en uzunudur.
 */
const DURATIONS = [0, 3500, 3600, 3100, 3300, 3400]
/** Uzak sıçrama (Home/End, menüden sahneye) ve bilinmeyen konumdan gidiş. */
const FAR_MS = 2200
/** Yarıda kalan yoldan (dokunuşla durdurulan geçiş, akıştaki sahnenin sonu) gidişin ve geri dönüşün alt sınırı. */
const MIN_MS = 1100
/**
 * Varıştan sonra sahnenin "oturma" süresi: bu süre içinde aynı yönde gelen yeni hareket sahneyi değiştirmez (ms).
 * Yalnızca atalet ve fazladan çevrilen tekeri yutar; ters yön (geri dönmek) ve bilinçli tuş basışı hemen çalışır.
 */
const DWELL_MS = 1400
/** Geri çevirmeden sonra yeni bir çevirme için bekleme (ms): titreyen tekerde yolculuk ileri-geri salınmasın. */
const TURN_GUARD_MS = 450

/** Kübik Bézier zamanlama eğrisi (CSS `cubic-bezier` ile aynı). */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const A = (a: number, b: number) => 1 - 3 * b + 3 * a
  const B = (a: number, b: number) => 3 * b - 6 * a
  const C = (a: number) => 3 * a
  const at = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t
  const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a)
  return (x: number) => {
    if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const d = at(t, x1, x2) - x
      const s = slope(t, x1, x2)
      if (Math.abs(d) < 1e-5 || s === 0) break
      t -= d / s
    }
    return at(Math.min(1, Math.max(0, t)), y1, y2)
  }
}
/**
 * Düz "yürüyüş" eğrisi, cubic-bezier(0.55, 0, 0.2, 1): yavaş kalkış, sakin orta, uzun varış. Sahne sınırı belli olmayan
 * gidişlerde (uzak sıçrama) kullanılır; komşu sahneler arasında `tripEase` süreyi aşamalara dağıtır.
 */
const walk = bezier(0.55, 0, 0.2, 1)
/** Geri çevirme: hareket hâlindeki sahne usulca geri döner (sert bir duruş-kalkış olmasın). */
const turn = bezier(0.3, 0, 0.2, 1)

function editable(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null
  if (!e || !e.closest) return false
  // Açık pencere (<dialog>: Oyun Nasıl Oynanır, tanıtım filmi) kendi içinde kayar; sahne gezgini devreye girmez.
  return !!e.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog')
}

interface Trip {
  from: number
  to: number
  dir: 1 | -1
  dur: number
  focus: boolean
}

export function useSceneNavigator(root: RefObject<HTMLElement | null>, model: StopModel) {
  useEffect(() => {
    const el = root.current
    if (!el || prefersReducedMotion()) return
    const html = document.documentElement
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
    if (coarse) html.classList.add('vk-snap')
    const zone = () => (window as unknown as { __vkZone?: number }).__vkZone ?? 0.45

    let anim = 0
    let animating = false
    let trip: Trip | null = null
    let arrivedAt = -Infinity
    let arrivedDir: 1 | -1 = 1
    let turnedAt = -Infinity
    let blocking = false
    let lastWheel = 0
    let lastWheelDir: 1 | -1 = 1
    let acc = 0
    let accT = 0

    /** Gidişin süresi: komşu durağa o geçişin süresi; durak dışından kalan yolla orantılı; uzak sıçramada FAR_MS. */
    function durationFor(from: number, y: number): number {
      const stops = stopsOf(model)
      const k = stops.indexOf(y)
      const fromK = stops.findIndex((s) => Math.abs(s - from) < 3)
      if (k < 0) return FAR_MS
      if (fromK >= 0) return Math.abs(k - fromK) === 1 ? DURATIONS[Math.max(k, fromK)] ?? FAR_MS : FAR_MS
      // Durak dışından: hedefin bu yandaki komşu durağıyla arasındaki geçişin süresi, kalan yol oranında.
      const nb = y > from ? k - 1 : k + 1
      const span = nb >= 0 && nb < stops.length ? Math.abs(stops[k] - stops[nb]) : 0
      const dist = Math.abs(y - from)
      if (!span || dist > span * 1.05) return FAR_MS
      const base = DURATIONS[Math.max(k, nb)] ?? FAR_MS
      return Math.min(base, Math.max(MIN_MS, base * Math.sqrt(dist / span)))
    }

    function goTo(y: number, focus = false, opts: { dur?: number; turning?: boolean } = {}) {
      cancelAnimationFrame(anim)
      const from = window.scrollY
      if (Math.abs(y - from) < 1) {
        animating = false
        if (focus) focusScene(y)
        return
      }
      const dur = opts.dur ?? durationFor(from, y)
      // Komşu sahneler arası: süre metin çıkışına, görsel geçişine ve varışa dağılır. Geri çevirmede yumuşak dönüş.
      const curve = opts.turning ? turn : tripEase(model, from, y, zone()) ?? walk
      const t0 = performance.now()
      animating = true
      trip = { from, to: y, dir: y > from ? 1 : -1, dur, focus }
      // Dokunmatik yapışma tween sırasında hedefi bozmasın.
      if (coarse) html.classList.remove('vk-snap')
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur)
        window.scrollTo(0, from + (y - from) * curve(t))
        if (t < 1) anim = requestAnimationFrame(step)
        else {
          animating = false
          arrivedAt = performance.now()
          arrivedDir = trip?.dir ?? 1
          trip = null
          if (coarse) html.classList.add('vk-snap')
          if (focus) focusScene(y)
        }
      }
      anim = requestAnimationFrame(step)
    }
    function stop() {
      if (!animating) return
      cancelAnimationFrame(anim)
      animating = false
      if (coarse) html.classList.add('vk-snap')
    }
    /** Süren yolculuğu ayrıldığı durağa geri çevirir; dönüş süresi o ana dek alınan yolla orantılıdır. */
    function turnBack(): boolean {
      const now = performance.now()
      if (!animating || !trip || now - turnedAt < TURN_GUARD_MS) return false
      const { from, to, dur, focus } = trip
      const done = Math.abs(window.scrollY - from) / Math.max(1, Math.abs(to - from))
      turnedAt = now
      goTo(from, focus, { dur: Math.min(dur, Math.max(MIN_MS, dur * done)), turning: true })
      return true
    }
    function focusScene(y: number) {
      const k = stopsOf(model).indexOf(y)
      const s = el!.querySelectorAll<HTMLElement>('section[data-scene]')[k]
      const target = s?.querySelector<HTMLElement>('[data-focus-target], h1, h2') ?? null
      if (!target) return
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }
    /** `settle`: sahne yeni oturduysa aynı yöndeki hareket yutulur (her sahnenin kısa bir "ana anı" olur). */
    function go(dir: 1 | -1, focus = false, settle = true): boolean {
      if (!model.tops.length) return false
      const y = nextStop(model, window.scrollY, dir)
      if (y === null) return false
      if (settle && dir === arrivedDir && performance.now() - arrivedAt < DWELL_MS) return true
      goTo(y, focus)
      return true
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || editable(e.target)) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
      const dy = e.deltaY * unit
      const dx = e.deltaX * unit
      if (Math.abs(dx) > Math.abs(dy) || dy === 0) return // yatay: kart şeridi
      const now = performance.now()
      const gap = now - lastWheel
      const dir: 1 | -1 = dy > 0 ? 1 : -1
      const fresh = dir !== lastWheelDir || gap >= QUIET_MS
      lastWheel = now
      lastWheelDir = dir
      if (animating) {
        e.preventDefault()
        // Aynı yöndeki atalet kuyruğu yutulur; ters yönde yeni bir hareket yolculuğu geri çevirir.
        if (trip && dir !== trip.dir) {
          if (fresh || Math.sign(acc) !== dir) acc = 0
          acc += dy
          if (Math.abs(acc) >= THRESHOLD && turnBack()) {
            acc = 0
            blocking = true
          }
        }
        return
      }
      if (blocking && !fresh) {
        e.preventDefault()
        return
      }
      blocking = false
      // Akıştaki sahnede içerik bitmediyse yerel kaydırma
      if (nextStop(model, window.scrollY, dir) === null && !atEdge(dir)) return
      e.preventDefault()
      if (Math.sign(acc) !== dir || now - accT > 200) acc = 0
      acc += dy
      accT = now
      if (Math.abs(acc) >= THRESHOLD) {
        acc = 0
        blocking = true
        go(dir)
      }
    }
    // Sayfanın başında yukarı / sonunda aşağı: yapacak bir şey yok (olay yutulmaz).
    const atEdge = (dir: 1 | -1) => (dir < 0 ? window.scrollY <= 0 : window.scrollY >= model.docEnd - 1)

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || editable(e.target)) return
      const t = e.target as HTMLElement | null
      const onControl = !!t?.closest?.('button, a, summary, [role="radio"], [role="tab"]')
      let dir: 1 | -1 | 0 = 0
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey && !onControl)) dir = 1
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey && !onControl)) dir = -1
      else if (e.key === 'Home' || e.key === 'End') {
        const stops = stopsOf(model)
        e.preventDefault()
        goTo(e.key === 'Home' ? stops[0] : stops[stops.length - 1], true)
        return
      }
      if (!dir) return
      if (animating) {
        e.preventDefault()
        if (!e.repeat && trip && dir !== trip.dir) turnBack()
        return
      }
      if (go(dir, true, e.repeat)) e.preventDefault()
    }
    /**
     * `lock`: hareketin ilk adımında bir kez karar verilir. `block`: parmak sayfayı kaydırmaz (yalnızca yön verir), gidiş
     * parmak kalkınca oynar. `native`: tarayıcı kaydırır (yatay kart şeridi, akıştaki sahnenin içi).
     */
    let touch: { x: number; y: number; ignore: boolean; resume: Trip | null; lock: 'block' | 'native' | null } | null = null
    const onTouchStart = (e: TouchEvent) => {
      // Geçiş sırasında dokunuş geçişi durdurur; parmak kaydırmadan kalkarsa geçiş hedefine tamamlanır (yarıda kalmaz).
      const resume = animating ? trip : null
      stop()
      const t = e.touches[0]
      touch = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, ignore: editable(e.target), resume, lock: null } : null
    }
    // 8 Kasım: parmak sayfayı kendisi kaydırıp kalkınca tarayıcının atalet kaydırması ile gidişin `scrollTo` adımları
    // birkaç kare çekişiyordu (ölçüm: her kaldırışta 15–20 px geri sıçrama, ardından ~250 ms ±1–2 px titreme; görseller
    // kaydırma konumuna bağlı olduğu için onlar da titriyordu). Teker gibi: sabit sahnede dikey hareket engellenir.
    const onTouchMove = (e: TouchEvent) => {
      const s0 = touch
      const t = e.touches[0]
      if (!s0 || s0.ignore || !t || e.touches.length !== 1) return
      if (!s0.lock) {
        const dy = s0.y - t.clientY
        const dx = s0.x - t.clientX
        if (!dx && !dy) return
        const dir: 1 | -1 = dy > 0 ? 1 : -1
        const local = Math.abs(dx) > Math.abs(dy) || (nextStop(model, window.scrollY, dir) === null && !atEdge(dir))
        s0.lock = local ? 'native' : 'block'
      }
      if (s0.lock === 'block' && e.cancelable) e.preventDefault()
    }
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const s0 = touch
      touch = null
      if (!s0 || !t || e.touches.length) return
      const dy = s0.y - t.clientY
      const dx = s0.x - t.clientX
      const swipe = !s0.ignore && Math.abs(dy) >= 40 && Math.abs(dx) <= Math.abs(dy)
      // Sayfayı tarayıcı kaydırdıysa (akıştaki sahne) gidiş başlamaz: atalet kaydırmasıyla çekişmesin, yapışma tamamlar.
      if (swipe && s0.lock === 'native') return
      if (!swipe) {
        const r = s0.resume
        if (r) {
          const left = Math.abs(r.to - window.scrollY) / Math.max(1, Math.abs(r.to - r.from))
          goTo(r.to, r.focus, { dur: Math.min(r.dur, Math.max(MIN_MS, r.dur * left)), turning: true })
        }
        return
      }
      // Engellenen kaydırma bilinçli bir harekettir (atalet kuyruğu yok): tuş basışı gibi oturma süresini beklemez.
      go(dy > 0 ? 1 : -1, false, false)
    }
    // Kaydırma çubuğu sürüklenince gidiş durur; sayfanın içine tıklamak süren geçişi yarıda bırakmaz.
    const onPointer = (e: MouseEvent) => {
      if (e.clientX >= html.clientWidth) stop()
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('mousedown', onPointer)
    // Sahne içindeki bağlantılar (Keşfe Başla, Bursa, Eserleri Keşfet) aynı gidişi kullanır.
    const w = window as unknown as { __vkGoto?: (id: string) => boolean }
    w.__vkGoto = (id: string) => {
      const sections = [...el.querySelectorAll<HTMLElement>('section[data-scene]')]
      const k = sections.findIndex((s) => s.id === id)
      if (k < 0 || !model.tops.length) return false
      goTo(stopsOf(model)[k], true)
      return true
    }
    return () => {
      stop()
      html.classList.remove('vk-snap')
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('mousedown', onPointer)
      delete w.__vkGoto
    }
  }, [root, model])
}
