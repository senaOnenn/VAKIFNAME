// Tanıtım filmi, 3D sahneler (8 Kasım): eserlerin temsilî maketleri (rölöve değildir) ve kâşiflerin kabartma hâli.
// HyperFrames seek protokolü: her kare yalnızca zamandan çizilir (`hf-seek` → renderAt(t)); saat/RAF yok, rastgelelik yok.
// Ayarlar build.mjs'ten gelir: window.__vk3d = { scenes: [{ canvas, kind, start, dur, w, h, ... }] } (film saniyesi).
// Görünüm palet A: gece laciverdi gövde, altın çizgi; pencerelerde sıcak ışık. Kâşifler Buse'nin çizimleridir: düz görsel
// silüetinden hesaplanan bir yükseklik haritasıyla kabartılır (gerçek 3D model değil; dönünce hacim hissi verir).
import * as T from '../vendor/three.min.js'

const CFG = window.__vk3d
const GOLD = 0xc9a24b
const GOLD_BRIGHT = 0xe9c874
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3)
const easeInOut = (x) => {
  x = clamp01(x)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
const lerp = (a, b, u) => a + (b - a) * u
const deg = Math.PI / 180

// --- Maket yapım takımı -------------------------------------------------------------------------------------------
class Kit {
  constructor(w, h) {
    this.group = new T.Group()
    this.plane = new T.Plane(new T.Vector3(0, -1, 0), 1e4) // y <= sabit görünür (yükselerek "inşa")
    const clip = [this.plane]
    this.size = [w, h]
    this.solid = new T.MeshStandardMaterial({ color: 0x27306f, roughness: 0.82, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: clip })
    this.hullMat = new T.MeshBasicMaterial({ color: GOLD, side: T.BackSide, clippingPlanes: clip })
    this.glowMat = new T.MeshBasicMaterial({ color: GOLD_BRIGHT, transparent: true, opacity: 0.38, side: T.DoubleSide, depthWrite: false, clippingPlanes: clip })
    this.metal = new T.MeshStandardMaterial({ color: GOLD_BRIGHT, roughness: 0.45, metalness: 0.7, clippingPlanes: clip })
    this.seg = []
    this.top = 0
  }
  line(a, b) {
    this.seg.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }
  poly(pts, closed = false) {
    for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i], pts[i + 1])
    if (closed) this.line(pts[pts.length - 1], pts[0])
  }
  add(mesh) {
    this.group.add(mesh)
    return mesh
  }
  edges(mesh, threshold = 30) {
    mesh.updateMatrix()
    const eg = new T.EdgesGeometry(mesh.geometry, threshold)
    eg.applyMatrix4(mesh.matrix)
    this.seg.push(...eg.attributes.position.array)
  }
  hull(geom, pos, w) {
    const g = geom.clone()
    const p = g.attributes.position
    const n = g.attributes.normal
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * w, p.getY(i) + n.getY(i) * w, p.getZ(i) + n.getZ(i) * w)
    const m = new T.Mesh(g, this.hullMat)
    m.position.copy(pos)
    this.group.add(m)
  }
  /** Kutu; y tabandır. */
  box(w, h, d, x, y, z) {
    const m = this.add(new T.Mesh(new T.BoxGeometry(w, h, d), this.solid))
    m.position.set(x, y + h / 2, z)
    this.edges(m)
    return m
  }
  /** Silindir/koni; y tabandır. Kenar sayısı az ise (8) dikey kenarlar çizilir, çoksa yalnızca ağızlar + dış hat. */
  cyl(rt, rb, h, x, y, z, seg = 16, hullW = 0.14) {
    const g = new T.CylinderGeometry(rt, rb, h, seg, 1, false)
    const m = this.add(new T.Mesh(g, this.solid))
    m.position.set(x, y + h / 2, z)
    this.edges(m, 40)
    if (seg > 8) this.hull(g, m.position, hullW)
    return m
  }
  dome(r, x, y, z, ribs = 8, squash = 1) {
    const g = new T.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    g.scale(1, squash, 1)
    const m = this.add(new T.Mesh(g, this.solid))
    m.position.set(x, y, z)
    this.hull(g, m.position, r * 0.035)
    const ring = []
    for (let i = 0; i <= 48; i++) ring.push([x + Math.cos((i / 48) * Math.PI * 2) * r, y, z + Math.sin((i / 48) * Math.PI * 2) * r])
    this.poly(ring)
    for (let k = 0; k < ribs; k++) {
      const a = (k / ribs) * Math.PI * 2
      const pts = []
      for (let j = 0; j <= 12; j++) {
        const phi = ((j / 12) * Math.PI) / 2
        pts.push([x + Math.cos(a) * Math.cos(phi) * r * 1.004, y + Math.sin(phi) * r * squash * 1.004, z + Math.sin(a) * Math.cos(phi) * r * 1.004])
      }
      this.poly(pts)
    }
    this.finial(x, y + r * squash, z, r * 0.32)
    return m
  }
  /** Alem: dikey çubuk ve iki küre (yatay çubuk yok). */
  finial(x, y, z, s) {
    this.line([x, y, z], [x, y + s * 1.5, z])
    for (const [dy, rr] of [[0.6, 0.2], [1.15, 0.14]]) {
      const b = this.add(new T.Mesh(new T.SphereGeometry(s * rr, 12, 8), this.metal))
      b.position.set(x, y + s * dy, z)
    }
  }
  /**
   * Kemerli açıklık (pencere/kapı) bir cephede: face = { n: 'z'|'x', at, sign }; s cephe boyunca konum, y taban.
   * Çizgi + sıcak ışık dolgusu.
   */
  arch(face, s, y, w, h, glow = true) {
    const off = 0.07 * face.sign
    const P = (u, v) => (face.n === 'z' ? [s + u, y + v, face.at + off] : [face.at + off, y + v, s + u * face.sign])
    const pts = [P(-w / 2, 0), P(-w / 2, h - w / 2)]
    for (let i = 1; i < 12; i++) {
      const a = Math.PI - (i / 12) * Math.PI
      pts.push(P(Math.cos(a) * (w / 2), h - w / 2 + Math.sin(a) * (w / 2)))
    }
    pts.push(P(w / 2, h - w / 2), P(w / 2, 0))
    this.poly(pts, true)
    if (!glow) return
    const shape = new T.Shape()
    shape.moveTo(-w / 2, 0)
    shape.lineTo(-w / 2, h - w / 2)
    shape.absarc(0, h - w / 2, w / 2, Math.PI, 0, true)
    shape.lineTo(w / 2, 0)
    shape.closePath()
    const m = new T.Mesh(new T.ShapeGeometry(shape, 10), this.glowMat)
    if (face.n === 'z') {
      m.position.set(s, y, face.at + off * 0.6)
    } else {
      m.position.set(face.at + off * 0.6, y, s)
      m.rotation.y = (Math.PI / 2) * face.sign
    }
    this.group.add(m)
  }
  /** Zemin: alçak kaide + temas gölgesi + altın ışık havuzu. */
  base(w, d) {
    this.box(w + 10, 0.9, d + 10, 0, -0.9, 0)
    const pool = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: radialTexture('rgba(201,162,75,0.32)', 'rgba(201,162,75,0)'), transparent: true, depthWrite: false }))
    pool.rotation.x = -Math.PI / 2
    pool.position.y = -0.95
    pool.scale.set((w + 10) * 2.4, (d + 10) * 2.4, 1)
    pool.renderOrder = -1
    this.group.add(pool)
  }
  finish(width = 2.6) {
    const geo = new T.LineSegmentsGeometry().setPositions(this.seg)
    this.lineMat = new T.LineMaterial({ color: GOLD, linewidth: width, worldUnits: false, clippingPlanes: [this.plane] })
    this.lineMat.resolution.set(this.size[0], this.size[1])
    this.group.add(new T.LineSegments2(geo, this.lineMat))
    this.top = new T.Box3().setFromObject(this.group).max.y
    return this
  }
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grd.addColorStop(0, inner)
  grd.addColorStop(1, outer)
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 256)
  const t = new T.CanvasTexture(c)
  t.colorSpace = T.SRGBColorSpace
  return t
}

