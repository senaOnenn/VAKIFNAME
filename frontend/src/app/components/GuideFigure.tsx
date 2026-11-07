import type { Mouth } from '../lipsync'
import { VOICE_ERKEK, VOICE_ZULAL, type VoiceProfile } from '../narratorVoice'
import { GuideCharacter } from './GuideCharacter'
import { GuidePortrait, PORTRAIT_LIP_SYNC } from './GuidePortrait'

/**
 * Etkin rehber çizimi tek yerden seçilir. `portrait`: R3.3 Osmanlı portresi (durağan; ağız varyantı yok).
 * `legacy`: önceki SVG karakter (ağız senkronlu). Geri dönüş için `ACTIVE = 'legacy'` yeterli; eski bileşen silinmedi.
 * Her çizim kendi anlatıcı ses profiline bağlıdır (`narratorVoice.ts`): kadın karakter kadın, erkek karakter erkek sesi.
 */
const FIGURES: Record<'portrait' | 'legacy', { Component: typeof GuidePortrait; lipSync: boolean; voice: VoiceProfile }> = {
  portrait: { Component: GuidePortrait, lipSync: PORTRAIT_LIP_SYNC, voice: VOICE_ERKEK },
  legacy: { Component: GuideCharacter, lipSync: true, voice: VOICE_ZULAL },
}
const ACTIVE: keyof typeof FIGURES = 'portrait'

/** Seçili çizim ağız şekillerini gösterebiliyor mu? Gösteremiyorsa anlatıcı ağız senkronunu hiç hesaplamaz. */
export const FIGURE_LIP_SYNC: boolean = FIGURES[ACTIVE].lipSync
/** Seçili çizimin anlatıcı ses profili. */
export const FIGURE_VOICE: VoiceProfile = FIGURES[ACTIVE].voice

export function GuideFigure(props: { mouth?: Mouth; speaking?: boolean; className?: string }) {
  const { Component } = FIGURES[ACTIVE]
  return <Component {...props} />
}
