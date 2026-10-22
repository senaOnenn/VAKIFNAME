import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Sekiz köşeli yıldız: logo ve süsleme için soyut geometrik motif. */
export function EmblemIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.5l2.6 4.2 4.8-1.1-1.1 4.8 4.2 2.6-4.2 2.6 1.1 4.8-4.8-1.1L12 21.5l-2.6-4.2-4.8 1.1 1.1-4.8L1.5 13l4.2-2.6-1.1-4.8 4.8 1.1z" />
      <circle cx="12" cy="12" r="3.2" />
    </Icon>
  )
}

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </Icon>
  )
}

export function CompassIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7h18M3 12h18M3 17h18" />
    </Icon>
  )
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Icon>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.2v.1" />
    </Icon>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16.5 9.5" />
    </Icon>
  )
}

export function HourglassIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />
    </Icon>
  )
}

/** Kesikli daire: henüz tamamlanmamış görev. */
export function PendingCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
    </Icon>
  )
}

export function ScrollIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4h11a2 2 0 0 1 2 2v1h-4" />
      <path d="M16 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10" />
      <path d="M7 4a2 2 0 0 0-2 2v11M9 9h4M9 12.5h4" />
    </Icon>
  )
}
