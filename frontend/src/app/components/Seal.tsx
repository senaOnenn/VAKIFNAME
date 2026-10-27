import { useId } from 'react'
import './seal.css'

export type SealKind = 'empty' | 'knowledge' | 'gold'

/** Mühür: boş (henüz yok), bilgi mührü (indigo) veya ziyaretle altın mühür. `stamp` basılma animasyonunu oynatır. */
export function Seal({ kind, label, stamp = false, size = 96 }: { kind: SealKind; label: string; stamp?: boolean; size?: number }) {
  const id = useId()
  return (
    <span className={`vk-seal vk-seal--${kind}${stamp ? ' vk-seal--stamp' : ''}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor={kind === 'gold' ? '#fff3cf' : '#8fa2ff'} />
            <stop offset="0.5" stopColor={kind === 'gold' ? '#e9c874' : '#4a5bff'} />
            <stop offset="1" stopColor={kind === 'gold' ? '#8a6a22' : '#232b66'} />
          </radialGradient>
        </defs>
        <path
          className="vk-seal__rim"
          d="M50 3 L58 9 L68 7 L72 16 L82 18 L82 28 L90 34 L86 43 L92 51 L86 59 L89 68 L80 73 L78 83 L68 83 L61 91 L52 86 L43 92 L36 84 L26 85 L23 75 L14 71 L16 61 L9 53 L15 45 L10 36 L18 30 L18 20 L28 17 L32 8 L42 9 Z"
          fill={kind === 'empty' ? 'none' : `url(#${id}-g)`}
        />
        <circle cx="50" cy="48" r="27" className="vk-seal__ring" />
        <path className="vk-seal__star" d="M50 30 L55 42 L68 42 L58 50 L62 63 L50 55 L38 63 L42 50 L32 42 L45 42 Z" />
      </svg>
    </span>
  )
}
