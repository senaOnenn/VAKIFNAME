import type { RouteResult } from './api'

/**
 * Oyun ekranlarının saf hesapları (R6.7). Kurallar sunucudadır; burada yalnızca sunucunun verdiği rota okunur.
 *
 * R6.7 ürün kararı: kilit yok. Yayımlanmış eserlerin hepsi baştan seçilebilir; her eserin oyuncu durumu hesaba bağlıdır:
 * henüz keşfedilmedi (`new`) → göreve başlandı (`started`) → bilgi mührü (`knowledge`) → altın mühür (`gold`).
 */

export type LedgerState = 'new' | 'started' | 'knowledge' | 'gold'
export interface LedgerEntry {
  monument_id: string
  name: string
  name_en?: string | null
  type?: string
  state: LedgerState
  /** Önerilen sırada yeri (yalnızca tamamlanmamış eserlerde). */
  order?: number
  distance_m?: number
  /** Önerilen sıradaki keşif. */
  next: boolean
  /** Bilgi görevi hazır mı (onaylı kayıtlardan 5 soru); tamamlananlarda her zaman true. */
  ready: boolean
}

/** Eserler: önce başlanmış ve keşfedilmemiş olanlar (önerilen sırayla), en sonda tamamlananlar (en yeni önce). */
export function ledger(route: RouteResult): LedgerEntry[] {
  const open = route.stops.map((s): LedgerEntry => ({
    monument_id: s.monument_id, name: s.name, name_en: s.name_en, type: s.type,
    state: s.progress === 'started' ? 'started' : 'new', order: s.order, distance_m: s.distance_m,
    next: s.monument_id === route.next, ready: s.quest_ready !== false,
  }))
  const done = route.completed.map((c): LedgerEntry => ({
    monument_id: c.monument_id, name: c.name, name_en: c.name_en, state: c.visit ? 'gold' : 'knowledge', next: false, ready: true,
  }))
  return [...open, ...done]
}
