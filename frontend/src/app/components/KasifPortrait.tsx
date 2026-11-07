import type { CharacterId, Stage } from '../api'

/**
 * Oyuncu kâşiflerinin katmanlı vektör portresi (R6.5). Rehber karakterle (GuideCharacter) aynı çizim dili: sade,
 * illüstratif, fotogerçekçi değil; Palet A (gece laciverdi, fildişi, altın, balmumu kırmızısı), yeşil yok.
 *
 * Katmanlar (docs/KARAKTER_TASARIM_REHBERI.md §7): gövde (ten, yüz, saç) → temel kıyafet → üst giysi → kuşak/mühür →
 * kimlik eşyası. Görünüm aşaması seviyeden hesaplanır ve yalnızca kozmetiktir:
 *   başlangıç: gömlek, yelek, kuşak · gezginlik: + yol atkısı ve çanta kayışı · araştırmacı: + altın işleme ve defter ·
 *   muhafız: + lacivert cüppe, altın şerit, balmumu mühür.
 * `crop="bust"` küçük avatar içindir (baş ve omuzlar); `full` kemerli niş içindir (bel hizasına kadar).
 */

const NAVY = '#1a2050'
const NAVY_DEEP = '#10153a'
const IVORY = '#f3ead3'
const IVORY_SHADE = '#dccfb0'
const GOLD = '#c9a24b'
const GOLD_BRIGHT = '#e9c874'
const WAX = '#8e2a3a'
const WAX_DARK = '#6c1f2c'
const LEATHER = '#6b4a2e'
const LEATHER_DARK = '#4a3220'
const COBALT = '#2f4fa8'
const INK = '#24160f'

interface Look {
  skin: string
  skinShade: string
  hair: string
  hairLight: string
  vest: string
  sash: string
}

const LOOKS: Record<CharacterId, Look> = {
  gezgin: { skin: '#e7b48e', skinShade: '#cf9873', hair: '#3a2418', hairLight: '#5a3a26', vest: '#232b66', sash: WAX },
  nakkas: { skin: '#c98e69', skinShade: '#ad7553', hair: '#1f1612', hairLight: '#3b2a20', vest: '#2a3170', sash: COBALT },
  katip: { skin: '#f0caa6', skinShade: '#d9ab86', hair: '#4a2c1a', hairLight: '#6b4430', vest: NAVY, sash: '#7a5a16' },
}

const RANK: Record<Stage, number> = { baslangic: 0, gezginlik: 1, arastirmaci: 2, muhafiz: 3 }

function Face({ look }: { look: Look }) {
  return (
    <g>
      {/* boyun */}
      <path d="M106 140 L106 160 Q120 168 134 160 L134 140 Z" fill={look.skinShade} />
      {/* kulaklar */}
      <ellipse cx="85" cy="108" rx="6" ry="9" fill={look.skinShade} />
      <ellipse cx="155" cy="108" rx="6" ry="9" fill={look.skinShade} />
      {/* yüz */}
      <path d="M86 96 Q86 62 120 60 Q154 62 154 96 L154 112 Q152 140 120 148 Q88 140 86 112 Z" fill={look.skin} />
      <path d="M138 128 Q130 144 120 148 Q140 146 150 124 Z" fill={look.skinShade} opacity="0.55" />
      {/* kaşlar, gözler, burun, ağız */}
      <path d="M99 97 Q106 93 113 96" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M127 96 Q134 93 141 97" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <ellipse cx="106" cy="106" rx="3.4" ry="4.2" fill={INK} />
      <ellipse cx="134" cy="106" rx="3.4" ry="4.2" fill={INK} />
      <circle cx="107.2" cy="104.6" r="1.1" fill="#fff8ea" />
      <circle cx="135.2" cy="104.6" r="1.1" fill="#fff8ea" />
      <path d="M120 108 Q117 119 121 122" stroke={look.skinShade} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M111 130 Q120 135 129 130" stroke="#9c4a48" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <ellipse cx="99" cy="121" rx="6" ry="3.4" fill="#d9776f" opacity="0.22" />
      <ellipse cx="141" cy="121" rx="6" ry="3.4" fill="#d9776f" opacity="0.22" />
    </g>
  )
}

