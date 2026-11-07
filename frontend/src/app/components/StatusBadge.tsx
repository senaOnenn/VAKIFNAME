import type { MonumentStatus } from '../api'
import { useLang } from '../i18n'

const LABEL: Record<MonumentStatus, string> = {
  locked: 'Kilitli',
  unlocked: 'Açık',
  completed: 'Bilgi mührü',
  gold: 'Altın mühür',
}

/** Kazanılmış mühür: bilgi mührü (indigo) veya ziyaretle altın mühür. */
export type SealStatus = Extract<MonumentStatus, 'completed' | 'gold'>

/**
 * Keşif ekranları (Keşfet, Harita, eser sayfası) için: yalnızca kazanılmış mühür döner; rotadaki "kilitli/açık" durumu
 * oyuna aittir ve burada gösterilmez (R1: bütün yayımlanmış eserler serbestçe keşfedilir). Oyun paneli (`RoutePage`)
 * rota durumunu olduğu gibi kullanmaya devam eder; kurallar ve ilerleme değişmez.
 */
export function sealOnly(status: MonumentStatus | undefined): SealStatus | undefined {
  return status === 'completed' || status === 'gold' ? status : undefined
}

/** Eserin oyundaki durumu: kilit, açık, bilgi mührü (indigo) veya ziyaretle altın mühür. */
export function StatusBadge({ status }: { status: MonumentStatus | undefined }) {
  const { t } = useLang()
  if (!status) return null
  return (
    <span className={`vk-status vk-status--${status}`}>
      <span className="vk-status__dot" aria-hidden="true" />
      {t(LABEL[status])}
    </span>
  )
}
