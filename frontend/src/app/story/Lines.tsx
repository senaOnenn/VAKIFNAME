import { useLayoutEffect, useRef } from 'react'

/**
 * Satır satır beliren metin. Metin gerçek HTML olarak kalır (seçilebilir, ekran okuyucu düz cümle okur); yalnızca
 * sözcükler görünmez bir `span` içindedir. Yerleşimden sonra her sözcüğün satırı ölçülür ve `--ln` (satır sırası) yazılır;
 * CSS aynı satırdaki sözcükleri birlikte, satırları kısa aralıklarla gösterir (kelime kelime yazma efekti değildir).
 * Boyut değişince yeniden ölçülür.
 */
export function Lines({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      let line = -1
      let top = -Infinity
      for (const w of el.querySelectorAll<HTMLElement>('.vk-w')) {
        if (w.offsetTop > top + 2) {
          line++
          top = w.offsetTop
        }
        w.style.setProperty('--ln', String(line))
      }
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [text])
  const words = text.split(/(\s+)/)
  return (
    <span ref={ref} className="vk-lines">
      {words.map((w, i) => (/^\s+$/.test(w) ? w : <span key={i} className="vk-w">{w}</span>))}
    </span>
  )
}
