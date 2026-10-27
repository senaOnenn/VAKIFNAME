import { Link } from 'react-router-dom'
import { getMonuments, getSealBook, progressId, useLoad } from '../api'
import { GoldRule } from '../components/Ornament'
import { Seal } from '../components/Seal'
import { VakfiyePuzzle, type PieceState } from '../components/VakfiyePuzzle'
import { useAuth } from '../session'
import './discover.css'
import './passport.css'

const date = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Pasaport: Kayıp Vakfiye yapbozu (bilgi mührü = parça, ziyaret = altın) ve eser eser mühürler. */
export default function Passport() {
  const auth = useAuth()
  const uid = progressId(auth)
  const catalog = useLoad((s) => getMonuments(s), [])
  const book = useLoad((s) => getSealBook(uid, s), [uid])

  if (catalog.loading || book.loading) return <main className="vk-page"><p className="vk-page__state" role="status">Pasaport yükleniyor…</p></main>
  if (catalog.error || book.error || !catalog.data || !book.data)
    return (
      <main className="vk-page">
        <p className="vk-page__state vk-page__state--error" role="alert">Pasaport yüklenemedi.</p>
      </main>
    )

  const knowledge = new Map(book.data.knowledge_seals.map((s) => [s.monument_id, s]))
  const visit = new Map(book.data.visit_seals.map((s) => [s.monument_id, s]))
  const monuments = catalog.data.monuments
  const pieces: PieceState[] = monuments.map((m) => (visit.has(m.monument_id) ? 'gold' : knowledge.has(m.monument_id) ? 'found' : 'missing'))
  const found = pieces.filter((p) => p !== 'missing').length
  const gold = pieces.filter((p) => p === 'gold').length
  const total = monuments.length

  return (
    <main className="vk-page vk-passport">
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">Dijital pasaport</p>
        <h1>Kayıp Vakfiye</h1>
        <GoldRule className="vk-page__rule" />
        <p>
          {found === total
            ? gold === total
              ? 'Altın Vakfiye! Bütün eserleri ziyaret ettin.'
              : 'Kayıp Vakfiye bulundu! Eserleri ziyaret ettikçe parçalar altınlaşır.'
            : `${total} parçadan ${found} parça bulundu${gold ? `, ${gold} parça altın` : ''}. Her bilgi mührü bir parça getirir.`}
        </p>
      </header>

      <VakfiyePuzzle pieces={pieces} labels={monuments.map((m) => m.name)} />

      <section aria-labelledby="muhurler">
        <h2 id="muhurler" className="vk-passport__h">Mühürler</h2>
        <ul className="vk-passport__seals">
          {monuments.map((m) => {
            const k = knowledge.get(m.monument_id)
            const v = visit.get(m.monument_id)
            const kind = v ? 'gold' : k ? 'knowledge' : 'empty'
            return (
              <li key={m.monument_id}>
                <Link to={`/eser/${encodeURIComponent(m.monument_id)}`}>
                  <Seal kind={kind} label={kind === 'gold' ? 'Altın mühür' : kind === 'knowledge' ? 'Bilgi mührü' : 'Mühür yok'} size={64} />
                  <span className="vk-passport__name">{m.name}</span>
                  <span className="vk-passport__meta">
                    {v ? `Altın · ziyaret ${date(v.earned_at)}${v.simulated ? ' (simülasyon)' : ''}` : k ? `Bilgi mührü · ${date(k.earned_at)}` : 'Henüz yok'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
