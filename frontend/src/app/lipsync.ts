/**
 * Ağız senkronu (Faz 8). Türkçe yazıldığı gibi okunur: her harfin ağız şekli metinden çıkarılır; zamanlama sesin
 * ilerleyişinden gelir (tarayıcı sesinde kelime sınırı olayları + tahmini hız; ses dosyasında oynatma anı). Ek araç yok.
 *
 * Ağız şekilleri Preston Blair / Rhubarb adlarıdır: X dinlenme, A kapalı (m b p), B hafif açık (çoğu ünsüz, i), C açık
 * (e, ı), D geniş (a), E yuvarlak (o ö), F büzük (u ü), G üst diş alt dudakta (f v), H dil ucu yukarıda (l).
 */
export type Mouth = 'X' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

const VOWEL: Record<string, Mouth> = { a: 'D', â: 'D', e: 'C', ı: 'C', i: 'B', î: 'B', o: 'E', ö: 'E', u: 'F', ü: 'F', û: 'F' }
const CONSONANT: Record<string, Mouth> = { m: 'A', b: 'A', p: 'A', f: 'G', v: 'G', l: 'H' }
const PAUSE: Record<string, number> = { ',': 1.6, ';': 1.8, ':': 1.6, '.': 2.4, '!': 2.4, '?': 2.4, '…': 2.4, '—': 1.4, '–': 1.4 }

export interface Viseme {
  shape: Mouth
  /** Göreli süre ağırlığı (ünlü daha uzun, noktalama duraksaması). */
  w: number
  /** Metindeki karakter konumu (kelime sınırı olayıyla eşleştirmek için). */
  at: number
}

/** Metnin ağız şekli dizisi. Art arda aynı şekiller birleştirilir; boşluk kısa bir dinlenmedir. */
export function visemes(text: string): Viseme[] {
  const out: Viseme[] = []
  const push = (shape: Mouth, w: number, at: number) => {
    const last = out[out.length - 1]
    if (last && last.shape === shape) last.w += w
    else out.push({ shape, w, at })
  }
  const lower = text.toLocaleLowerCase('tr')
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]
    if (VOWEL[ch]) push(VOWEL[ch], 1.25, i)
    else if (CONSONANT[ch]) push(CONSONANT[ch], 0.8, i)
    else if (/\p{L}/u.test(ch)) push('B', 0.7, i)
    else if (PAUSE[ch]) push('X', PAUSE[ch], i)
    else if (/\s/.test(ch)) push('X', 0.35, i)
    else if (/\p{N}/u.test(ch)) push('C', 2.2, i) // rakam birkaç hece olarak okunur
  }
  return out
}

/** Dizide `progress` (0–1) anındaki ağız şekli. */
export function mouthAt(seq: Viseme[], progress: number): Mouth {
  if (!seq.length || progress <= 0 || progress >= 1) return 'X'
  const total = seq.reduce((s, v) => s + v.w, 0)
  let t = progress * total
  for (const v of seq) {
    if (t < v.w) return v.shape
    t -= v.w
  }
  return 'X'
}

/** `charIndex`ten başlayarak `elapsedMs` sonra hangi ağız şekli (tarayıcı sesinin kelime sınırı olayı için). */
export function mouthFrom(seq: Viseme[], charIndex: number, elapsedMs: number, msPerWeight: number): Mouth {
  let i = seq.findIndex((v) => v.at >= charIndex)
  if (i < 0) return 'X'
  let t = elapsedMs / msPerWeight
  for (; i < seq.length; i++) {
    if (t < seq[i].w) return seq[i].shape
    t -= seq[i].w
  }
  return 'X'
}

/** Tarayıcı Türkçe sesinin yaklaşık hızı: ağırlık birimi başına milisaniye (hız 1 iken ~13 harf/sn). */
export const MS_PER_WEIGHT = 72
