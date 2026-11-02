import { useEffect, type RefObject } from 'react'
import { prefersReducedMotion } from './common'
import { nextStop, stopsOf, type StopModel } from './engine'

/**
 * Tek kaydırma = bir sahne. Motorla aynı durak modelini (StopModel) kullanır; geçişin kendisi kaydırma konumuna bağlı
 * zaman çizelgesinde oynar, burada yalnızca hedef durağa yumuşak bir kaydırma yapılır. Geçiş bir "yürüyüş" temposunda
 * ilerler (2,3–2,7 sn, yavaş kalkış ve uzun varış); vardıktan sonra sahne kısa bir süre (DWELL_MS) oturur.
 *
 * - Fare tekerleği ve dokunmatik yüzey: aynı yöndeki küçük hareketler toplanır; eşik aşılınca bir sonraki durağa gidilir.
 *   Gidiş sürerken ve ardından hareket ~220 ms durulana kadar gelen olaylar (dokunmatik yüzeyin atalet kuyruğu, hızlı
 *   çevrilen teker) yutulur: tek hareket iki-üç sahne atlatmaz. Yatay ağırlıklı hareket (kart şeridi) ve Ctrl+teker
 *   (yakınlaştırma) karışmaz. İçeriği ekrandan uzun (akıştaki) sahnede, içerik bitene kadar yerel kaydırma sürer.
 * - Klavye: ↓ PageDown Boşluk / ↑ PageUp Shift+Boşluk / Home End; yazı alanında, düğmede (Boşluk) ve yatay oklarda
 *   karışmaz. Gidişten sonra odak yeni sahnenin başlığına taşınır.
 * - Dokunmatik ekran: parmak hareketi sırasında kaydırma yereldir (müdahale yok). Parmak kalkınca dikey hareket ≥ 40 px
 *   ise yönündeki bir sonraki durağa gidilir (kısa bir kaydırma da sahne değiştirir; uzun kaydırma iki sahne atlamaz).
 *   Yatay hareket (kart şeridi), yazı alanı ve uzun içerikli sahnenin içi karışmaz. Yedek olarak CSS scroll-snap
 *   duraklara yapıştırır (`scroll-snap-stop: always`).
 * - Hareket azaltılmışsa hiçbiri devrede değildir: düz, kilitsiz sayfa kaydırması.
 */
const THRESHOLD = 30
const QUIET_MS = 220
/**
 * Geçiş süreleri (ms), hedef durağa göre: 1 → 2 … 6 → 7, 7 → final. Tarihî bir yürüyüş temposu: kısa bir geçiş kesik
 * durmasın, uzun geçiş beklemesin. Görev 36D'de 0,85–1,3 sn idi.
 */
const DURATIONS = [0, 2400, 2700, 2700, 2300, 2500, 2700, 1700]
/** Varıştan sonra sahnenin "oturma" süresi: bu süre içinde gelen yeni hareket sahneyi değiştirmez (ms). */
const DWELL_MS = 1400

/**
 * "Yürüyüş" eğrisi, cubic-bezier(0.55, 0, 0.2, 1): yavaş kalkış (eski metin bu sırada usulca çekilir), sakin bir orta,
 * uzun bir varış (sahne yerine oturur, yeni metin ancak sonra belirir). Sabit hızlı ya da yaylanan bir hareket yok.
 */
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
const ease = bezier(0.55, 0, 0.2, 1)

function editable(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null
  if (!e || !e.closest) return false
  return !!e.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

export function useSceneNavigator(root: RefObject<HTMLElement | null>, model: StopModel) {
  useEffect(() => {
    const el = root.current
    if (!el || prefersReducedMotion()) return
    const html = document.documentElement
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
    if (coarse) html.classList.add('vk-snap')

    let anim = 0
    let animating = false
    let arrivedAt = -Infinity
    let blocking = false
    let lastWheel = 0
    let acc = 0
    let accT = 0

    function goTo(y: number, focus = false) {
      cancelAnimationFrame(anim)
      const from = window.scrollY
      const stops = stopsOf(model)
      const k = stops.indexOf(y)
      const fromK = stops.findIndex((s) => Math.abs(s - from) < 3)
      // Komşu durak: o geçişin süresi. Uzak sıçrama (Home/End) ya da durak dışından: kısa bir yolculuk.
      const dur = k > 0 && fromK >= 0 && Math.abs(k - fromK) === 1 ? DURATIONS[Math.max(k, fromK)] : 1600
      const t0 = performance.now()
      animating = true
      // Dokunmatik yapışma tween sırasında hedefi bozmasın.
      if (coarse) html.classList.remove('vk-snap')
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur)
        window.scrollTo(0, from + (y - from) * ease(t))
        if (t < 1) anim = requestAnimationFrame(step)
        else {
          animating = false
          arrivedAt = performance.now()
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
    function focusScene(y: number) {
      const k = stopsOf(model).indexOf(y)
      const s = el!.querySelectorAll<HTMLElement>('section[data-scene]')[k]
      const target = s?.querySelector<HTMLElement>('[data-focus-target], h1, h2') ?? (k >= 7 ? el!.querySelector<HTMLElement>('.vk-final__slogan') : null)
      if (!target) return
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }
    function go(dir: 1 | -1, focus = false): boolean {
      if (!model.tops.length) return false
      // Sahne yeni oturduysa (metinler beliriyor) hareket yutulur: her sahnenin kısa bir "ana anı" olur.
      if (performance.now() - arrivedAt < DWELL_MS && nextStop(model, window.scrollY, dir) !== null) return true
      const y = nextStop(model, window.scrollY, dir)
      if (y === null) return false
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
      lastWheel = now
      if (animating || (blocking && gap < QUIET_MS)) {
        e.preventDefault()
        return
      }
      blocking = false
      const dir: 1 | -1 = dy > 0 ? 1 : -1
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
        return
      }
      if (go(dir, true)) e.preventDefault()
    }
    let touch: { x: number; y: number; ignore: boolean } | null = null
    const onTouchStart = (e: TouchEvent) => {
      stop()
      const t = e.touches[0]
      touch = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, ignore: editable(e.target) } : null
    }
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const s0 = touch
      touch = null
      if (!s0 || !t || s0.ignore || e.touches.length) return
      const dy = s0.y - t.clientY
      const dx = s0.x - t.clientX
      if (Math.abs(dy) < 40 || Math.abs(dx) > Math.abs(dy)) return
      go(dy > 0 ? 1 : -1)
    }
    const onPointer = () => stop()

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    window.addEventListener('touchstart', onTouchStart, { passive: true })
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
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('mousedown', onPointer)
      delete w.__vkGoto
    }
  }, [root, model])
}
