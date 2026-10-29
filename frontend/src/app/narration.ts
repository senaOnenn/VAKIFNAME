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
// İngilizce (Faz 11): yalnızca onaylı İngilizce kayıtlar; kalıplar sunucudaki tts.py ile birebir aynı (test denetler).
const PREFIX_EN: Record<string, string> = {
  reported: 'According to a reported tradition: ',
  uncertain: 'This is not certain: ',
}
const INTRO_EN = (name: string) => `Welcome! I am your guide here. Let me share what the sources tell us about ${name}.`
const OUTRO_EN = 'If you are curious about anything, write to me. You can see the sources of what I told you below.'

const rank = (f: MonumentFact) => {
  const i = CATEGORY_ORDER.indexOf(f.category)
  return i === -1 ? CATEGORY_ORDER.length : i
}

/**
 * Anlatımda en fazla `maxFacts` bilgi (yaklaşık 1–2 dakika). Belgelenmiş bilgiler önce gelir. İngilizcede yalnızca
 * İngilizcesi onaylı kayıtlar anlatılır (makine çevirisi yok).
 */
export function buildScript(
  m: Pick<MonumentDetail, 'name' | 'facts'> & { name_en?: string | null },
  maxFacts = 6,
  lang: 'tr' | 'en' = 'tr',
): Line[] {
  if (lang === 'en') return buildScriptEn(m, maxFacts)
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

function buildScriptEn(m: Pick<MonumentDetail, 'name' | 'facts'> & { name_en?: string | null }, maxFacts: number): Line[] {
  const picked = m.facts
    .filter((f) => f.text_en)
    .sort((a, b) => Number(a.certainty !== 'documented') - Number(b.certainty !== 'documented') || rank(a) - rank(b))
    .slice(0, maxFacts)
    .sort((a, b) => rank(a) - rank(b))
  const intro = INTRO_EN(m.name_en || m.name)
  return [
    { kind: 'intro', text: intro, spoken: intro },
    ...picked.map<Line>((f) => ({
      kind: 'fact',
      text: f.text_en!,
      spoken: (PREFIX_EN[f.certainty] ?? '') + f.text_en!,
      factId: f.fact_id,
      source: `${f.source.title}, p. ${f.en_page ?? f.source.pdf_physical_page}`,
      certainty: f.certainty,
    })),
    { kind: 'outro', text: OUTRO_EN, spoken: OUTRO_EN },
  ]
}
