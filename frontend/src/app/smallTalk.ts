/**
 * Rehberle Konuş "Sohbet et" modu için gündelik mesaj tanıma (R3.2). Yalnızca TAMAMEN gündelik olan mesajlar ("Selam",
 * "Merhaba, nasılsın?", "Teşekkürler") tanınır; içinde başka bir şey (ör. eser sorusu) varsa `null` döner ve mesaj
 * kaynaklı rehber hattına gider. Tanınan mesajlar API'ye gönderilmez; arayüz önceden yazılmış, TARİHÎ İDDİA İÇERMEYEN
 * bir karşılık gösterir. Böylece "her tarihî cümle onaylı kayda bağlıdır" kuralı (CLAUDE.md §4) delinmez ve selamlaşma
 * için model çağrısı (bütçe) harcanmaz.
 */
export type SmallTalk = 'greeting' | 'how' | 'who' | 'thanks' | 'bye'

/** Türkçe küçük harf, ı→i, şapka/çengel düşer. */
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')

// Kalıplar sadeleştirilmiş (fold) biçimdedir; uzun olan önce denenir.
const PHRASES: [string, SmallTalk][] = ([
  ['selamun aleykum', 'greeting'], ['selamin aleykum', 'greeting'], ['aleykum selam', 'greeting'], ['selamlar', 'greeting'],
  ['selam', 'greeting'], ['merhabalar', 'greeting'], ['merhaba', 'greeting'], ['meraba', 'greeting'], ['slm', 'greeting'],
  ['gunaydin', 'greeting'], ['iyi gunler', 'greeting'], ['iyi aksamlar', 'greeting'], ['hey', 'greeting'],
  ['hello', 'greeting'], ['hi', 'greeting'], ['good morning', 'greeting'], ['good afternoon', 'greeting'], ['good evening', 'greeting'],
  ['nasilsiniz', 'how'], ['nasilsin', 'how'], ['naber', 'how'], ['ne haber', 'how'], ['iyi misin', 'how'],
  ['how are you', 'how'], ['how is it going', 'how'],
  ['sen kimsin', 'who'], ['siz kimsiniz', 'who'], ['kimsin', 'who'], ['kimsiniz', 'who'], ['sen ne yapabilirsin', 'who'],
  ['ne yapabilirsin', 'who'], ['neler yapabilirsin', 'who'], ['nasil kullanilir', 'who'], ['yardim', 'who'],
  ['who are you', 'who'], ['what can you do', 'who'], ['help', 'who'],
  ['tesekkur ederim', 'thanks'], ['tesekkurler', 'thanks'], ['tesekkur', 'thanks'], ['cok sagol', 'thanks'], ['sagolun', 'thanks'],
  ['sagol', 'thanks'], ['sag ol', 'thanks'], ['eyvallah', 'thanks'], ['thank you', 'thanks'], ['thanks', 'thanks'],
  ['gorusuruz', 'bye'], ['hosca kalin', 'bye'], ['hosca kal', 'bye'], ['bay bay', 'bye'], ['goodbye', 'bye'], ['bye', 'bye'],
  ['see you', 'bye'],
] as [string, SmallTalk][]).sort((a, b) => b[0].length - a[0].length)

/** Birden çok gündelik ifade birlikteyse en anlamlısı döner ("merhaba, kimsin?" → who). */
const PRIORITY: SmallTalk[] = ['who', 'how', 'thanks', 'bye', 'greeting']

export function smallTalk(text: string): SmallTalk | null {
  let s = fold(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 60) return null
  const found = new Set<SmallTalk>()
  while (s) {
    const hit = PHRASES.find(([p]) => s === p || s.startsWith(p + ' '))
    if (!hit) return null // gündelik olmayan bir parça var: kaynaklı hatta gider
    found.add(hit[1])
    s = s.slice(hit[0].length).trim()
  }
  return PRIORITY.find((k) => found.has(k)) ?? null
}