// --- Eserler (temsilî; ölçüler kitaptaki mertebelerde) ---------------------------------------------------------------
function minaret(k, x, z) {
  k.box(5, 15, 5, x, 0, z)
  k.cyl(1.9, 2.1, 20, x, 15, z, 12)
  k.cyl(2.9, 2.4, 1.2, x, 31, z, 16) // şerefe
  k.cyl(1.7, 1.8, 6, x, 35, z, 12)
  k.cyl(0.05, 2.0, 8, x, 41, z, 16) // külah
  k.finial(x, 49, z, 1.4)
}

function uluCami(k) {
  // 69 × 55 m, yirmi kubbe (5 × 4), iki minare (kitap: Cilt I s. 25–26).
  const W = 69
  const D = 55
  const H = 14
  k.base(W, D)
  k.box(W, H, D, 0, 0, 0)
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      const x = -W / 2 + (W / 5) * (i + 0.5)
      const z = -D / 2 + (D / 4) * (j + 0.5)
      const lift = i === 2 ? 1.8 : 0
      k.cyl(5.5, 5.8, 2.2 + lift, x, H, z, 8)
      k.dome(5.6, x, H + 2.2 + lift, z, 8, 0.9)
    }
  }
  const front = { n: 'z', at: D / 2, sign: 1 }
  for (let i = 0; i < 10; i++) {
    const s = -W / 2 + 3.45 + i * 6.9
    if (i !== 4 && i !== 5) k.arch(front, s, 2.2, 2.3, 4.4)
    k.arch(front, s, 8.4, 2.0, 3.6)
  }
  for (const sg of [-1, 1]) {
    const side = { n: 'x', at: (W / 2) * sg, sign: sg }
    for (let i = 0; i < 8; i++) {
      const s = -D / 2 + 3.4 + i * 6.9
      k.arch(side, s, 2.2, 2.3, 4.4)
      k.arch(side, s, 8.4, 2.0, 3.6)
    }
  }
  // Taç kapı.
  k.box(12, 15.5, 2.4, 0, 0, D / 2 + 1.2)
  k.arch({ n: 'z', at: D / 2 + 2.4, sign: 1 }, 0, 0, 6, 10.5)
  minaret(k, -W / 2 - 2.6, D / 2 - 2.6)
  minaret(k, W / 2 + 2.6, D / 2 - 2.6)
}

