/** Backend `Stamp` modeli. `earned_at` ISO 8601 tarih-saat metnidir. */
export interface Stamp {
  place_id: string
  place_name: string
  earned_at: string
}

/** Backend `Passport` modeli. */
export interface Passport {
  user_id: string
  total_stamps: number
  stamps: Stamp[]
}
