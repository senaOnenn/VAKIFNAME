import type { Passport } from '../api/types'
import type { ApiState } from '../hooks/useApi'
import type { CheckInState } from '../hooks/useCheckIn'

export type QuestStatus = 'not-completed' | 'completed' | 'checking' | 'error'

export const QUEST_STATUS_LABEL: Record<QuestStatus, string> = {
  'not-completed': 'Henüz tamamlanmadı',
  completed: 'Tamamlandı',
  checking: 'Tekrar kontrol ediliyor',
  error: 'Hata',
}

/**
 * Görev durumu yalnızca backend'den gelen pasaporttan türetilir; tarayıcıda ayrıca saklanmaz.
 * Böylece sunucu yeniden başlatılıp ilerleme silinirse arayüz eski mührü korunmuş gibi göstermez.
 */
export function questStatus(placeId: string, passport: ApiState<Passport>, checkIn: CheckInState | undefined): QuestStatus {
  if (checkIn?.status === 'pending' || passport.status === 'loading') return 'checking'
  if (passport.status === 'error') return 'error'
  if (passport.data.stamps.some((s) => s.place_id === placeId)) return 'completed'
  if (checkIn?.status === 'error') return 'error'
  return 'not-completed'
}
