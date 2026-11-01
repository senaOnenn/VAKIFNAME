import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { sendVisit, type GameState, type VisitResult } from '../api'
import { gamePath } from '../gameCity'
import { useLang } from '../i18n'
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
export function GamePanel({ id, uid, city, game, onChange }: {
  id: string; uid: string; city: string; game: GameState; onChange: () => void
}) {
  const { t } = useLang()
  // Mesaj Türkçe anahtar + değişkenlerle saklanır; dil değişince ekranda yeniden çevrilir.
  const [visit, setVisit] = useState<{ text: string; extra?: { d: number; r: number }; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const tier1 = game.listened && (game.asked || !game.guide_required)
  const seal = game.visit ? 'gold' : game.knowledge ? 'knowledge' : 'empty'

  async function doVisit(body: { latitude?: number; longitude?: number; simulate?: boolean }) {
    setBusy(true)
    try {
      const r = await sendVisit(id, uid, body)
      const extra = r.status === 'out_of_range' && r.distance_m != null ? { d: r.distance_m, r: r.radius_m } : undefined
      setVisit({ text: VISIT_TEXT[r.status], extra, ok: r.status === 'gold' || r.status === 'already' })
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
        <h2 id="muhur-yolu">{t('Mühür yolu')}</h2>
        <p>{t('Bu eser henüz kilitli. Rotandaki açık eserlerden birinin mührünü aldıkça yeni eserlerin kilidi açılır.')}</p>
        <Link to={gamePath.route(city)} className="vk-btn vk-btn--ghost">{t('Rotaya dön')}</Link>
      </section>
    )
  }

  return (
    <section className="vk-game" aria-labelledby="muhur-yolu">
      <div className="vk-game__head">
        <Seal kind={seal} label={t(seal === 'gold' ? 'Altın mühür' : seal === 'knowledge' ? 'Bilgi mührü' : 'Mühür henüz yok')} />
        <div>
          <h2 id="muhur-yolu">{t('Mühür yolu')}</h2>
          <p>{t('Dinle, bilgini sına, eseri ziyaret et.')}</p>
        </div>
      </div>
      <ol className="vk-steps">
        <li className={tier1 ? 'is-done' : 'is-current'}>
          <span className="vk-steps__n" aria-hidden="true">I</span>
          <div>
            <strong>{t('Dinle ve sor')}</strong>
            <p>
              {game.listened ? t('Anlatımı dinledin ✓') : t('Rehberin anlatımını sonuna kadar dinle.')}
              {game.guide_required && ' ' + (game.asked ? t('Rehbere sordun ✓') : t('Rehbere en az bir soru sor.'))}
            </p>
            {!tier1 && <Link to={`/eser/${encodeURIComponent(id)}`} className="vk-btn vk-btn--ghost">{t('Eser sayfasında dinle')}</Link>}
          </div>
        </li>
        <li className={game.knowledge ? 'is-done' : tier1 ? 'is-current' : ''}>
          <span className="vk-steps__n" aria-hidden="true">II</span>
          <div>
            <strong>{t('Rozeti al')}</strong>
            <p>{game.knowledge ? t('Bilgi mührünü aldın ✓ Vakfiyenin bir parçası yerine oturdu.') : t('{n} kısa soru; en az {m} doğru gerekir.', { n: game.quiz_size, m: game.pass_mark })}</p>
            {!game.knowledge && (
              game.ready_for_quiz ? (
                <Link to={gamePath.quiz(id)} className="vk-btn">{t('Rozeti Al')}</Link>
              ) : (
                <button type="button" className="vk-btn" disabled>{t('Rozeti Al')}</button>
              )
            )}
          </div>
        </li>
        <li className={game.visit ? 'is-done' : game.knowledge ? 'is-current' : ''}>
          <span className="vk-steps__n" aria-hidden="true">III</span>
          <div>
            <strong>{t('Ziyaret et, altın mühür al')}</strong>
            <p>
              {game.visit
                ? t('Eseri ziyaret ettin ✓ Mührün altın.') + (game.visit.simulated ? ' ' + t('(sunum modu: simüle edilmiş ziyaret)') : '')
                : t('Eserin önüne git; konumun {r} m içinde doğrulanınca mührün altına dönüşür. Konumun kaydedilmez.', { r: game.visit_radius_m })}
            </p>
            {game.knowledge && !game.visit && (
              <div className="vk-game__actions">
                <button type="button" className="vk-btn" onClick={locate} disabled={busy}>{t('Konumumu doğrula')}</button>
                {game.simulated_visit_allowed && (
                  <button type="button" className="vk-btn vk-btn--ghost" onClick={() => void doVisit({ simulate: true })} disabled={busy}>
                    {t('Sunum modu: ziyareti simüle et')}
                  </button>
                )}
              </div>
            )}
            {visit && <p className={visit.ok ? 'vk-game__ok' : 'vk-game__warn'} role="status">
              {t(visit.text)}
              {visit.extra && ' ' + t('(yaklaşık {d} m uzaktasın; {r} m içinde olmalısın)', visit.extra)}
            </p>}
          </div>
        </li>
      </ol>
    </section>
  )
}
