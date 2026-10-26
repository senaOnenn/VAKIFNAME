import type { LocationCandidateRow } from './types'

/**
 * Dahili araştırma haritasının saf modeli: işaretçi etiketleri, görünüm sınıfları ve üst üste binen işaretçilerin
 * gruplanması. Hiçbir aday doğrulanmış sayılmaz; her etiket "Doğrulanmamış konum adayı" ile başlar.
 */

export const UNVERIFIED_LABEL = 'Doğrulanmamış konum adayı'

export const REPRESENTS_LABELS: Record<string, string> = {
  building_footprint_centroid: 'Bina izi merkezi',
  area_centroid: 'Kullanım alanı merkezi (bina değil)',
  point_feature: 'Nokta nesnesi (yapı izi yok)',
  entrance: 'Giriş noktası',
  parcel_centroid: 'Parsel merkezi',
}

export const SOURCE_KIND_LABELS: Record<string, string> = {
  open_map_data: 'OpenStreetMap',
  open_knowledge_base: 'Wikidata (çapraz kontrol)',
  official_portal: 'Resmî portal',
  municipal_heritage: 'Belediye',
  vgm: 'VGM',
  cadastral: 'Kadastro',
  v20_source_pdf: 'Kaynak kitap',
}

export type MarkerShape = 'building' | 'area' | 'point' | 'crosscheck'

export function markerShape(c: LocationCandidateRow): MarkerShape {
  if (c.source_kind === 'open_knowledge_base') return 'crosscheck'
  if (c.represents === 'area_centroid') return 'area'
  if (c.represents === 'point_feature') return 'point'
  return 'building'
}

export const isCompeting = (c: LocationCandidateRow) => c.flags.includes('competing_candidate')

export function markerTitle(c: LocationCandidateRow): string {
  return `${UNVERIFIED_LABEL}: ${c.monument_name} (${c.candidate_id})${isCompeting(c) ? ' · çelişen aday' : ''}`
}

export interface CandidateGroup {
  key: string
  candidates: LocationCandidateRow[]
  /** Grup işaretçisi ilk adayın gerçek koordinatına konur; ortalama veya tahmini nokta üretilmez. */
  latitude: number
  longitude: number
}

/**
 * Ekranda birbirine `thresholdPx` pikselden yakın düşen adayları tek grupta toplar (tek bağlantılı kümeleme).
 * `project` koordinatı geçerli yakınlaştırmadaki piksel konumuna çevirir. Aynı yere düşen adaylar asla gizlenmez:
 * grup işaretçisi açıldığında hepsi ayrı ayrı seçilebilir.
 */
export function groupOverlapping(
  candidates: LocationCandidateRow[],
  project: (lat: number, lon: number) => { x: number; y: number },
  thresholdPx: number,
): CandidateGroup[] {
  const points = candidates.map((c) => ({ c, p: project(c.latitude, c.longitude) }))
  const parent = points.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].p.x - points[j].p.x
      const dy = points[i].p.y - points[j].p.y
      if (dx * dx + dy * dy < thresholdPx * thresholdPx) parent[find(j)] = find(i)
    }
  }
  const groups = new Map<number, LocationCandidateRow[]>()
  points.forEach((_, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), points[i].c])
  })
  return [...groups.values()].map((members) => ({
    key: members.map((m) => m.candidate_id).join('+'),
    candidates: members,
    latitude: members[0].latitude,
    longitude: members[0].longitude,
  }))
}

/** Adayın giriş noktası olup olmadığını açıkça söyler; bina/alan merkezi asla giriş veya check-in noktası sayılmaz. */
export function entranceLabel(c: LocationCandidateRow): string {
  if (c.represents === 'entrance') return 'Giriş noktası adayı (doğrulanmamış)'
  return 'Giriş noktası değil — kaynaklı güvenli giriş noktası yok; GPS check-in için kullanılamaz'
}