function kozaHan(k) {
  // İki katlı, avlulu han; avluda sekizgen köşk mescit (Cilt II).
  const W = 64
  const D = 56
  const H = 12
  const t = 10
  k.base(W, D)
  k.box(W, H, t, 0, 0, D / 2 - t / 2)
  k.box(W, H, t, 0, 0, -D / 2 + t / 2)
  k.box(t, H, D - 2 * t, -W / 2 + t / 2, 0, 0)
  k.box(t, H, D - 2 * t, W / 2 - t / 2, 0, 0)
  // Dış cephe pencereleri ve taç kapı.
  const front = { n: 'z', at: D / 2, sign: 1 }
  for (let i = 0; i < 12; i++) {
    const s = -W / 2 + 3.2 + i * 5.24
    if (Math.abs(s) < 9) continue
    k.arch(front, s, 3.4, 1.4, 2.4)
    k.arch(front, s, 8.0, 1.4, 2.4)
  }
  k.box(16, 15, 3.6, 0, 0, D / 2 + 1.8)
  k.arch({ n: 'z', at: D / 2 + 3.6, sign: 1 }, 0, 0, 7, 11)
  // Avlu revakları: iç cephelerde iki sıra kemer (sıcak ışıklı).
  const inner = [
    { face: { n: 'z', at: D / 2 - t, sign: -1 }, len: W - 2 * t },
    { face: { n: 'z', at: -D / 2 + t, sign: 1 }, len: W - 2 * t },
    { face: { n: 'x', at: -W / 2 + t, sign: 1 }, len: D - 2 * t },
    { face: { n: 'x', at: W / 2 - t, sign: -1 }, len: D - 2 * t },
  ]
  for (const { face, len } of inner) {
    const n = Math.round(len / 4.4)
    for (let i = 0; i < n; i++) {
      const s = -len / 2 + (len / n) * (i + 0.5)
      k.arch(face, s, 0, 3.2, 5.0)
      k.arch(face, s, 6.3, 3.0, 4.6)
    }
  }
  // Köşk mescit: sekiz ayak, sekizgen oda, kubbe.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    k.box(0.9, 4, 0.9, Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6)
  }
  k.cyl(5.2, 5.2, 4, 0, 4, 0, 8)
  k.dome(4.4, 0, 8, 0, 8, 0.95)
}

