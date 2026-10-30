/**
 * Tanıtım filmi (Faz 9) için ürünün kendi çizimleri: bileşenler sunucu tarafında durağan SVG'ye çevrilir
 * (`film/tools/build.mjs`, Vite ssrLoadModule ile yükler). Film ile ürün aynı karakteri, mühürleri ve haritayı kullanır.
 * Yayın paketine girmez (src dışında).
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { CITIES } from '../src/app/cities'
import { GuideCharacter } from '../src/app/components/GuideCharacter'
import { GoldRule, Ornament } from '../src/app/components/Ornament'
import { Seal } from '../src/app/components/Seal'
import { TURKEY_PATH, TURKEY_VIEWBOX, project } from '../src/app/components/turkeyOutline'
import { VakfiyePuzzle, type PieceState } from '../src/app/components/VakfiyePuzzle'
import { setLang } from '../src/app/i18n'
import { visemes, type Mouth } from '../src/app/lipsync'

const MOUTHS: Mouth[] = ['X', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const NOSE = '<path d="M150 182 Q154 194 147 198"'
const FRONT_HAIR = '<g fill="#3a2418"><path d="M88 160'

/** Karakterin X ağızlı hâli ile her ağız şeklinin işareti (burun ile ön saç arasındaki tek öğe). */
function guide() {
  const render = (m: Mouth) => renderToStaticMarkup(<GuideCharacter mouth={m} />)
  const mouthOf = (svg: string) => {
    const a = svg.indexOf('>', svg.indexOf(NOSE)) + 1
    const b = svg.indexOf(FRONT_HAIR, a)
    if (a <= 0 || b < 0) throw new Error('GuideCharacter yapısı değişti: ağız bulunamadı')
    return { a, b, markup: svg.slice(a, b) }
  }
  const base = render('X')
  const { a, b } = mouthOf(base)
  const mouths = Object.fromEntries(MOUTHS.map((m) => [m, mouthOf(render(m)).markup]))
  // Ağız yerine tüm şekilleri taşıyan grup; film yalnızca birini görünür yapar.
  const group = MOUTHS.map((m) => `<g class="vkf-m vkf-m-${m}"${m === 'X' ? '' : ' style="opacity:0"'}>${mouths[m]}</g>`).join('')
  return base.slice(0, a) + `<g class="vkf-mouths">${group}</g>` + base.slice(b)
}

function seal(kind: 'empty' | 'knowledge' | 'gold') {
  return renderToStaticMarkup(<Seal kind={kind} label="" size={100} />)
}

function puzzle(state: PieceState) {
  return renderToStaticMarkup(<VakfiyePuzzle pieces={Array<PieceState>(10).fill(state)} labels={[]} />)
}

export function art() {
  setLang('tr')
  return {
    guide: guide(),
    seals: { empty: seal('empty'), knowledge: seal('knowledge'), gold: seal('gold') },
    puzzle: { missing: puzzle('missing'), found: puzzle('found'), gold: puzzle('gold') },
    ornament: renderToStaticMarkup(<Ornament />),
    rule: renderToStaticMarkup(<GoldRule />),
    turkey: { path: TURKEY_PATH, viewBox: TURKEY_VIEWBOX },
    cities: CITIES.map((c) => ({ ...c, ...project(c.lat, c.lng) })),
  }
}

/** Ağız şekli dizisi (ürünün ağız senkronuyla aynı kural). */
export const mouthSequence = (text: string) => visemes(text)
