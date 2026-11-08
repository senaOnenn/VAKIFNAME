// Kayıp Vakfiye, film sürümü (8 Kasım): yırtılmış bir parşömen, parça parça birleşir. 5 × 2 = 10 parça (pilottaki 10 eser,
// ürünün yapbozuyla aynı sayı). Komşu parçalar aynı yırtık kenarı paylaşır: yerine oturduklarında boşluksuz birleşir.
// Tohumlu rastgele: her derlemede aynı yırtık. Yazı satırları el yazısı dokusudur (okunur harf taklit edilmez); başlık ve
// mühür Latin harfli. Altın hâli ayrı bir mürekkep katmanıdır (film opaklığıyla geçer).

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r1 = (n) => Number(n.toFixed(1))

/** a→b arası yırtık çizgi: alt bölümlere ayrılır, her ara nokta dik doğrultuda kaydırılır (iri dalga + ince lif). */
function tear(a, b, R, amp) {
  const n = 16
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const pts = [a]
  const phase = R() * Math.PI * 2
  for (let i = 1; i < n; i++) {
    const u = i / n
    const wave = Math.sin(u * Math.PI * 2 + phase) * amp * 0.6
    const fiber = (R() - 0.5) * amp * 1.4
    const k = wave + fiber
    pts.push({ x: a.x + dx * u + nx * k, y: a.y + dy * u + ny * k })
  }
  pts.push(b)
  return pts
}

/**
 * Parşömen SVG'si. `id` öneki tanımların çakışmasını önler (aynı sayfada iki parşömen olabilir).
 * Döner: { svg, pieces: [{ i, cx, cy }] } — her parça `.tp.tp-<i>` sınıflı bir <g>; içinde `.gilt` altın mürekkep katmanı.
 * `holes`: parçaların yeri kesikli çizgiyle gösterilir (eksik parçalar görünür).
 * `whole`: parçaların üstünde, başta görünmez, tek parça parşömen (`.whole`): birleşince açılır, dikiş ve gölge kalmaz;
 * altınlaşma bunun üzerinde olur (`.wash` altın örtü, `.gilt` altın mürekkep, `.sweep` ışık geçişi).
 */
