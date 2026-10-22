/**
 * Osmanlı yapı tipolojilerinden esinlenen çizgisel, temsili mimari çizim (yeni tasarımdan uyarlandı).
 * Belirli bir eserin rölövesi veya fotoğrafı değildir; görseli onaylanmış eser olmadığı için yer tutucudur.
 */
export type DrawingVariant = 'kubbeli' | 'revakli' | 'turbe'

const VARIANTS: DrawingVariant[] = ['kubbeli', 'revakli', 'turbe']

/** Listedeki sıraya göre döngüsel çizim seçer; eserin gerçek yapı türünü iddia etmez. */
export function drawingVariantFor(index: number): DrawingVariant {
  return VARIANTS[index % VARIANTS.length]
}

function arches(count: number, x: number, y: number, w: number, h: number) {
  return Array.from({ length: count }, (_, n) => (
    <path key={n} d={`M${x + n * w} ${y + h}v-${h - 16}q${w / 2 - 5} -32 ${w - 10} 0v${h - 16}`} />
  ))
}

function Building({ variant }: { variant: DrawingVariant }) {
  switch (variant) {
    case 'revakli':
      return (
        <>
          <path d="M60 365V200h530v165M60 270h530M45 200h560l-24-17H69z" />
          {arches(8, 82, 212, 61, 48)}
          {arches(8, 82, 282, 61, 80)}
          <path d="M275 365v-80q50-65 100 0v80" />
          <path d="M115 183v-26h420v26" />
        </>
      )
    case 'turbe':
      return (
        <>
          <path d="M190 365V227l135-42 135 42v138zM190 227h270M210 211a115 115 0 0 1 230 0M325 97V70m-8 0h16" />
          {arches(3, 225, 245, 70, 120)}
          <path d="M175 370h300M200 230v130m250-130v130" />
        </>
      )
    case 'kubbeli':
      return (
        <>
          <path d="M90 370V240h470v130M80 242h490M115 240a65 65 0 0 1 130 0M245 240a80 80 0 0 1 160 0M405 240a65 65 0 0 1 130 0M325 160v-22m-7-3h14M180 175v-20m285 20v-20M59 370V142h20v228M54 142h30v-10H54M61 132V88l8-26 8 26v44M575 370V114h20v256M570 114h30v-10h-30M577 104V60l8-28 8 28v44" />
          {arches(6, 120, 280, 65, 61)}
          <path d="M285 370v-67q40-60 80 0v67" />
        </>
      )
  }
}

export function ArchitectureDrawing({ variant, className }: { variant: DrawingVariant; className?: string }) {
  return (
    <svg
      className={['architecture-drawing', className].filter(Boolean).join(' ')}
      viewBox="0 0 650 470"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round">
        <Building variant={variant} />
        <path d="M35 378h580M25 387h600" />
        <g opacity={0.3}>
          <path d="M100 395h450m-430 8h410M95 420h460M325 30v392M35 200h580" strokeDasharray="2 6" />
          <circle cx="325" cy="230" r="185" />
          <path d="M110 37v-12h12m416 0h12v12M110 414v12h12m416 0h12v-12" />
        </g>
      </g>
    </svg>
  )
}