function turbe(k) {
  // Osman Gazi Türbesi (1863, Sultan Abdülaziz): kare gövde, saçak, kasnak, büyük kubbe.
  const S = 18
  const H = 11
  k.base(S + 4, S + 4)
  k.box(S + 4, 1.2, S + 4, 0, 0, 0)
  k.box(S, H, S, 0, 1.2, 0)
  k.box(S + 1.6, 1.0, S + 1.6, 0, 1.2 + H, 0)
  k.cyl(7.3, 7.6, 2.4, 0, 2.2 + H, 0, 24)
  k.dome(7.4, 0, 4.6 + H, 0, 12, 0.95)
  for (const [n, sg] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]]) {
    const face = { n, at: (S / 2) * sg, sign: sg }
    for (const s of [-5.4, 0, 5.4]) {
      if (n === 'z' && sg === 1 && s === 0) continue
      k.arch(face, s, 3.2, 2.4, 4.6)
      k.arch(face, s, 8.9, 1.6, 2.0)
    }
  }
  k.box(7, 8, 2.4, 0, 1.2, S / 2 + 1.2)
  k.arch({ n: 'z', at: S / 2 + 2.4, sign: 1 }, 0, 1.2, 3.6, 5.8)
}

const BUILD = { ulu: uluCami, koza: kozaHan, turbe }

// --- Işık --------------------------------------------------------------------------------------------------------
function lights(scene, strong = 1) {
  scene.add(new T.HemisphereLight(0x8fa2ff, 0x0b0e26, 1.1 * strong))
  const key = new T.DirectionalLight(0xffd9a0, 2.2 * strong)
  key.position.set(-60, 90, 120)
  scene.add(key)
  const rim = new T.DirectionalLight(0x4a5bff, 1.4 * strong)
  rim.position.set(80, 40, -120)
  scene.add(rim)
}

function renderer(canvas, w, h) {
  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  r.setPixelRatio(1)
  r.setSize(w, h, false)
  r.outputColorSpace = T.SRGBColorSpace
  r.localClippingEnabled = true
  r.setClearColor(0x000000, 0)
  return r
}

// Kamera yolları: yerel ilerleme u (0–1) → azimut/yükseklik/uzaklık. "Bir dalış on dönüşten iyidir": yavaş yaklaşma + az dönüş.
const CAM = {
  ulu: { az: [30, 12], el: [18, 14], dist: [252, 222], target: [0, 17, 0], fov: 30 },
  koza: { az: [-34, -16], el: [34, 28], dist: [245, 215], target: [0, 5, 0], fov: 30 },
  turbe: { az: [28, 8], el: [15, 11], dist: [134, 116], target: [0, 11, 0], fov: 30 },
  trio: { az: [-8, 6], el: [15, 12], dist: [350, 315], target: [0, 17, 0], fov: 30 },
}

function place(cam, spec, u) {
  const e = easeInOut(u)
  const az = lerp(spec.az[0], spec.az[1], e) * deg
  const el = lerp(spec.el[0], spec.el[1], e) * deg
  const d = lerp(spec.dist[0], spec.dist[1], e)
  const [tx, ty, tz] = spec.target
  cam.position.set(tx + Math.sin(az) * Math.cos(el) * d, ty + Math.sin(el) * d, tz + Math.cos(az) * Math.cos(el) * d)
  cam.lookAt(tx, ty, tz)
}

