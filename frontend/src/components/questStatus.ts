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

/**
 * Son check-in denemesinin sonucu, backend'den yeniden okunan pasaportla uzlaştırılmış hâli.
 *
 * Check-in isteği hata verdiğinde (ör. yanıt kayboldu, zaman aşımı) sunucu isteği işlemiş olabilir; bu yüzden
 * hata tek başına "mühür eklenmedi" anlamına gelmez. Sonuç, check-in bittikten sonra yüklenen pasaporta göre belirlenir.
 * Pasaport bu sırada yükleniyorsa (`useApi.reload` hemen `loading` durumuna geçer), check-in öncesi eski veri kullanılmaz.
 */
export type CheckInOutcome =
  | 'pending' // istek sürüyor
  | 'out-of-range' // backend reddetti; mühür yok
  | 'earned' // backend `completed` döndü
  | 'already' // backend `already_completed` döndü; yeni mühür yok
  | 'earned-unverified' // backend onayladı ama pasaport yüklenemedi
  | 'stale' // backend onaylamıştı ama güncel pasaportta mühür yok (ör. sunucu yeniden başladı)
  | 'verifying' // check-in yanıtı alınamadı; pasaport kontrol ediliyor
  | 'confirmed' // check-in yanıtı alınamadı ama pasaport mührü doğruladı
  | 'not-earned' // check-in yanıtı alınamadı ve pasaportta mühür yok
  | 'unknown' // check-in yanıtı alınamadı ve pasaport da yüklenemedi

export function checkInOutcome(placeId: string, passport: ApiState<Passport>, checkIn: CheckInState): CheckInOutcome {
  if (checkIn.status === 'pending') return 'pending'
  if (checkIn.status === 'done' && checkIn.response.status === 'out_of_range') return 'out-of-range'
  const hasStamp = passport.status === 'success' && passport.data.stamps.some((s) => s.place_id === placeId)

  if (checkIn.status === 'done') {
    if (passport.status === 'error') return 'earned-unverified'
    if (passport.status === 'success' && !hasStamp) return 'stale'
    return checkIn.response.status === 'completed' ? 'earned' : 'already'
  }

  if (passport.status === 'loading') return 'verifying'
  if (passport.status === 'error') return 'unknown'
  return hasStamp ? 'confirmed' : 'not-earned'
}