export function parchment({ id, w = 1000, h = 620, cols = 5, rows = 2, seed = 11, holes = false, whole = false }) {
  const R = rng(seed)
  // Izgara noktaları: iç noktalar oynatılır, kenardakiler kenarda kalır.
  const P = []
  for (let r = 0; r <= rows; r++) {
    P.push([])
    for (let c = 0; c <= cols; c++) {
      const inX = c > 0 && c < cols
      const inY = r > 0 && r < rows
      P[r].push({
        x: (c * w) / cols + (inX ? (R() - 0.5) * (w / cols) * 0.34 : 0),
        y: (r * h) / rows + (inY ? (R() - 0.5) * (h / rows) * 0.3 : 0),
      })
    }
  }
  const edgeAmp = (outer) => (outer ? 4 : 11)
  const Hz = [] // Hz[r][c]: P[r][c] → P[r][c+1]
  const Vt = [] // Vt[r][c]: P[r][c] → P[r+1][c]
  for (let r = 0; r <= rows; r++) Hz.push(Array.from({ length: cols }, (_, c) => tear(P[r][c], P[r][c + 1], R, edgeAmp(r === 0 || r === rows))))
  for (let r = 0; r < rows; r++) Vt.push(Array.from({ length: cols + 1 }, (_, c) => tear(P[r][c], P[r + 1][c], R, edgeAmp(c === 0 || c === cols))))

  const pieces = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const poly = [...Hz[r][c], ...Vt[r][c + 1].slice(1), ...[...Hz[r + 1][c]].reverse().slice(1), ...[...Vt[r][c]].reverse().slice(1, -1)]
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length
      pieces.push({ i: r * cols + c, d: 'M' + poly.map((p) => `${r1(p.x)} ${r1(p.y)}`).join(' L') + ' Z', cx: r1(cx), cy: r1(cy) })
    }
  }

  // El yazısı dokusu: satır satır "kelime" kıvrımları (harf değil). Sağdan sola yazılmış gibi sağa yaslı başlar.
  const ink = []
  const top = 178
  const lines = 8
  const lh = (h - top - 150) / (lines - 1)
  for (let l = 0; l < lines; l++) {
    const y = top + l * lh
    let x = w - 92
    const endX = l === lines - 1 ? w * 0.45 : 92
    while (x > endX + 30) {
      const wl = 36 + R() * 84
      const a0 = x - wl
      const amp = 3 + R() * 5
      const fr = 0.12 + R() * 0.1
      let d = ''
      for (let s = 0; s <= 24; s++) {
        const xx = x - (wl * s) / 24
        const yy = y + Math.sin(s * fr * 6 + R() * 0.6) * amp - (s === 12 && R() > 0.6 ? 10 : 0)
        d += (s ? ' L' : 'M') + `${r1(xx)} ${r1(yy)}`
      }
      ink.push(d)
      // Ara sıra nokta (harekeyi andıran tek nokta; harf değil).
      if (R() > 0.55) ink.push(`M${r1(a0 + wl * R())} ${r1(y - 14 - R() * 6)} l0.1 0`)
      x = a0 - (10 + R() * 18)
    }
  }
  const inkPath = ink.join(' ')
  const outline = (() => {
    const all = [...Hz[0].flatMap((e) => e.slice(0, -1)), ...Vt.map((row) => row[cols]).flatMap((e) => e.slice(0, -1))]
    const bottom = [...Hz[rows]].reverse().flatMap((e) => [...e].reverse().slice(0, -1))
    const left = [...Vt].reverse().map((row) => row[0]).flatMap((e) => [...e].reverse().slice(0, -1))
    return 'M' + [...all, ...bottom, ...left].map((p) => `${r1(p.x)} ${r1(p.y)}`).join(' L') + ' Z'
  })()

  const sealX = w / 2
  const sealY = h - 78
  const defs = `<defs>
    <radialGradient id="${id}-paper-g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#f4e8c9"/><stop offset="0.7" stop-color="#e7d3a3"/><stop offset="1" stop-color="#c9a96a"/></radialGradient>
    <filter id="${id}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.022 0.035" numOctaves="3" seed="4"/>
      <feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.29  0 0 0 0 0.13  0 0 0 0.55 -0.05"/></filter>
    <filter id="${id}-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#05061a" flood-opacity="0.65"/></filter>
    <g id="${id}-paper">
      <path d="${outline}" fill="url(#${id}-paper-g)"/>
      <rect width="${w}" height="${h}" filter="url(#${id}-grain)" opacity="0.5"/>
      <rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="#7a5428" stroke-width="2.4" opacity="0.65"/>
      <rect x="50" y="50" width="${w - 100}" height="${h - 100}" fill="none" stroke="#7a5428" stroke-width="1" opacity="0.5"/>
      <text x="${w / 2}" y="128" text-anchor="middle" font-family="VAKIFNAME Serif, Georgia, serif" font-size="54" font-weight="700" letter-spacing="10" fill="#5a3a1c">VAKFİYE</text>
    </g>
    <g id="${id}-ink" stroke-linecap="round" stroke-linejoin="round">
      <path d="${inkPath}" fill="none" stroke-width="3.4"/>
      <circle cx="${sealX}" cy="${sealY}" r="44" fill="none" stroke-width="4"/><circle cx="${sealX}" cy="${sealY}" r="35" fill="none" stroke-width="1.6"/>
      <text x="${sealX}" y="${sealY + 13}" text-anchor="middle" font-family="VAKIFNAME Serif, Georgia, serif" font-size="38" font-weight="700" stroke="none">V</text>
    </g>
  </defs>`

  const piece = (p) => `<g class="tp tp-${p.i}" data-cx="${p.cx}" data-cy="${p.cy}" filter="url(#${id}-shadow)">
      <clipPath id="${id}-c${p.i}"><path d="${p.d}"/></clipPath>
      <g clip-path="url(#${id}-c${p.i})">
        <use href="#${id}-paper"/>
        <use href="#${id}-ink" class="ink-k" stroke="#4a2f17" fill="#7c2418"/>
        <use href="#${id}-ink" class="gilt" stroke="#c9a24b" fill="#c9a24b" style="opacity:0"/>
      </g>
      <path class="tear" d="${p.d}" fill="none" stroke="#fbf3dc" stroke-width="2.6" stroke-linejoin="round" opacity="0.9"/>
    </g>`
  const wholeG = whole
    ? `<g class="whole" style="opacity:0" filter="url(#${id}-shadow)">
      <clipPath id="${id}-all"><path d="${outline}"/></clipPath>
      <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d98a"/><stop offset="0.5" stop-color="#d9a93e"/><stop offset="1" stop-color="#f1cf73"/></linearGradient>
      <linearGradient id="${id}-sweep-g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff8e1" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <g clip-path="url(#${id}-all)">
        <use href="#${id}-paper"/>
        <rect class="wash" width="${w}" height="${h}" fill="url(#${id}-gold)" style="opacity:0;mix-blend-mode:multiply"/>
        <use href="#${id}-ink" class="ink-k" stroke="#4a2f17" fill="#7c2418"/>
        <use href="#${id}-ink" class="gilt" stroke="#7a4f0c" fill="#8a5a10" style="opacity:0"/>
        <rect class="sweep" x="-200" y="-100" width="260" height="${h + 200}" fill="url(#${id}-sweep-g)" transform="rotate(14 ${w / 2} ${h / 2})" style="mix-blend-mode:screen"/>
      </g>
    </g>`
    : ''
  const holePaths = holes ? `<g class="holes">${pieces.map((p) => `<path class="hole hole-${p.i}" d="${p.d}"/>`).join('')}</g>` : ''
  const svg = `<svg class="parsomen" viewBox="-60 -60 ${w + 120} ${h + 140}" width="${w + 120}" height="${h + 140}">${defs}${holePaths}
    <g class="pieces">${pieces.map(piece).join('')}</g>${wholeG}
    <path class="seam-glow" d="${outline}" fill="none" stroke="#e9c874" stroke-width="5" style="opacity:0"/></svg>`
  return { svg, pieces }
}

/** Dağınık başlangıç konumları (tohumlu): her parça çerçevenin dışından, dönerek gelir. */
export function scatter(n, seed = 5, spread = { x: 760, y: 420 }) {
  const R = rng(seed)
  return Array.from({ length: n }, (_, i) => {
    const ang = (i / n) * Math.PI * 2 + R() * 0.7
    return { x: r1(Math.cos(ang) * spread.x * (0.8 + R() * 0.4)), y: r1(Math.sin(ang) * spread.y * (0.8 + R() * 0.4)), rot: r1((R() - 0.5) * 70) }
  })
}
