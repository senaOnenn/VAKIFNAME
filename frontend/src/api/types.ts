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
