/**
 * Vakıf Eserleri Envanter Projesi'nin şehirleri (bilgi notu): ad ve harita noktası. Bir şehrin açık olup olmadığı ve eser
 * sayısı katalogdan hesaplanır (`withCatalog`); buradaki `open` yalnızca katalog yüklenene kadar kullanılır.
 */
export interface City {
  slug: string
  name: string
  lat: number
  lng: number
  open: boolean
  note: string
}

export const CITIES: City[] = [
  { slug: 'bursa', name: 'Bursa', lat: 40.1885, lng: 29.061, open: true, note: 'Pilot şehir' },
  { slug: 'kutahya', name: 'Kütahya', lat: 39.4167, lng: 29.9833, open: false, note: 'Yakında' },
  { slug: 'konya', name: 'Konya', lat: 37.8746, lng: 32.4932, open: false, note: 'Yakında' },
  { slug: 'hatay', name: 'Hatay', lat: 36.2025, lng: 36.1606, open: false, note: 'Yakında' },
  { slug: 'izmir', name: 'İzmir', lat: 38.4237, lng: 27.1428, open: false, note: 'Yakında' },
  { slug: 'manisa', name: 'Manisa', lat: 38.6191, lng: 27.4289, open: false, note: 'Yakında' },
]

/** Katalogdaki eser sayısına göre şehir listesini günceller: en az bir eseri olan şehir açılır. */
export function withCatalog(cities: City[], cityNames: string[] | null, slug: (name: string) => string): City[] {
  if (!cityNames) return cities
  const counts = new Map<string, number>()
  for (const n of cityNames) counts.set(slug(n), (counts.get(slug(n)) ?? 0) + 1)
  return cities.map((c) => {
    const n = counts.get(c.slug) ?? 0
    return { ...c, open: n > 0, note: n > 0 ? `${n} eser` : 'Yakında' }
  })
}
