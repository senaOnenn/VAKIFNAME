import { useEffect, useState } from 'react'
import type { Mouth } from '../lipsync'
import './guide-character.css'

// Palet A + karakter sayfasındaki kimlik (kıvırcık saç, kırmızı kurdele, krem gömlek, kuşak, çanta, pusula). Yelek
// yeşil yerine gece laciverdi + altın işleme (CLAUDE.md §5: yeşil yok).
const SKIN = '#f3c9a6'
const SKIN_SHADE = '#e4a987'
const HAIR = '#3a2418'
const HAIR_LIGHT = '#5a3a26'
const LIP = '#b8575a'
const MOUTH_IN = '#5b1e24'
const TEETH = '#fbf4e6'
const TONGUE = '#d9737a'
const INK = '#2a1a12'
const RIBBON = '#a5283b'
const RIBBON_DARK = '#7a1c2b'
const SHIRT = '#f3ead3'
const VEST = '#232b66'
const VEST_DARK = '#1a2050'
const GOLD = '#c9a24b'
const GOLD_BRIGHT = '#e9c874'
const LEATHER = '#7a4a2a'
const LEATHER_DARK = '#5b351d'

/** Ağız şekilleri (Preston Blair / Rhubarb adları): X dinlenme, A kapalı (m b p), B hafif açık, C açık (e), D geniş (a),
 * E yuvarlak (o ö), F büzük (u ü), G üst diş alt dudakta (f v), H dil ucu yukarıda (l). Merkez (150, 218). */
