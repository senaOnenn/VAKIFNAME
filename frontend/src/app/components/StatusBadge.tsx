import type { MonumentStatus } from '../api'

const LABEL: Record<MonumentStatus, string> = {
  locked: 'Kilitli',
  unlocked: 'Açık',
  completed: 'Bilgi mührü',
  gold: 'Altın mühür',
}

/** Eserin oyundaki durumu: kilit, açık, bilgi mührü (indigo) veya ziyaretle altın mühür. */
export function StatusBadge({ status }: { status: MonumentStatus | undefined }) {
  if (!status) return null
  return (
    <span className={`vk-status vk-status--${status}`}>
      <span className="vk-status__dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  )
}
