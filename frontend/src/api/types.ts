/** Backend `Place` modeli (backend/app/models.py) ile birebir eşleşir. */
export interface Place {
  id: string
  name: string
  city: string
  description: string
  latitude: number
  longitude: number
  check_in_radius_m: number
  source_title: string | null
  source_url: string | null
  is_demo: boolean
}

/** Backend `CheckInStatus` değerleri. */
export type CheckInStatus = 'completed' | 'already_completed' | 'out_of_range'

/** Backend `Stamp` modeli. `earned_at` ISO 8601 tarih-saat metnidir. */
export interface Stamp {
  place_id: string
  place_name: string
  earned_at: string
}

/**
 * Backend `CheckInResponse` modeli. Yarıçap dışı denemeler de HTTP 200 döner (`success: false`, `out_of_range`);
 * `already_completed` yeni mühür oluşturmaz, var olan mührü döndürür.
 */
export interface CheckInResponse {
  success: boolean
  status: CheckInStatus
  message: string
  place_id: string
  distance_m: number
  allowed_radius_m: number
  stamp: Stamp | null
}

/** Backend `Passport` modeli. */
export interface Passport {
  user_id: string
  total_stamps: number
  stamps: Stamp[]
}
