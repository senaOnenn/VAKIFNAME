/**
 * Alıntıyı kaynak sayfa metninde bulur. PDF metnindeki satır sonu, heceleme tireleri ("ara -\nsında"), boşluk ve
 * noktalama farkları yok sayılır: yalnızca harf ve rakamlar karşılaştırılır (sunucudaki `squash` denetimiyle aynı fikir).
 * Bulunursa özgün metindeki başlangıç ve bitiş (hariç) konumu döner.
 */
function fold(text: string): { chars: string; index: number[] } {
  let chars = ''
  const index: number[] = []
  for (let i = 0; i < text.length; i++) {
    const norm = text[i].normalize('NFKC').toLocaleLowerCase('tr')
    for (const c of norm) {
      if (/[\p{L}\p{N}]/u.test(c)) {
        chars += c
        index.push(i)
      }
    }
  }
  return { chars, index }
}

export function locateQuote(page: string, quote: string): { start: number; end: number } | null {
  const q = fold(quote).chars
  if (q.length < 4) return null
  const p = fold(page)
  const at = p.chars.indexOf(q)
  if (at < 0) return null
  return { start: p.index[at], end: p.index[at + q.length - 1] + 1 }
}
