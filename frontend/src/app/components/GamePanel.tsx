import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { sendVisit, type GameState, type VisitResult } from '../api'
import { Seal } from './Seal'
import './game-panel.css'

const VISIT_TEXT: Record<VisitResult['status'], string> = {
  gold: 'Ziyaretin doğrulandı. Mührün altına dönüştü!',
  already: 'Bu eserin altın mührü zaten sende.',
  out_of_range: 'Eserin önünde görünmüyorsun.',
  needs_knowledge: 'Önce bilgi mührünü almalısın.',
  simulation_disabled: 'Ziyaret simülasyonu şu anda kapalı.',
}

/**
 * Eserin üç kademesi (CLAUDE.md §2.6): I dinle ve sor → II "Rozeti Al" (5 soru, en az 4 doğru) → III ziyaretle altın
 * mühür. Kilit ve tüm kurallar sunucudadır; bu panel yalnızca durumu gösterir ve isteği iletir.
 */
export function GamePanel({ id, uid, game, onChange }: { id: string; uid: string; game: GameState; onChange: () => void }) {
  const [visit, setVisit] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const tier1 = game.listened && (game.asked || !game.guide_required)
  const seal = game.visit ? 'gold' : game.knowledge ? 'knowledge' : 'empty'

  async function doVisit(body: { latitude?: number; longitude?: number; simulate?: boolean }) {
    setBusy(true)
    try {
      const r = await sendVisit(id, uid, body)
      const extra = r.status === 'out_of_range' && r.distance_m != null ? ` (yaklaşık ${r.distance_m} m uzaktasın; ${r.radius_m} m içinde olmalısın)` : ''
      setVisit({ text: VISIT_TEXT[r.status] + extra, ok: r.status === 'gold' || r.status === 'already' })
      onChange()
    } catch (e) {
      setVisit({ text: e instanceof ApiError ? e.message : 'Ziyaret doğrulanamadı.', ok: false })
    } finally {
      setBusy(false)
    }
  }

  function locate() {
    if (!('geolocation' in navigator)) return setVisit({ text: 'Tarayıcın konum paylaşmayı desteklemiyor.', ok: false })
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (p) => void doVisit({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => {
        setBusy(false)
        setVisit({ text: 'Konum alınamadı. Konum iznini kontrol et.', ok: false })
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  }

  if (game.locked) {
    return (
      <section className="vk-game vk-game--locked" aria-labelledby="muhur-yolu">
        <h2 id="muhur-yolu">Mühür yolu</h2>
        <p>Bu eser henüz kilitli. Rotandaki açık eserlerden birinin mührünü aldıkça yeni eserlerin kilidi açılır.</p>
        <Link to="/rota/bursa" className="vk-btn vk-btn--ghost">Rotaya dön</Link>
      </section>
    )
  }

  return (
    <section className="vk-game" aria-labelledby="muhur-yolu">
      <div className="vk-game__head">
        <Seal kind={seal} label={seal === 'gold' ? 'Altın mühür' : seal === 'knowledge' ? 'Bilgi mührü' : 'Mühür henüz yok'} />
        <div>
          <h2 id="muhur-yolu">Mühür yolu</h2>
          <p>Dinle, bilgini sına, eseri ziyaret et.</p>
        </div>
      </div>
      <ol className="vk-steps">
        <li className={tier1 ? 'is-done' : 'is-current'}>
          <span className="vk-steps__n" aria-hidden="true">I</span>
          <div>
            <strong>Dinle ve sor</strong>
            <p>
              {game.listened ? 'Anlatımı dinledin ✓' : 'Rehberin anlatımını sonuna kadar dinle.'}
              {game.guide_required && (game.asked ? ' Rehbere sordun ✓' : ' Rehbere en az bir soru sor.')}
            </p>
          </div>
        </li>
        <li className={game.knowledge ? 'is-done' : tier1 ? 'is-current' : ''}>
          <span className="vk-steps__n" aria-hidden="true">II</span>
          <div>
            <strong>Rozeti al</strong>
            <p>{game.knowledge ? 'Bilgi mührünü aldın ✓ Vakfiyenin bir parçası yerine oturdu.' : `${game.quiz_size} kısa soru; en az ${game.pass_mark} doğru gerekir.`}</p>
            {!game.knowledge && (
              game.ready_for_quiz ? (
                <Link to={`/eser/${encodeURIComponent(id)}/rozet`} className="vk-btn">Rozeti Al</Link>
              ) : (
                <button type="button" className="vk-btn" disabled>Rozeti Al</button>
              )
            )}
          </div>
        </li>
        <li className={game.visit ? 'is-done' : game.knowledge ? 'is-current' : ''}>
          <span className="vk-steps__n" aria-hidden="true">III</span>
          <div>
            <strong>Ziyaret et, altın mühür al</strong>
            <p>
              {game.visit
                ? `Eseri ziyaret ettin ✓ Mührün altın.${game.visit.simulated ? ' (sunum modu: simüle edilmiş ziyaret)' : ''}`
                : `Eserin önüne git; konumun ${game.visit_radius_m} m içinde doğrulanınca mührün altına dönüşür. Konumun kaydedilmez.`}
            </p>
            {game.knowledge && !game.visit && (
              <div className="vk-game__actions">
                <button type="button" className="vk-btn" onClick={locate} disabled={busy}>Konumumu doğrula</button>
                {game.simulated_visit_allowed && (
                  <button type="button" className="vk-btn vk-btn--ghost" onClick={() => void doVisit({ simulate: true })} disabled={busy}>
                    Sunum modu: ziyareti simüle et
                  </button>
                )}
              </div>
            )}
            {visit && <p className={visit.ok ? 'vk-game__ok' : 'vk-game__warn'} role="status">{visit.text}</p>}
          </div>
        </li>
      </ol>
    </section>
  )
}
