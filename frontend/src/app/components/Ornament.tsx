import { useId } from 'react'

/** Çok uçlu yıldız (girih esinli): iki katman, halka ve merkez nokta. Süs amaçlıdır, ekran okuyucudan gizlidir. */
function starPoints(points: number, outer: number, inner: number, cx: number, cy: number, rotate = 0): string {
  const out: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI * i) / points - Math.PI / 2 + rotate
    out.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return out.join(' ')
}

export function Ornament({ className = '' }: { className?: string }) {
  const id = useId()
  return (
    <svg className={className} viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9c874" />
          <stop offset="0.55" stopColor="#c9a24b" />
          <stop offset="1" stopColor="#8a6a22" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${id}-g)`} strokeWidth="1.4" strokeLinejoin="round">
        <circle cx="200" cy="200" r="192" opacity="0.55" />
        <circle cx="200" cy="200" r="176" opacity="0.35" />
        <polygon points={starPoints(16, 188, 150, 200, 200)} />
        <polygon points={starPoints(8, 150, 96, 200, 200, Math.PI / 8)} />
        <polygon points={starPoints(8, 112, 70, 200, 200)} opacity="0.85" />
        <circle cx="200" cy="200" r="38" />
      </g>
    </svg>
  )
}

/** İnce altın ayraç: ortada küçük elmas. */
export function GoldRule({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 12" aria-hidden="true" focusable="false">
      <line x1="0" y1="6" x2="104" y2="6" stroke="#c9a24b" strokeWidth="1" />
      <line x1="136" y1="6" x2="240" y2="6" stroke="#c9a24b" strokeWidth="1" />
      <polygon points="120,0 126,6 120,12 114,6" fill="#e9c874" />
    </svg>
  )
}
