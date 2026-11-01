/** Gezinme simgeleri (süs; metin etiketiyle birlikte kullanılır). */
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false }

export const CompassIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>
)
export const DomeIcon = () => (
  <svg {...base}><path d="M4 20h16M6 20v-6a6 6 0 0 1 12 0v6M12 4v4M9 20v-4h6v4" /></svg>
)
export const SealIcon = () => (
  <svg {...base}><circle cx="12" cy="10" r="6" /><path d="m9 15-1.5 6L12 19l4.5 2L15 15" /><path d="M12 7v6M9 10h6" /></svg>
)
export const UserIcon = () => (
  <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
)
export const ChartIcon = () => (
  <svg {...base}><path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" /></svg>
)
export const MapIcon = () => (
  <svg {...base}><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></svg>
)
export const GuideIcon = () => (
  <svg {...base}><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></svg>
)
export const PuzzleIcon = () => (
  <svg {...base}><path d="M5 8h3a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v4H5v-4a2 2 0 1 0 0-4z" /></svg>
)