function MouthShape({ shape }: { shape: Mouth }) {
  switch (shape) {
    case 'A':
      return (
        <g>
          <path d="M136 217 Q150 222 164 217" stroke={LIP} strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M138 217 Q150 219 162 217" stroke={MOUTH_IN} strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'B':
      return (
        <g>
          <path d="M138 214 Q150 212 162 214 Q160 223 150 224 Q140 223 138 214 Z" fill={MOUTH_IN} stroke={LIP} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M140 214.6 Q150 213.2 160 214.6 L159 217.4 Q150 216.6 141 217.4 Z" fill={TEETH} />
        </g>
      )
    case 'C':
      return (
        <g>
          <path d="M136 212 Q150 208.5 164 212 Q162 226 150 228 Q138 226 136 212 Z" fill={MOUTH_IN} stroke={LIP} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M138.5 212.6 Q150 210 161.5 212.6 L160.5 216 Q150 214.6 139.5 216 Z" fill={TEETH} />
          <path d="M142 224 Q150 219.5 158 224 Q150 227 142 224 Z" fill={TONGUE} />
        </g>
      )
    case 'D':
      return (
        <g>
          <path d="M137 209 Q150 205 163 209 Q163.5 229 150 232 Q136.5 229 137 209 Z" fill={MOUTH_IN} stroke={LIP} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M139.5 209.8 Q150 206.8 160.5 209.8 L159.6 213.2 Q150 211.6 140.4 213.2 Z" fill={TEETH} />
          <path d="M141 227 Q150 220 159 227 Q150 231 141 227 Z" fill={TONGUE} />
        </g>
      )
    case 'E':
      return (
        <g>
          <ellipse cx="150" cy="218" rx="8.5" ry="9.5" fill={MOUTH_IN} stroke={LIP} strokeWidth="3" />
          <path d="M145 212.5 Q150 211 155 212.5" stroke={TEETH} strokeWidth="2" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'F':
      return (
        <g>
          <ellipse cx="150" cy="218" rx="5.6" ry="6.4" fill={MOUTH_IN} stroke={LIP} strokeWidth="3.4" />
        </g>
      )
    case 'G':
      return (
        <g>
          <path d="M138 214 Q150 211.5 162 214 L161.5 218 Q150 216.5 138.5 218 Z" fill={TEETH} stroke={LIP} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M138 219 Q150 223.5 162 219" stroke={LIP} strokeWidth="4" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'H':
      return (
        <g>
          <path d="M137 212 Q150 208.5 163 212 Q161.5 225 150 227 Q138.5 225 137 212 Z" fill={MOUTH_IN} stroke={LIP} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M139.5 212.6 Q150 210.2 160.5 212.6 L159.6 215.4 Q150 214.2 140.4 215.4 Z" fill={TEETH} />
          <path d="M144 225 Q146 215.5 150 215 Q154 215.5 156 225 Z" fill={TONGUE} />
        </g>
      )
    default:
      // X: dinlenme — hafif tebessüm.
      return <path d="M137 216 Q150 223.5 163 216" stroke={LIP} strokeWidth="3.6" strokeLinecap="round" fill="none" />
  }
}

function Eye({ cx, closed }: { cx: number; closed: boolean }) {
  if (closed) return <path d={`M${cx - 12} 171 Q${cx} 178 ${cx + 12} 171`} stroke={INK} strokeWidth="3.4" strokeLinecap="round" fill="none" />
  return (
    <g>
      <ellipse cx={cx} cy="170" rx="11" ry="12.5" fill="#fffaf2" />
      <circle cx={cx + 1} cy="171.5" r="8" fill="#6b4222" />
      <circle cx={cx + 1} cy="171.5" r="8" fill="url(#vkg-iris)" />
      <circle cx={cx + 1.5} cy="172" r="4" fill="#1d120c" />
      <circle cx={cx + 4} cy="168" r="2.4" fill="#fff" />
      <circle cx={cx - 1.5} cy="175.5" r="1.1" fill="#fff" opacity="0.8" />
      <path d={`M${cx - 12.5} 166 Q${cx} 154 ${cx + 12.5} 165`} stroke={INK} strokeWidth="3.6" strokeLinecap="round" fill="none" />
      <path d={`M${cx + (cx < 150 ? -12 : 12)} 165.5 l${cx < 150 ? -4 : 4} -3.5`} stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  )
}

/**
 * Rehber karakteri (Faz 8): sade vektör, çerçevesiz. `mouth` dışarıdan (ağız senkronu) gelir; göz kırpma ve nefes kendi
 * içindedir. Hareket azaltılmışsa (CSS) baş ve gövde durağandır. Dekoratiftir: adı ve rolü metin olarak yanındadır.
 */
export function GuideCharacter({ mouth = 'X', speaking = false, className = '' }: { mouth?: Mouth; speaking?: boolean; className?: string }) {
  const [blink, setBlink] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let t = 0
    const loop = () => {
      t = window.setTimeout(() => {
        setBlink(true)
        t = window.setTimeout(() => {
          setBlink(false)
          loop()
        }, 130)
      }, 2400 + Math.random() * 3200)
    }
    loop()
    return () => window.clearTimeout(t)
  }, [])

  return (
    <svg className={`vk-gchar${speaking ? ' is-speaking' : ''} ${className}`} viewBox="0 76 300 304" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="vkg-iris" cx="50%" cy="65%" r="60%">
          <stop offset="0" stopColor="#a8723f" />
          <stop offset="1" stopColor="#5a361b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="vkg-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7d4b6" />
          <stop offset="1" stopColor={SKIN} />
        </linearGradient>
        <linearGradient id="vkg-vest" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={VEST} />
          <stop offset="1" stopColor={VEST_DARK} />
        </linearGradient>
        <linearGradient id="vkg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD_BRIGHT} />
          <stop offset="1" stopColor={GOLD} />
        </linearGradient>
      </defs>

      {/* Baş, gövdeye 14 birim yaklaştırıldı (kısa boyun). */}
      <g transform="translate(0 14)">
          {/* Arka saç kütlesi */}
          <g fill={HAIR}>
            <path d="M74 176 C66 120 100 82 150 80 C204 80 236 120 228 178 C238 214 230 252 214 270 L86 270 C70 250 62 214 74 176 Z" />
            {[[78, 214, 20], [72, 246, 18], [222, 214, 20], [228, 246, 18], [86, 268, 16], [214, 268, 16], [96, 186, 16], [204, 186, 16]].map(([x, y, r]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
            ))}
          </g>

      </g>

      <g className="vk-gchar__body">
        {/* Gövde: gömlek, yelek, askılar, pusula */}
        <path d="M48 380 C50 314 88 286 150 284 C212 286 250 314 252 380 Z" fill={SHIRT} />
        
        <path d="M48 380 C50 320 84 292 124 287 L132 380 Z" fill="url(#vkg-vest)" />
        <path d="M252 380 C250 320 216 292 176 287 L168 380 Z" fill="url(#vkg-vest)" />
        <path d="M124 287 L132 380 M176 287 L168 380" stroke={GOLD} strokeWidth="3" fill="none" />
        {/* yelek işlemesi */}
        <g fill="none" stroke={GOLD} strokeWidth="1.6" opacity="0.9">
          <path d="M98 330 q6 -10 12 0 q-6 10 -12 0 Z" />
          <path d="M202 330 q-6 -10 -12 0 q6 10 12 0 Z" />
        </g>
        {/* yaka */}
        <path d="M124 287 L150 318 L176 287 C166 292 134 292 124 287 Z" fill={SKIN_SHADE} />
        <path d="M120 286 L150 322 L180 286" stroke={GOLD} strokeWidth="2.4" fill="none" strokeLinejoin="round" />
        {/* çanta askıları */}
        <path d="M84 300 C96 320 104 350 106 380 L118 380 C116 348 108 316 96 294 Z" fill={LEATHER} />
        <path d="M216 300 C204 320 196 350 194 380 L182 380 C184 348 192 316 204 294 Z" fill={LEATHER} />
        <path d="M90 300 C101 322 108 350 110 380 M210 300 C199 322 192 350 190 380" stroke={LEATHER_DARK} strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
        {/* pusula */}
        <path d="M150 322 C146 336 140 346 134 352" stroke={GOLD} strokeWidth="1.6" fill="none" />
        <circle cx="132" cy="360" r="11" fill="url(#vkg-gold)" stroke="#8a6a22" strokeWidth="1.5" />
        <circle cx="132" cy="360" r="7" fill="#f6ecd4" />
        <path d="M132 354 L134 360 L132 366 L130 360 Z" fill={RIBBON} />
        {/* kırmızı kuşak (alt kenar) */}
        <path d="M58 372 C104 365 196 365 242 372 L246 380 L54 380 Z" fill={RIBBON} />

        {/* Boyun */}
        <path d="M134 250 L134 274 C134 288 166 288 166 274 L166 250 Z" fill={SKIN_SHADE} />
        <path d="M134 262 C142 270 158 270 166 262 L166 270 C158 278 142 278 134 270 Z" fill="#d79a78" opacity="0.6" />
      </g>

      <g transform="translate(0 14)">
      <g className="vk-gchar__head">
        {/* Kulaklar */}
        <ellipse cx="89" cy="184" rx="9" ry="13" fill={SKIN_SHADE} />
        <ellipse cx="211" cy="184" rx="9" ry="13" fill={SKIN_SHADE} />
        {/* Yüz */}
        <path d="M90 168 C90 122 116 102 150 102 C184 102 210 122 210 168 C210 214 184 246 150 246 C116 246 90 214 90 168 Z" fill="url(#vkg-skin)" />
        {/* Yanaklar ve çiller */}
        <ellipse cx="111" cy="199" rx="13" ry="8" fill="#f09a8c" opacity="0.42" />
        <ellipse cx="189" cy="199" rx="13" ry="8" fill="#f09a8c" opacity="0.42" />
        <g fill="#c98a66" opacity="0.7">
          <circle cx="107" cy="193" r="1.2" /><circle cx="113" cy="196" r="1.1" /><circle cx="118" cy="192" r="1" />
          <circle cx="193" cy="193" r="1.2" /><circle cx="187" cy="196" r="1.1" /><circle cx="182" cy="192" r="1" />
        </g>
        {/* Kaşlar */}
        <path className="vk-gchar__brow" d="M112 150 Q125 142 138 148" stroke={HAIR} strokeWidth="4" strokeLinecap="round" fill="none" />
        <path className="vk-gchar__brow" d="M162 148 Q175 142 188 150" stroke={HAIR} strokeWidth="4" strokeLinecap="round" fill="none" />
        <Eye cx={125} closed={blink} />
        <Eye cx={175} closed={blink} />
        {/* Burun */}
        <path d="M150 182 Q154 194 147 198" stroke="#cf8b69" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <MouthShape shape={mouth} />

        {/* Ön saç: perçem ve kıvrımlar */}
        <g fill={HAIR}>
          <path d="M88 160 C84 112 114 86 152 86 C190 86 218 112 212 160 C204 134 190 124 176 122 C170 136 154 140 146 128 C136 140 118 140 112 128 C100 134 92 146 88 160 Z" />
          <circle cx="92" cy="150" r="13" />
          <circle cx="208" cy="150" r="13" />
          <circle cx="86" cy="178" r="11" />
          <circle cx="214" cy="178" r="11" />
        </g>
        <g fill="none" stroke={HAIR_LIGHT} strokeWidth="2.4" strokeLinecap="round" opacity="0.85">
          <path d="M118 104 q10 -8 22 -4" />
          <path d="M160 100 q14 -2 24 8" />
          <path d="M100 124 q6 -10 16 -12" />
          <path d="M196 120 q6 6 6 16" />
        </g>
        {/* Kurdele (karakter sayfasındaki gibi bir yanda) */}
        <g>
          <path d="M80 132 L60 118 L62 146 Z" fill={RIBBON} />
          <path d="M80 132 L96 112 L102 140 Z" fill={RIBBON} />
          <circle cx="81" cy="133" r="6" fill={RIBBON_DARK} />
          <path d="M78 138 C72 160 66 176 58 196 L66 198 C72 180 78 162 82 140 Z" fill={RIBBON} />
          <path d="M84 138 C86 160 88 180 84 202 L92 202 C95 180 92 158 88 138 Z" fill={RIBBON_DARK} />
        </g>
      </g>
      </g>
    </svg>
  )
}
