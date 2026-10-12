import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, checkIn } from '../api/client'
import type { CheckInResponse, Place } from '../api/types'

export type CheckInState =
  | { status: 'pending' }
  | { status: 'done'; response: CheckInResponse }
  | { status: 'error'; error: ApiError }

/**
 * Eser başına demo check-in isteklerini yönetir.
 * - Aynı eser için istek sürerken yeni istek başlatılmaz (çift tıklama koruması).
 * - Bileşen kaldırılınca süren istekler iptal edilir ve sonuçları yok sayılır.
 * - `onSettled`, istek iptal edilmeden bittiğinde (başarılı ya da değil) çağrılır; pasaport backend'den yenilenir.
 */
export function useCheckIn(userId: string, onSettled: (placeId: string, result: CheckInState) => void) {
  const [states, setStates] = useState<Record<string, CheckInState>>({})
  const inFlight = useRef(new Map<string, AbortController>())
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  useEffect(() => {
    const controllers = inFlight.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [])

  const run = useCallback(
    (place: Place) => {
      if (inFlight.current.has(place.id)) return
      const controller = new AbortController()
      inFlight.current.set(place.id, controller)
      setStates((s) => ({ ...s, [place.id]: { status: 'pending' } }))

      // Demo konumu: eserin backend kaydındaki koordinatlar. Tarayıcı konumu kullanılmaz.
      checkIn(place.id, userId, place.latitude, place.longitude, controller.signal)
        .then(
          (response): CheckInState => ({ status: 'done', response }),
          (error: unknown): CheckInState => ({
            status: 'error',
            error: error instanceof ApiError ? error : new ApiError('network', 'Beklenmeyen bir hata oluştu.'),
          }),
        )
        .then((result) => {
          if (controller.signal.aborted) return
          inFlight.current.delete(place.id)
          setStates((s) => ({ ...s, [place.id]: result }))
          onSettledRef.current(place.id, result)
        })
    },
    [userId],
  )

  return { states, run }
}
