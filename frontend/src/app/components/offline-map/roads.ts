/**
 * Bağlantı yokken harita altlığı (demo yedeği): şehir merkezinin ana yolları ve nehri, OpenStreetMap verisinden
 * (© OpenStreetMap katkıcıları, ODbL) önceden çıkarılmış küçük bir dosya. Karolar yüklenemezse rota haritası bunları çizer;
 * dosya yalnızca o zaman indirilir.
 *
 * Biçim: her çizgi [Δenlem, Δboylam, …] dizisi, 1e-5 derece birimiyle fark kodlu (ilk nokta mutlak).
 */
export type RoadClass = 'major' | 'minor' | 'river'
export type OfflineRoads = Record<RoadClass, [number, number][][]>

export function decodeRoads(doc: Record<RoadClass, number[][]>): OfflineRoads {
  const decode = (flat: number[]) => {
    const out: [number, number][] = []
    let lat = 0
    let lng = 0
    for (let i = 0; i + 1 < flat.length; i += 2) {
      lat += flat[i]
      lng += flat[i + 1]
      out.push([lat / 1e5, lng / 1e5])
    }
    return out
  }
  return { major: doc.major.map(decode), minor: doc.minor.map(decode), river: doc.river.map(decode) }
}

/** Şimdilik tek şehir (pilot); yeni şehir eklenince dosyası buraya eklenir. */
export const loadOfflineRoads = () => import('./bursa.json').then((m) => decodeRoads(m.default as unknown as Record<RoadClass, number[][]>))
