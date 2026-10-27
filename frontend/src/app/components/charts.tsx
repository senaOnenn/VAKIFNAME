import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react'
import './charts.css'

/** Grafik işaret rengi: palet A altını, koyu yüzeyde açıklık bandı ve 3:1 kontrast doğrulandı (dataviz validator). */
export const MARK = '#B08A3A'
const GRID = '#2a3170'

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mn` : n >= 1000 ? `${(n / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} B` : n.toLocaleString('tr-TR')
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function niceMax(v: number): number {
  if (v <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!
}

/** KPI kutucuğu: etiket + değer (orantılı rakamlar). */
export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="vk-stat">
      <span className="vk-stat__label">{label}</span>
      <span className="vk-stat__value">{compact(value)}</span>
    </div>
  )
}

/**
 * Tek seri zaman çizgisi (alan dolgusu %10). Tek seri olduğu için lejant yok; başlık neyin çizildiğini söyler.
 * İmleç çizgisi en yakın güne oturur; klavyede ← → ile gezilir. Değerler tablo görünümünde de vardır.
 */
export function LineChart({ points, label }: { points: { day: string; value: number }[]; label: string }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 720
  const H = 220
  const L = 40
  const R = 44
  const T = 14
  const B = 26
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)))
  const x = (i: number) => L + (points.length <= 1 ? 0 : (i * (W - L - R)) / (points.length - 1))
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`
  const ticks = [0, max / 2, max]
  const last = points.length - 1
  const pick = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(last, Math.round(((px - L) / (W - L - R)) * last))))
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last + 1) - 1))
    else return
    e.preventDefault()
  }
  const h = hover !== null ? points[hover] : null
  return (
    <div className="vk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-d`}>
        <desc id={`${id}-d`}>{`${label}: ${points.length} gün, en yüksek ${Math.max(0, ...points.map((p) => p.value))}`}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="vk-chart__tick">{compact(t)}</text>
          </g>
        ))}
        {[0, Math.floor(last / 2), last].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} className="vk-chart__tick">
            {points[i] && shortDate(points[i].day)}
          </text>
        ))}
        <path d={area} fill={MARK} opacity="0.1" />
        <path d={line} fill="none" stroke={MARK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {last >= 0 && (
          <>
            <circle cx={x(last)} cy={y(points[last].value)} r="4" fill={MARK} stroke="var(--vk-surface)" strokeWidth="2" />
            <text x={x(last) + 8} y={y(points[last].value) + 4} className="vk-chart__label">{compact(points[last].value)}</text>
          </>
        )}
        {h && (
          <g aria-hidden="true">
            <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={y(0)} stroke="var(--vk-ivory-dim)" strokeWidth="1" />
            <circle cx={x(hover!)} cy={y(h.value)} r="5" fill={MARK} stroke="var(--vk-surface)" strokeWidth="2" />
          </g>
        )}
        <rect
          x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" tabIndex={0}
          aria-label={`${label}. Günleri gezmek için sol ve sağ ok tuşları.`}
          onPointerMove={pick} onPointerLeave={() => setHover(null)} onFocus={() => setHover(last)} onBlur={() => setHover(null)} onKeyDown={key}
        />
      </svg>
      {h && (
        <div className="vk-chart__tip" style={{ left: `${(x(hover!) / W) * 100}%` }} role="status">
          <strong>{h.value.toLocaleString('tr-TR')}</strong>
          <span>{shortDate(h.day)}</span>
        </div>
      )}
    </div>
  )
}

/** Yatay çubuklar (büyüklük, tek renk): değer çubuğun ucunda; çubuk ≤ 24 px, uçta 4 px yuvarlak, tabanda düz. */
export function BarChart({ rows, label }: { rows: { name: string; value: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...rows.map((r) => r.value))
  const W = 720
  const NAME = 210
  const VAL = 56
  const ROW = 34
  const BAR = 20
  const H = rows.length * ROW
  const len = (v: number) => ((W - NAME - VAL) * v) / max
  const bar = (x0: number, y0: number, w: number) => {
    const r = Math.min(4, w)
    return `M${x0},${y0} H${x0 + w - r} Q${x0 + w},${y0} ${x0 + w},${y0 + r} V${y0 + BAR - r} Q${x0 + w},${y0 + BAR} ${x0 + w - r},${y0 + BAR} H${x0} Z`
  }
  return (
    <div className="vk-chart">
      <svg viewBox={`0 0 ${W} ${Math.max(H, 1)}`} role="img" aria-label={label}>
        <line x1={NAME} x2={NAME} y1="0" y2={H} stroke={GRID} strokeWidth="1" />
        {rows.map((r, i) => {
          const y0 = i * ROW + (ROW - BAR) / 2
          const w = Math.max(2, len(r.value))
          return (
            <g key={r.name} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${r.name}: ${r.value}`}>
              <rect x="0" y={i * ROW} width={W} height={ROW} fill="transparent" />
              <text x={NAME - 10} y={y0 + BAR / 2 + 5} textAnchor="end" className="vk-chart__name">{r.name}</text>
              <path d={bar(NAME, y0, w)} fill={MARK} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={NAME + w + 8} y={y0 + BAR / 2 + 5} className="vk-chart__label">{r.value.toLocaleString('tr-TR')}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