function monumentScene(cfg) {
  const canvas = document.getElementById(cfg.canvas)
  const r = renderer(canvas, cfg.w, cfg.h)
  const scene = new T.Scene()
  lights(scene)
  const cam = new T.PerspectiveCamera(CAM[cfg.kind].fov, cfg.w / cfg.h, 1, 2000)
  if (cfg.center) {
    // Görüş merkezini kaydır: model kadrajın (cx, cy) noktasında durur, kenarlarda kesilme olmaz.
    const [cx, cy] = cfg.center
    const FW = cfg.w + 2 * Math.abs(cfg.w / 2 - cx)
    const FH = cfg.h + 2 * Math.abs(cfg.h / 2 - cy)
    cam.aspect = FW / FH
    cam.setViewOffset(FW, FH, FW / 2 - cx, FH / 2 - cy, cfg.w, cfg.h)
  }
  const kits = []
  if (cfg.kind === 'trio') {
    // Üç eser yan yana (maket ölçeği eşitlenmiş; gerçek boyut oranı değil).
    for (const [kind, x, s, z] of [['koza', -102, 0.78, 0], ['ulu', 0, 0.85, -10], ['turbe', 96, 1.7, 6]]) {
      const k = new Kit(cfg.w, cfg.h)
      BUILD[kind](k)
      k.finish(2.2)
      k.group.position.set(x, 0, z)
      k.group.scale.setScalar(s)
      k.top *= s
      kits.push(k)
      scene.add(k.group)
    }
  } else {
    const k = new Kit(cfg.w, cfg.h)
    BUILD[cfg.kind](k)
    k.finish(2.6)
    kits.push(k)
    scene.add(k.group)
  }
  return {
    cfg,
    draw(t) {
      const local = t - cfg.start
      const u = local / cfg.dur
      place(cam, CAM[cfg.kind], u)
      kits.forEach((k, i) => {
        // Düzlem dünya koordinatındadır: gruba uygulanan ölçek kesite de uygulanır.
        const delay = cfg.kind === 'trio' ? 0.35 + i * 0.85 : 0.15
        const build = cfg.kind === 'trio' ? 1.6 : 2.1
        const v = clamp01((local - delay) / build)
        k.plane.constant = v >= 1 ? 1e4 : lerp(-1.2, k.top + 1, easeOut(v))
      })
      r.render(scene, cam)
    },
  }
}

// --- Kâşif kabartması --------------------------------------------------------------------------------------------
async function relief(url, heightUnits) {
  const img = new Image()
  img.src = url
  await img.decode()
  const sw = 150
  const sh = Math.round((sw * img.height) / img.width)
  const cv = document.createElement('canvas')
  cv.width = sw
  cv.height = sh
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, sw, sh)
  const px = ctx.getImageData(0, 0, sw, sh).data
  const N = sw * sh
  const d = new Float32Array(N)
  for (let i = 0; i < N; i++) d[i] = px[i * 4 + 3] > 90 ? 1e6 : 0
  // Silüet içinde kenara uzaklık (iki geçişli yaklaşık uzaklık dönüşümü).
  const at = (x, y) => (x < 0 || y < 0 || x >= sw || y >= sh ? 0 : d[y * sw + x])
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x
      if (d[i] > 0) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414)
    }
  for (let y = sh - 1; y >= 0; y--)
    for (let x = sw - 1; x >= 0; x--) {
      const i = y * sw + x
      if (d[i] > 0) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414)
    }
  const prof = (v, R) => (v >= R ? 1 : Math.sqrt(1 - Math.pow(1 - v / R, 2)))
  let hgt = new Float32Array(N)
  for (let i = 0; i < N; i++) hgt[i] = d[i] > 0 ? 0.55 * prof(d[i], 9) + 0.45 * prof(d[i], 34) : 0
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(N)
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let s = 0
        let c = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue
            s += hgt[yy * sw + xx]
            c++
          }
        out[y * sw + x] = s / c
      }
    hgt = out
  }
  const widthUnits = (heightUnits * img.width) / img.height
  const depth = widthUnits * 0.13
  const g = new T.PlaneGeometry(widthUnits, heightUnits, sw - 1, sh - 1)
  const pos = g.attributes.position
  for (let i = 0; i < N; i++) pos.setZ(i, hgt[i] * depth)
  g.computeVertexNormals()
  const tex = new T.Texture(img)
  tex.colorSpace = T.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  const mat = new T.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.78, metalness: 0, side: T.DoubleSide })
  return new T.Mesh(g, mat)
}

