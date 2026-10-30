// Tanıtım filmi için eser silüetleri (temsilî çizim; rölöve değildir). Palet A: gece laciverdi dolgu, altın çizgi.
// Her biri viewBox 0 0 1000 560; zemin çizgisi y=500. Çizgiler `pathLength=1` taşır: film çizerek belirtir.

const STROKE = 'stroke="#C9A24B" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" pathLength="1"'
const FILL = 'fill="#1A2050"'
const THIN = 'stroke="#C9A24B" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pathLength="1" fill="none" opacity="0.8"'

const arch = (x, y, w, h) => `M${x} ${y + h} L${x} ${y + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} L${x + w} ${y + h} Z`
const dome = (cx, base, r) => `M${cx - r} ${base} A${r} ${r} 0 0 1 ${cx + r} ${base} Z`
// Alem: dikey çubuk ve üzerinde iki küre (geleneksel biçim; yatay çubuk YOK — haç gibi okunmamalı).
const finial = (cx, top) => `M${cx} ${top} L${cx} ${top - 26}`
const finialBulbs = (cx, top) =>
  `<circle cx="${cx}" cy="${top - 9}" r="4.5" fill="#C9A24B"/><circle cx="${cx}" cy="${top - 19}" r="3.2" fill="#C9A24B"/>`

function minaret(x, ground, top) {
  // Gövde, şerefe, külah.
  const w = 30
  return [
    `<path class="ln" d="M${x - w / 2} ${ground} L${x - w / 2} ${top + 60} L${x + w / 2} ${top + 60} L${x + w / 2} ${ground} Z" ${FILL} ${STROKE}/>`,
    `<path class="ln" d="M${x - w / 2 - 12} ${top + 150} L${x + w / 2 + 12} ${top + 150} L${x + w / 2 + 6} ${top + 166} L${x - w / 2 - 6} ${top + 166} Z" ${FILL} ${STROKE}/>`,
    `<path class="ln" d="M${x - w / 2 - 2} ${top + 60} L${x} ${top} L${x + w / 2 + 2} ${top + 60} Z" ${FILL} ${STROKE}/>`,
    `<path class="ln" d="${finial(x, top)}" ${THIN}/>${finialBulbs(x, top)}`,
  ].join('')
}

/** Bursa Ulu Camii: dikdörtgen gövde, yirmi kubbenin önden görünen dizileri, iki minare. */
export function uluCami() {
  const parts = []
  // Arka sıradaki kubbeler (derinlik hissi; yirmi kubbenin arkadakiler).
  for (let i = 0; i < 5; i++) parts.push(`<path class="ln" d="${dome(230 + i * 135, 266, 52)}" ${FILL} ${THIN}/>`)
  // Gövde.
  parts.push(`<path class="ln" d="M150 500 L150 300 L850 300 L850 500 Z" ${FILL} ${STROKE}/>`)
  // Ön sıra kubbeler: kasnak + kubbe + alem.
  for (let i = 0; i < 5; i++) {
    const cx = 230 + i * 135
    parts.push(`<path class="ln" d="M${cx - 58} 300 L${cx - 58} 284 L${cx + 58} 284 L${cx + 58} 300 Z" ${FILL} ${STROKE}/>`)
    parts.push(`<path class="ln" d="${dome(cx, 284, 56)}" ${FILL} ${STROKE}/>`)
    parts.push(`<path class="ln" d="${finial(cx, 228)}" ${THIN}/>${finialBulbs(cx, 228)}`)
  }
  // Pencereler: iki sıra.
  for (let i = 0; i < 10; i++) {
    const x = 182 + i * 66
    parts.push(`<path class="ln" d="${arch(x, 330, 30, 46)}" ${THIN}/>`)
    if (i !== 4 && i !== 5) parts.push(`<path class="ln" d="${arch(x, 410, 30, 52)}" ${THIN}/>`)
  }
  // Taç kapı.
  parts.push(`<path class="ln" d="M452 500 L452 404 L548 404 L548 500" ${THIN}/>`)
  parts.push(`<path class="ln" d="${arch(470, 420, 60, 80)}" ${THIN}/>`)
  parts.push(minaret(110, 500, 70))
  parts.push(minaret(890, 500, 70))
  parts.push(`<path class="ln" d="M40 500 L960 500" ${STROKE}/>`)
  return parts.join('')
}

