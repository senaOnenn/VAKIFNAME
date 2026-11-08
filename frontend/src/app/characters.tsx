import type { CharacterId } from './api'

/**
 * Oyuncu kâşifleri (R6.3, R6.5; 8 Kasım: Buse'nin çizimleri). Yalnızca görünüştür: oyunda güç, avantaj veya farklı kural
 * yoktur. Görsel `components/KasifPortrait.tsx` (dört aşama, seviyeden). Kimlikler sunucudakiyle aynıdır
 * (`backend/app/player_routes.py`). Eski kimlikler (gezgin, nakkas, katip; 8 Kasım öncesi üç kâşif) erkek kâşif olarak
 * gösterilir: oyuncu yeniden seçim yapmak zorunda kalmaz, isterse "Kâşifini değiştir"den değiştirir.
 */
export interface CharacterDef {
  id: CharacterId
  /** Rol adı (Türkçe anahtar; İngilizcesi i18n sözlüğünde). */
  name: string
  /** Tek cümlelik takdim. */
  description: string
  /** Kâşifin gözü: eserlere nereden baktığı (yalnızca anlatı; oyun kuralı değil). */
  theme: string
  /** Elindeki eşya. */
  tool: string
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'kadin',
    name: 'Kadın kâşif',
    description: 'Haritası ve yol çantasıyla şehrin vakıf eserlerini adım adım keşfeder.',
    theme: 'Yolların ve eserlerin izinde',
    tool: 'Harita',
  },
  {
    id: 'erkek',
    name: 'Erkek kâşif',
    description: 'Haritası ve yol çantasıyla şehrin vakıf eserlerini adım adım keşfeder.',
    theme: 'Yolların ve eserlerin izinde',
    tool: 'Harita',
  },
]

const LEGACY: Record<string, CharacterId> = { gezgin: 'erkek', nakkas: 'erkek', katip: 'erkek' }

export const characterOf = (id: CharacterId | string | null | undefined) => {
  if (!id) return null
  const key = LEGACY[id] ?? id
  return CHARACTERS.find((c) => c.id === key) ?? null
}