/** Saç ve başlık: kimliğe göre. */
function Head({ id, look, rank }: { id: CharacterId; look: Look; rank: number }) {
  if (id === 'gezgin') {
    return (
      <g>
        {/* kıvırcık kısa saç */}
        <path d="M84 100 Q78 66 104 54 Q122 44 140 54 Q162 64 157 100 Q152 84 140 78 Q128 86 112 80 Q96 84 84 100 Z" fill={look.hair} />
        <path d="M100 62 Q110 56 122 60" stroke={look.hairLight} strokeWidth="3" strokeLinecap="round" fill="none" />
        {rank === 0 && (
          <g fill={look.hair}>
            <circle cx="98" cy="74" r="7" /><circle cx="110" cy="70" r="7" /><circle cx="134" cy="72" r="7" /><circle cx="146" cy="78" r="6" />
          </g>
        )}
        {/* yol başlığı: aşama 1'den sonra keçe börk */}
        {rank >= 1 && (
          <g>
            <path d="M88 76 Q90 46 120 44 Q150 46 152 76 Q120 66 88 76 Z" fill={LEATHER} />
            <path d="M86 78 Q120 66 154 78 L154 84 Q120 72 86 84 Z" fill={LEATHER_DARK} />
            {rank >= 2 && <path d="M92 74 Q120 64 148 74" stroke={GOLD} strokeWidth="1.6" fill="none" />}
          </g>
        )}
      </g>
    )
  }
  if (id === 'nakkas') {
    return (
      <g>
        <path d="M84 104 Q80 64 120 56 Q160 64 156 104 Q150 82 120 80 Q90 82 84 104 Z" fill={look.hair} />
        {/* kobalt baş bağı ve düğümü */}
        <path d="M84 84 Q120 66 156 84 L156 94 Q120 78 84 94 Z" fill={COBALT} />
        <path d="M152 86 Q166 92 164 104 Q158 98 152 96 Z" fill={COBALT} />
        <path d="M86 88 Q120 72 154 88" stroke={rank >= 2 ? GOLD_BRIGHT : '#5b77c9'} strokeWidth="1.4" fill="none" strokeDasharray={rank >= 2 ? '0' : '3 3'} />
      </g>
    )
  }
  return (
    <g>
      <path d="M84 102 Q80 66 120 58 Q160 66 156 102 Q150 84 120 82 Q90 84 84 102 Z" fill={look.hair} />
      <path d="M84 96 Q82 112 88 120 L90 100 Z M156 96 Q158 112 152 120 L150 100 Z" fill={look.hair} />
      {/* kâtibin düşük keçe külahı */}
      <path d="M90 80 Q92 48 120 44 Q148 48 150 80 Q120 72 90 80 Z" fill={rank >= 3 ? NAVY_DEEP : '#3c2e5a'} />
      <path d="M88 80 Q120 70 152 80 L152 86 Q120 76 88 86 Z" fill={IVORY_SHADE} />
      {rank >= 2 && <path d="M90 82 Q120 72 150 82" stroke={GOLD} strokeWidth="1.6" fill="none" />}
    </g>
  )
}