/** Koza Han: iki katlı revaklı cephe, ortada taç kapı, avludaki sekizgen köşk mescidin kubbesi. */
export function kozaHan() {
  const parts = []
  // Avludaki köşk mescit (cephenin arkasından görünen kubbe).
  parts.push(`<path class="ln" d="M440 250 L440 222 L560 222 L560 250 Z" ${FILL} ${STROKE}/>`)
  parts.push(`<path class="ln" d="${dome(500, 222, 54)}" ${FILL} ${STROKE}/>`)
  parts.push(`<path class="ln" d="${finial(500, 168)}" ${THIN}/>${finialBulbs(500, 168)}`)
  // Bacalar.
  for (const x of [190, 300, 700, 810]) parts.push(`<path class="ln" d="M${x - 8} 250 L${x - 8} 222 L${x + 8} 222 L${x + 8} 250" ${FILL} ${THIN}/>`)
  // Gövde ve kat silmesi.
  parts.push(`<path class="ln" d="M90 500 L90 250 L910 250 L910 500 Z" ${FILL} ${STROKE}/>`)
  parts.push(`<path class="ln" d="M90 372 L910 372" ${THIN}/>`)
  // Revaklar: üst ve alt kat.
  for (let i = 0; i < 11; i++) {
    const x = 112 + i * 72
    if (i === 5) continue
    parts.push(`<path class="ln" d="${arch(x, 270, 50, 92)}" ${THIN}/>`)
    parts.push(`<path class="ln" d="${arch(x, 392, 50, 108)}" ${THIN}/>`)
  }
  // Taç kapı (iki katı kesen yüksek kemer).
  parts.push(`<path class="ln" d="M452 500 L452 262 L548 262 L548 500" ${STROKE} fill="#232b66"/>`)
  parts.push(`<path class="ln" d="${arch(470, 300, 60, 200)}" ${THIN}/>`)
  parts.push(`<path class="ln" d="M40 500 L960 500" ${STROKE}/>`)
  return parts.join('')
}

/** Osman Gazi Türbesi: sekizgen gövde (ön ve yan yüzler), kasnak ve kubbe, iki sütunçeli giriş sundurması. */
export function osmanGaziTurbesi() {
  const parts = []
  // Kubbe ve kasnak.
  parts.push(`<path class="ln" d="M330 236 L330 206 L670 206 L670 236 Z" ${FILL} ${STROKE}/>`)
  parts.push(`<path class="ln" d="${dome(500, 206, 166)}" ${FILL} ${STROKE}/>`)
  parts.push(`<path class="ln" d="${finial(500, 40)}" ${THIN}/>${finialBulbs(500, 40)}`)
  // Sekizgenin yan yüzleri (daraltılmış) ve ön yüz.
  parts.push(`<path class="ln" d="M300 500 L300 252 L360 236 L360 500 Z" fill="#161b44" ${STROKE}/>`)
  parts.push(`<path class="ln" d="M700 500 L700 252 L640 236 L640 500 Z" fill="#161b44" ${STROKE}/>`)
  parts.push(`<path class="ln" d="M360 500 L360 236 L640 236 L640 500 Z" ${FILL} ${STROKE}/>`)
  // Pencereler.
  for (const x of [384, 586]) parts.push(`<path class="ln" d="${arch(x, 270, 30, 70)}" ${THIN}/>`)
  for (const x of [316, 664]) parts.push(`<path class="ln" d="${arch(x - 8, 300, 24, 60)}" ${THIN}/>`)
  // Sundurma: çatı, iki ince sütunçe, kapı.
  parts.push(`<path class="ln" d="M404 360 L596 360 L612 348 L388 348 Z" ${FILL} ${STROKE}/>`)
  parts.push(`<path class="ln" d="M426 360 L426 500 M574 360 L574 500" ${STROKE} fill="none"/>`)
  parts.push(`<path class="ln" d="${arch(470, 392, 60, 108)}" ${THIN}/>`)
  parts.push(`<path class="ln" d="M40 500 L960 500" ${STROKE}/>`)
  return parts.join('')
}
