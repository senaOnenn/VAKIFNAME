import type { CharacterId, Stage } from '../api'
import { characterOf } from '../characters'
import './kasif-portrait.css'

/**
 * Oyuncu kâşifinin görseli (8 Kasım: Buse'nin çizimleri). İki kâşif (kadın, erkek) × dört görünüm aşaması; aşama
 * seviyeden hesaplanır ve yalnızca kozmetiktir: Çırak Kâşif → Gezgin Seyyah → Vakıf Muhafızı → Başkâşif.
 * `crop="bust"` küçük avatarlar içindir (yuvarlak kesimli portre), `full` seçim ekranındaki kemerli niş içindir (boy).
 * Dosyalar `assets/kasif/{kadin|erkek}-{1..4}-{portre|boy}.webp` (Buse'nin PNG'lerinden küçültüldü, saydam zemin).
 * Eski kimlikler (gezgin, nakkas, katip) erkek kâşif olarak gösterilir (bkz. `characters.tsx`).
 */

const FILES = import.meta.glob('../../assets/kasif/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const LEVEL: Record<Stage, number> = { baslangic: 1, gezginlik: 2, arastirmaci: 3, muhafiz: 4 }

export function kasifImage(id: CharacterId | string, stage: Stage, kind: 'portre' | 'boy'): string {
  const who = characterOf(id)?.id ?? 'erkek'
  return FILES[`../../assets/kasif/${who}-${LEVEL[stage] ?? 1}-${kind}.webp`]
}

export function KasifPortrait({ id, stage = 'baslangic', crop = 'full', className = '', title }: {
  id: CharacterId | string
  stage?: Stage
  crop?: 'full' | 'bust'
  className?: string
  /** Verilirse görsel ekran okuyucuya bu adla okunur; verilmezse dekoratiftir (ad yanında yazılıdır). */
  title?: string
}) {
  const who = characterOf(id)?.id ?? 'erkek'
  const bust = crop === 'bust'
  return (
    <img
      src={kasifImage(who, stage, bust ? 'portre' : 'boy')}
      width={bust ? 384 : 600}
      height={bust ? 384 : 900}
      className={`vk-kasif vk-kasif--${bust ? 'bust' : 'full'} ${className}`}
      data-character={who}
      data-stage={stage}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      decoding="async"
      draggable={false}
    />
  )
}
