import type { SVGProps } from 'react'

/**
 * VAKIFNAME dijital mührü. Özgün, soyut bir tasarımdır: dış halkada sekiz köşeli yıldız ve dilimli kenar,
 * ortada kemer motifi. Tarihî bir vakıf mührünü taklit etmez ve belirli bir esere ait değildir.
 */
export function Seal({ earned = true, className, ...props }: SVGProps<SVGSVGElement> & { earned?: boolean }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      {...props}
      className={['seal', earned ? '' : 'seal--empty', className].filter(Boolean).join(' ')}
    >
      <circle className="seal__rim" cx="60" cy="60" r="56" />
      <circle className="seal__ring" cx="60" cy="60" r="48" />
      <path
        className="seal__star"
        d="M60 22l9.6 15.2 17.5-4.4-4.4 17.5L98 60l-15.3 9.7 4.4 17.4-17.5-4.4L60 98l-9.6-15.3-17.5 4.4 4.4-17.4L22 60l15.3-9.7-4.4-17.5 17.5 4.4z"
      />
      <path className="seal__arch" d="M48 76V60a12 12 0 0 1 24 0v16M44 76h32" />
    </svg>
  )
}
