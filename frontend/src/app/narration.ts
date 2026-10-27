import type { MonumentDetail, MonumentFact } from './api'

/**
 * Eser anlatımı: karakterin söylediği her TARİHÎ cümle onaylı bir kayda (`fact_id`) bağlıdır ve metni kayıttan aynen
 * alınır (CLAUDE.md §4). Karşılama ve kapanış cümleleri tarihî iddia taşımaz; "canlandırma" kişiliğine aittir.
 * Kesin olmayan veya rivayet olan bilgi, sesli anlatımda da öyle olduğu söylenerek okunur.
 */
export interface Line {
  kind: 'intro' | 'fact' | 'outro'
  /** Altyazıda görünen metin. */
  text: string
  /** Seslendirilen metin (kesinlik ön eki dahil). */
  spoken: string
  factId?: string
  source?: string
  certainty?: string
}

export interface Narrator {
  kind: 'local_guide'
  /** Ekranda görünen ad ve rol. */
  name: string
  role: string
}

/** Yerel rehber (K4: tarihî karakterler ekibin kararını bekliyor). */
export const LOCAL_GUIDE: Narrator = { kind: 'local_guide', name: 'Rehber', role: 'Yerel rehber · canlandırma' }

// Hikâye akışı: önce kim/ne zaman, sonra yapı ve sanat, işlev, sonra sonraki dönemler.
const CATEGORY_ORDER = [
  'construction', 'foundation_purpose', 'historical_person', 'architecture', 'artistic_feature', 'inscription',
  'function', 'burial_practice', 'historical_event', 'restoration',
]
const PREFIX: Record<string, string> = {
  reported: 'Aktarılan bir rivayete göre: ',
  uncertain: 'Bu bilgi kesin değil: ',
}

const rank = (f: MonumentFact) => {
  const i = CATEGORY_ORDER.indexOf(f.category)
  return i === -1 ? CATEGORY_ORDER.length : i
}

/** Anlatımda en fazla `maxFacts` bilgi (yaklaşık 1–2 dakika). Belgelenmiş bilgiler önce gelir. */
export function buildScript(m: Pick<MonumentDetail, 'name' | 'facts'>, maxFacts = 6): Line[] {
  const picked = [...m.facts]
    .sort((a, b) => Number(a.certainty !== 'documented') - Number(b.certainty !== 'documented') || rank(a) - rank(b))
    .slice(0, maxFacts)
    .sort((a, b) => rank(a) - rank(b))
  const intro = `Hoş geldin! Ben buranın rehberiyim. Sana ${m.name} hakkında kaynakların anlattıklarını aktaracağım.`
  const outro = 'Merak ettiğin bir şey olursa bana yazabilirsin. Bilgilerimin kaynaklarını aşağıda görebilirsin.'
  return [
    { kind: 'intro', text: intro, spoken: intro },
    ...picked.map<Line>((f) => ({
      kind: 'fact',
      text: f.text,
      spoken: (PREFIX[f.certainty] ?? '') + f.text,
      factId: f.fact_id,
      source: `${f.source.title}, s. ${f.source.pdf_physical_page}`,
      certainty: f.certainty,
    })),
    { kind: 'outro', text: outro, spoken: outro },
  ]
}
