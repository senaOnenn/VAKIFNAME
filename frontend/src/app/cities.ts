/** Vakıf Eserleri Envanter Projesi'nin şehirleri (bilgi notu). İleride sunucudan (il alanı) gelecek. */
export interface City {
  slug: string
  name: string
  lat: number
  lng: number
  open: boolean
  note: string
}

export const CITIES: City[] = [
  { slug: 'bursa', name: 'Bursa', lat: 40.1885, lng: 29.061, open: true, note: 'Pilot şehir · 10 eser' },
  { slug: 'kutahya', name: 'Kütahya', lat: 39.4167, lng: 29.9833, open: false, note: 'Yakında' },
  { slug: 'konya', name: 'Konya', lat: 37.8746, lng: 32.4932, open: false, note: 'Yakında' },
  { slug: 'hatay', name: 'Hatay', lat: 36.2025, lng: 36.1606, open: false, note: 'Yakında' },
  { slug: 'izmir', name: 'İzmir', lat: 38.4237, lng: 27.1428, open: false, note: 'Yakında' },
  { slug: 'manisa', name: 'Manisa', lat: 38.6191, lng: 27.4289, open: false, note: 'Yakında' },
]