async function kasifScene(cfg) {
  const canvas = document.getElementById(cfg.canvas)
  const r = renderer(canvas, cfg.w, cfg.h)
  const scene = new T.Scene()
  scene.add(new T.HemisphereLight(0xfff4e0, 0x2a2f60, 1.5))
  const key = new T.DirectionalLight(0xffe2b8, 2.0)
  key.position.set(-6, 8, 10)
  scene.add(key)
  const rim = new T.DirectionalLight(0x8fa2ff, 1.2)
  rim.position.set(8, 3, -6)
  scene.add(rim)
  const cam = new T.PerspectiveCamera(28, cfg.w / cfg.h, 0.1, 100)
  cam.position.set(0, 0.6, 24)
  cam.lookAt(0, 0.3, 0)
  const H = 8.6
  const chars = []
  for (const [who, x, phase] of [['kadin', -cfg.spread, 0], ['erkek', cfg.spread, 1.7]]) {
    const holder = new T.Group()
    holder.position.set(x, 0, 0)
    const meshes = await Promise.all(cfg.images[who].map((u) => relief(u, H)))
    meshes.forEach((m) => {
      m.visible = false
      holder.add(m)
    })
    // Kaide halkası.
    const ring = new T.Mesh(new T.TorusGeometry(2.2, 0.05, 8, 64), new T.MeshStandardMaterial({ color: GOLD_BRIGHT, roughness: 0.4, metalness: 0.7 }))
    ring.rotation.x = Math.PI / 2
    ring.scale.set(1, 0.42, 1)
    ring.position.set(x, -H / 2 + 0.05, 0)
    scene.add(ring)
    scene.add(holder)
    chars.push({ holder, meshes, phase, lag: who === 'erkek' ? 0.12 : 0 })
  }
  return {
    cfg,
    draw(t) {
      const local = t - cfg.start
      for (const c of chars) {
        let level = 0
        let flip = 0
        cfg.flips.forEach((f0, i) => {
          const f = f0 + c.lag
          if (local >= f) level = i + 1
          if (local >= f - 0.24 && local < f) flip = (Math.PI / 2) * Math.pow((local - (f - 0.24)) / 0.24, 2)
          else if (local >= f && local < f + 0.34) flip = -(Math.PI / 2) * (1 - easeOut((local - f) / 0.34))
        })
        c.meshes.forEach((m, i) => (m.visible = i === level))
        const sway = 0.3 * Math.sin(((local + c.phase) / 6.2) * Math.PI * 2)
        c.holder.rotation.y = sway + flip
        c.holder.position.y = 0.08 * Math.sin(((local + c.phase) / 3.1) * Math.PI * 2)
      }
      r.render(scene, cam)
    },
  }
}

// --- Seek ---------------------------------------------------------------------------------------------------------
const views = []
let ready = false
function renderAt(t) {
  if (!ready) return
  for (const v of views) {
    const { start, dur } = v.cfg
    if (t >= start - 0.05 && t <= start + dur + 0.05) v.draw(Math.min(Math.max(t, start), start + dur))
  }
}
window.addEventListener('hf-seek', (e) => renderAt(e.detail.time))

try {
  for (const s of CFG.scenes) views.push(s.kind === 'kasif' ? await kasifScene(s) : monumentScene(s))
  ready = true
  // İlk kare her canvas'ta bir kez çizilir (gölgelendirici derlemesi burada olur, render sırasında değil).
  for (const v of views) v.draw(v.cfg.start + v.cfg.dur * 0.5)
  renderAt(window.__vk3dTime ?? 0)
  window.__vk3dDone()
} catch (err) {
  window.__vk3dFail(err)
  throw err
}