/** Temel kıyafet (gömlek, yelek, kuşak) ve aşama katmanları. Işık sol üstten: sağ yan hafif gölgede. */
function Body({ id, look, rank }: { id: CharacterId; look: Look; rank: number }) {
  return (
    <g>
      {/* gövde: gömlek (eğimli omuzlar) */}
      <path d="M66 320 L68 222 Q70 188 98 174 L120 166 L142 174 Q170 188 172 222 L174 320 Z" fill={IVORY} />
      <path d="M106 162 L120 188 L134 162 Z" fill={IVORY_SHADE} />
      {/* yelek */}
      <path d="M72 320 L74 222 Q76 192 102 178 L114 198 L110 320 Z" fill={look.vest} />
      <path d="M168 320 L166 222 Q164 192 138 178 L126 198 L130 320 Z" fill={look.vest} />
      {rank >= 2 && (
        <g stroke={GOLD} strokeWidth="2" fill="none">
          <path d="M102 178 L114 198 L110 320" />
          <path d="M138 178 L126 198 L130 320" />
          <path d="M104 214 l4 4 l-4 4 l-4 -4 z M134 214 l4 4 l-4 4 l-4 -4 z" fill={GOLD} />
        </g>
      )}
      {/* nakkaşın önlüğü (lale işlemeli) */}
      {id === 'nakkas' && (
        <g>
          <path d="M96 236 L144 236 L150 320 L90 320 Z" fill={IVORY} stroke={IVORY_SHADE} strokeWidth="2" />
          <path d="M112 300 Q112 286 120 284 Q128 286 128 300 Q124 296 120 302 Q116 296 112 300 Z" fill={WAX} opacity="0.85" />
          <path d="M120 302 L120 318" stroke={look.vest} strokeWidth="2" />
          <path d="M98 256 l3 -6 M106 262 l2 -7" stroke={COBALT} strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      {/* kuşak */}
      <path d="M70 252 Q120 262 170 252 L172 270 Q120 280 68 270 Z" fill={look.sash} />
      <path d="M70 258 Q120 268 170 258" stroke="#00000033" strokeWidth="2" fill="none" />
      {/* muhafız: lacivert cüppe ve altın şerit */}
      {rank >= 3 && (
        <g>
          <path d="M60 320 L62 214 Q64 182 96 170 L102 178 Q80 194 80 232 L78 320 Z" fill="#222b6e" />
          <path d="M180 320 L178 214 Q176 182 144 170 L138 178 Q160 194 160 232 L162 320 Z" fill="#222b6e" />
          <path d="M62 214 Q64 182 96 170 M178 214 Q176 182 144 170" stroke={GOLD} strokeWidth="1.6" fill="none" />
          <path d="M102 178 Q80 194 80 232 L78 320" stroke={GOLD_BRIGHT} strokeWidth="3" fill="none" />
          <path d="M138 178 Q160 194 160 232 L162 320" stroke={GOLD_BRIGHT} strokeWidth="3" fill="none" />
        </g>
      )}
      {/* sağ yan gölgesi */}
      <path d="M150 180 Q172 192 174 224 L176 320 L156 320 Q160 250 150 180 Z" fill="#000" opacity="0.16" />
      {/* kollar: omuzdan göğüs hizasındaki ellere (gömlek ya da cüppe kolu) */}
      <g fill={rank >= 3 ? '#222b6e' : IVORY}>
        <path d="M76 184 Q54 198 54 240 Q54 274 88 298 L102 284 Q78 262 80 236 Q82 212 94 196 Z" />
        <path d="M164 184 Q186 198 186 240 Q186 272 154 296 L140 282 Q162 262 160 236 Q158 212 146 196 Z" />
      </g>
      {/* dirsek kıvrımları ve sol üstten ılık kenar ışığı */}
      <g stroke={rank >= 3 ? '#3a4590' : IVORY_SHADE} strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M60 246 Q70 252 80 248" />
        <path d="M180 246 Q170 252 160 248" />
      </g>
      <path d="M76 184 Q54 198 54 240 Q54 274 88 298" stroke={GOLD_BRIGHT} strokeWidth="2" fill="none" opacity={rank >= 3 ? 0.8 : 0.35} />
      <path d="M164 184 Q186 198 186 240 Q186 272 154 296 L150 292 Q176 266 176 240 Q176 206 160 190 Z" fill="#000" opacity="0.14" />
      {rank >= 3 && (
        <g stroke={GOLD_BRIGHT} strokeWidth="2.5" fill="none">
          <path d="M86 296 L100 282" />
          <path d="M156 294 L142 282" />
        </g>
      )}
      {/* gezginlik: omuzlara yol atkısı, göğüste çanta kayışı */}
      {rank >= 1 && (
        <g>
          <path d="M72 184 Q120 212 168 184 Q178 200 166 214 Q120 232 74 214 Q62 200 72 184 Z" fill={LEATHER} />
          <path d="M80 206 Q120 222 160 206" stroke={LEATHER_DARK} strokeWidth="2" fill="none" />
          <path d="M152 176 L92 300" stroke={LEATHER_DARK} strokeWidth="9" strokeLinecap="round" />
          <circle cx="122" cy="238" r="4" fill={GOLD} />
        </g>
      )}
      {/* muhafız: balmumu mühür madalyonu */}
      {rank >= 3 && (
        <g>
          <circle cx="120" cy="226" r="13" fill={WAX} stroke={GOLD_BRIGHT} strokeWidth="2.5" />
          <circle cx="120" cy="226" r="8" fill={WAX_DARK} />
          <path d="M120 219 l2.2 4.5 l5 0.7 l-3.6 3.5 l0.9 5 l-4.5 -2.4 l-4.5 2.4 l0.9 -5 l-3.6 -3.5 l5 -0.7 z" fill={GOLD_BRIGHT} />
        </g>
      )}
    </g>
  )
}

/** Kimlik eşyası ve eller (göğüs hizasında). */
function Prop({ id, look, rank }: { id: CharacterId; look: Look; rank: number }) {
  const hands = (
    <g fill={look.skin} stroke={look.skinShade} strokeWidth="1.5">
      <ellipse cx="98" cy="290" rx="12" ry="10" />
      <ellipse cx="144" cy="288" rx="12" ry="10" />
    </g>
  )
  if (id === 'gezgin') {
    return (
      <g>
        {/* pusula */}
        <circle cx="122" cy="284" r="20" fill="#b8892f" stroke={GOLD_BRIGHT} strokeWidth="2.5" />
        <circle cx="122" cy="284" r="15" fill={IVORY} />
        <path d="M122 272 L126 284 L122 296 L118 284 Z" fill={WAX} />
        <path d="M122 284 L126 284 L122 296 Z" fill={NAVY} />
        <circle cx="122" cy="284" r="2" fill={INK} />
        {hands}
        {rank >= 2 && (
          <g>
            {/* yol defteri */}
            <rect x="148" y="296" width="26" height="20" rx="2" fill={LEATHER_DARK} transform="rotate(-12 161 306)" />
            <path d="M152 300 l18 -4" stroke={GOLD} strokeWidth="1.4" transform="rotate(-12 161 306)" />
          </g>
        )}
      </g>
    )
  }
  if (id === 'nakkas') {
    return (
      <g>
        {/* fırça ve boya kabı */}
        <path d="M150 300 L178 236" stroke={LEATHER} strokeWidth="5" strokeLinecap="round" />
        <path d="M178 236 Q186 222 184 214 Q176 222 174 232 Z" fill={COBALT} />
        <path d="M176 238 l6 -12" stroke={GOLD} strokeWidth="2" />
        <path d="M84 284 L112 284 L108 306 L88 306 Z" fill={IVORY_SHADE} stroke={LEATHER_DARK} strokeWidth="2" />
        <ellipse cx="98" cy="284" rx="14" ry="4" fill={COBALT} />
        {hands}
        {rank >= 2 && <path d="M132 304 h22 v14 h-22 z" fill={IVORY} stroke={GOLD} strokeWidth="1.5" />}
      </g>
    )
  }
  return (
    <g>
      {/* kâtip: kâğıt rulo, kamış kalem, divit */}
      <rect x="92" y="272" width="56" height="22" rx="11" fill={IVORY} stroke={IVORY_SHADE} strokeWidth="2" />
      <path d="M100 280 h40 M100 286 h30" stroke="#8a7d63" strokeWidth="1.4" />
      <path d="M150 300 L184 250" stroke="#b08a4a" strokeWidth="4" strokeLinecap="round" />
      <path d="M184 250 L190 240 L186 252 Z" fill={INK} />
      {hands}
      <rect x="160" y="296" width="20" height="14" rx="3" fill={rank >= 2 ? GOLD : LEATHER} stroke={LEATHER_DARK} strokeWidth="1.5" />
      {rank >= 3 && <rect x="92" y="272" width="56" height="22" rx="11" fill="none" stroke={WAX} strokeWidth="2" strokeDasharray="4 3" />}
    </g>
  )
}

export function KasifPortrait({ id, stage = 'baslangic', crop = 'full', className, title }: {
  id: CharacterId
  stage?: Stage
  crop?: 'full' | 'bust'
  className?: string
  /** Verilirse portre ekran okuyucuya bu adla okunur; verilmezse dekoratiftir (ad yanında yazılıdır). */
  title?: string
}) {
  const look = LOOKS[id]
  const rank = RANK[stage]
  const viewBox = crop === 'bust' ? '60 34 120 120' : '20 30 200 290'
  return (
    <svg viewBox={viewBox} className={className} data-character={id} data-stage={stage}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <Body id={id} look={look} rank={rank} />
      <Face look={look} />
      <Head id={id} look={look} rank={rank} />
      <Prop id={id} look={look} rank={rank} />
    </svg>
  )
}
