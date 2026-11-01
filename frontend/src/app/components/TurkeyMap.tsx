import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { cityNote, type City } from '../cities'
import { gamePath } from '../gameCity'
import { useLang } from '../i18n'
import { TURKEY_PATH, TURKEY_VIEWBOX, project } from './turkeyOutline'
import './turkey-map.css'

// Etiketlerin birbirine binmemesi için şehir başına küçük kaydırma (izdüşüm birimi).
const LABEL_OFFSET: Record<string, { dx: number; dy: number; anchor: 'start' | 'end' }> = {
  bursa: { dx: 14, dy: -12, anchor: 'start' },
  izmir: { dx: -12, dy: 6, anchor: 'end' },
  manisa: { dx: 12, dy: -8, anchor: 'start' },
}

/** Türkiye haritası: açık şehir parlayan altın işaret ve bağlantı, diğerleri soluk ("yakında"). */
export function TurkeyMap({ cities }: { cities: City[] }) {
  const id = useId()
  const navigate = useNavigate()
  const { t } = useLang()
  const open = cities.filter((c) => c.open).map((c) => c.name).join(', ')
  return (
    <figure className="vk-tmap">
      <svg viewBox={TURKEY_VIEWBOX} role="group" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{t('Türkiye haritası: {open} açık, diğer şehirler yakında', { open: open || t('henüz açık şehir yok') })}</title>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#232b66" />
            <stop offset="1" stopColor="#141a45" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id={`${id}-dots`} width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="#8fa2ff" opacity="0.25" />
          </pattern>
        </defs>
        <path d={TURKEY_PATH} fill={`url(#${id}-fill)`} />
        <path d={TURKEY_PATH} fill={`url(#${id}-dots)`} />
        <path d={TURKEY_PATH} className="vk-tmap__outline" filter={`url(#${id}-glow)`} />
        {cities.map((c) => {
          const { x, y } = project(c.lat, c.lng)
          const o = LABEL_OFFSET[c.slug] ?? { dx: 12, dy: -10, anchor: 'start' as const }
          const label = (
            <text x={x + o.dx} y={y + o.dy} textAnchor={o.anchor} className="vk-tmap__label">
              {c.name}
            </text>
          )
          if (!c.open) {
            return (
              <g key={c.slug} className="vk-tmap__city vk-tmap__city--soon" aria-hidden="true">
                <circle cx={x} cy={y} r="5" />
                {label}
              </g>
            )
          }
          return (
            <a
              key={c.slug}
              href={gamePath.route(c.slug)}
              className="vk-tmap__city vk-tmap__city--open"
              aria-label={`${c.name}: ${cityNote(c, t)}`}
              onClick={(e) => {
                e.preventDefault()
                navigate(gamePath.route(c.slug))
              }}
            >
              <circle className="vk-tmap__pulse" cx={x} cy={y} r="10" />
              <circle cx={x} cy={y} r="8" />
              {label}
            </a>
          )
        })}
      </svg>
    </figure>
  )
}
