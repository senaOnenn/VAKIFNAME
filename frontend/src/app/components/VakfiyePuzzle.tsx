import { useId } from 'react'
import './vakfiye-puzzle.css'
import { useLang } from '../i18n'

export type PieceState = 'missing' | 'found' | 'gold'

const COLS = 5
const ROWS = 2
const W = 1000
const H = 600
const CW = W / COLS
const CH = H / ROWS

/** Kenar üzerinde yuvarlak bir yapboz dili: `sign` +1 dışa, -1 içe; düz kenar için 0. Saat yönünde dolaşılır. */
function edge(x0: number, y0: number, x1: number, y1: number, sign: number): string {
  if (!sign) return `L${x1},${y1}`
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  const [ux, uy] = [dx / len, dy / len]
  const [nx, ny] = [uy * sign, -ux * sign] // saat yönünde dışa dönük normal
  const k = Math.min(CW, CH) * 0.2
  const p = (t: number, m: number) => `${(x0 + dx * t + nx * k * m).toFixed(1)},${(y0 + dy * t + ny * k * m).toFixed(1)}`
  return `L${p(0.36, 0)} C${p(0.4, 0.45)} ${p(0.28, 1.05)} ${p(0.5, 1.05)} C${p(0.72, 1.05)} ${p(0.6, 0.45)} ${p(0.64, 0)} L${x1},${y1}`
}

// Sabit desen: komşu iki parçanın ortak kenarında biri dışa, diğeri içe dil verir.
const tabDown = (c: number) => (c % 2 === 0 ? 1 : -1)
const tabRight = (r: number, c: number) => ((r + c) % 2 === 0 ? 1 : -1)

export function piecePath(r: number, c: number): string {
  const x0 = c * CW
  const y0 = r * CH
  const x1 = x0 + CW
  const y1 = y0 + CH
  const top = r === 0 ? 0 : -tabDown(c)
  const right = c === COLS - 1 ? 0 : tabRight(r, c)
  const bottom = r === ROWS - 1 ? 0 : tabDown(c)
  const left = c === 0 ? 0 : -tabRight(r, c - 1)
  return `M${x0},${y0} ${edge(x0, y0, x1, y0, top)} ${edge(x1, y0, x1, y1, right)} ${edge(x1, y1, x0, y1, bottom)} ${edge(x0, y1, x0, y0, left)} Z`
}

/** Vakfiye belgesinin temsilî çizimi (gerçek vakfiye metni değildir; yazı soyut çizgilerle gösterilir). */
function Document({ id }: { id: string }) {
  const lines = Array.from({ length: 14 }, (_, i) => i)
  return (
    <g>
      <rect x="0" y="0" width={W} height={H} fill={`url(#${id}-paper)`} />
      <rect x="22" y="22" width={W - 44} height={H - 44} fill="none" stroke="#b4893a" strokeWidth="5" />
      <rect x="36" y="36" width={W - 72} height={H - 72} fill="none" stroke="#b4893a" strokeWidth="1.5" />
      <g transform={`translate(${W / 2},118)`} fill="none" stroke="#9a7330" strokeWidth="2">
        <circle r="62" />
        <circle r="48" />
        <path d="M0-62 L14-14 L62 0 L14 14 L0 62 L-14 14 L-62 0 L-14-14Z" />
        <path d="M44-44 L10 0 L44 44 L0 10 L-44 44 L-10 0 L-44-44 L0-10Z" opacity="0.7" />
      </g>
      {lines.map((i) => (
        <line key={i} x1={120 + (i % 3) * 14} x2={W - 120 - ((i * 37) % 90)} y1={218 + i * 22} y2={218 + i * 22} stroke="#6b5226" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${40 + (i * 13) % 50} 9 ${20 + (i * 7) % 30} 7`} opacity="0.55" />
      ))}
      <g transform={`translate(${W - 160},${H - 92})`}>
        <circle r="44" fill="#8e2a3a" />
        <circle r="34" fill="none" stroke="#f3ead3" strokeWidth="2" opacity="0.6" />
        <path d="M0-20 L5-6 L20-6 L8 3 L12 18 L0 9 L-12 18 L-8 3 L-20-6 L-5-6Z" fill="#f3ead3" opacity="0.8" />
      </g>
    </g>
  )
}

/**
 * Kayıp Vakfiye: 10 parçalık yapboz. Bilgi mührüyle parça yerine oturur; ziyaret edilen eserin parçası altınlaşır.
 * `pieces[i]` i'nci eserin durumu (katalog sırası); `labels[i]` ekran okuyucu için eser adı.
 */
export function VakfiyePuzzle({ pieces, labels }: { pieces: PieceState[]; labels: string[] }) {
  const { t } = useLang()
  const id = useId()
  const found = pieces.filter((p) => p !== 'missing').length
  const gold = pieces.filter((p) => p === 'gold').length
  return (
    <figure className="vk-puzzle">
      <svg viewBox={`-40 -40 ${W + 80} ${H + 80}`} role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{t('Kayıp Vakfiye: {total} parçadan {found} parça bulundu, {gold} parça altın', { total: pieces.length, found, gold })}</title>
        <defs>
          <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f7eed6" />
            <stop offset="1" stopColor="#e6d4a8" />
          </linearGradient>
          <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff3cf" />
            <stop offset="0.5" stopColor="#e9c874" />
            <stop offset="1" stopColor="#8a6a22" />
          </linearGradient>
          {pieces.map((_, i) => (
            <clipPath key={i} id={`${id}-p${i}`}>
              <path d={piecePath(Math.floor(i / COLS), i % COLS)} />
            </clipPath>
          ))}
        </defs>
        {pieces.map((state, i) => {
          const d = piecePath(Math.floor(i / COLS), i % COLS)
          return (
            <g key={i} className={`vk-piece vk-piece--${state}`}>
              {state === 'missing' ? (
                <path d={d} className="vk-piece__hole" />
              ) : (
                <>
                  <g clipPath={`url(#${id}-p${i})`}>
                    <Document id={id} />
                    {state === 'gold' && <rect x="0" y="0" width={W} height={H} fill={`url(#${id}-gold)`} className="vk-piece__gilt" />}
                  </g>
                  <path d={d} className="vk-piece__edge" />
                </>
              )}
              <title>{`${labels[i] ?? t('Parça {n}', { n: i + 1 })}: ${t(state === 'missing' ? 'henüz bulunmadı' : state === 'gold' ? 'altın (ziyaret edildi)' : 'bulundu')}`}</title>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
