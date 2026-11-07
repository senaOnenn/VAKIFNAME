import type { CharacterId } from './api'

/**
 * Oyuncu kâşifleri (R6.3, R6.5). Yalnızca görünüştür: oyunda güç, avantaj veya farklı kural yoktur. Görünüm
 * `components/KasifPortrait.tsx` içindeki katmanlı vektör çizimdir (dört aşama, seviyeden). Kimlikler sunucudakiyle
 * aynıdır (`backend/app/player_routes.py`).
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
    id: 'gezgin',
    name: 'Gezgin',
    description: 'Yol çantası ve pusulasıyla şehrin sokaklarını adım adım dolaşır.',
    theme: 'Yolların ve hanların izinde',
    tool: 'Pusula',
  },
  {
    id: 'nakkas',
    name: 'Nakkaş Çırağı',
    description: 'Kubbelerin, kalem işlerinin ve çinilerin desenlerini defterine işler.',
    theme: 'Desenlerin ve renklerin izinde',
    tool: 'Fırça',
  },
  {
    id: 'katip',
    name: 'Kâtip Çırağı',
    description: 'Kitabeleri ve vakfiyeleri okur, gördüklerini kayda geçirir.',
    theme: 'Yazıların ve belgelerin izinde',
    tool: 'Kamış kalem',
  },
]

export const characterOf = (id: CharacterId | null | undefined) => CHARACTERS.find((c) => c.id === id) ?? null
