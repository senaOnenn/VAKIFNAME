import type { PieceState } from './components/VakfiyePuzzle'

/**
 * Kayıp Vakfiye belgesinin TEK ve sabit yerleşimi (R6.9). Yerleşim sunucudadır (`GET /vakfiye/layout`, bkz.
 * backend/app/vakfiye.py): her eserin belgede değişmez bir yuvası vardır; parçalar kazanılma sırasıyla değil bu yuvaya
 * göre çizilir. Vakfiye Odası ve Mühür Defteri aynı yerleşimi, aynı işlevi (`vakfiyeBoard`) ve aynı bileşeni
 * (`VakfiyePuzzle`) kullanır; böylece aynı oyuncu için dolu/boş yuvalar her ekranda birebir aynıdır. Yerleşim
 * okunamazsa iki ekran da aynı yedek kuralı (kimlik sırası) uygular.
 */

/** Yuva sırası: sunucunun yerleşimi (yalnızca eldeki eserler), yerleşimde olmayanlar sonda kimlik sırasıyla. */
export function vakfiyeSlots(layout: readonly string[] | null | undefined, monumentIds: Iterable<string>): string[] {
  const present = new Set(monumentIds)
  const fixed = (layout ?? []).filter((id) => present.has(id))
  const extra = [...present].filter((id) => !fixed.includes(id)).sort()
  return [...fixed, ...extra]
}

export interface VakfiyeMonument {
  monument_id: string
  name: string
  name_en?: string | null
}

/** Belgenin durumu: her yuva için parça (bilgi mührü = bulundu, ziyaret = altın, yoksa kayıp) ve yuvadaki eser. */
export function vakfiyeBoard(layout: readonly string[] | null | undefined, monuments: VakfiyeMonument[],
  knowledge: ReadonlySet<string>, visit: ReadonlySet<string>) {
  const byId = new Map(monuments.map((m) => [m.monument_id, m]))
  const slots = vakfiyeSlots(layout, byId.keys())
  const states: PieceState[] = slots.map((id) => (knowledge.has(id) ? (visit.has(id) ? 'gold' : 'found') : 'missing'))
  return { slots, states, monuments: slots.map((id) => byId.get(id)!) }
}
