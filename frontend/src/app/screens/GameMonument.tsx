import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { citySlug, getGame, getMonument, getRoute, mediaUrl, progressId, sendVisit, typeLabel, useLoad, type VisitResult } from '../api'
import { useGuide } from '../components/GuideWidget'
import { HistoryBook } from '../components/HistoryBook'
import { Seal } from '../components/Seal'
import { nameOf, textIn } from '../contentLang'
import { gamePath, rememberGameCity } from '../gameCity'
import { getLang, useLang } from '../i18n'
import { PROFILE_FAIL_TEXT, usePlayer } from '../player'
import { useAuth } from '../session'
import '../components/game-parts.css'
import './discover.css'
import './monument-layout.css'
import './game-home.css'
import './task.css'

const VISIT_TEXT: Record<VisitResult['status'], string> = {
  gold: 'Ziyaretin doğrulandı. Mührün altına dönüştü!',
  already: 'Bu eserin altın mührü zaten sende.',
  out_of_range: 'Eserin önünde görünmüyorsun.',
  needs_knowledge: 'Önce bilgi mührünü almalısın.',
  simulation_disabled: 'Ziyaret simülasyonu şu anda kapalı.',
}
const date = (iso: string) =>
  new Date(iso).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * R6.7 Görev ekranı: oyuncu eseri seçince doğrudan buraya gelir. Tek ana eylem bilgi görevidir ("Göreve Başla" /
 * "Göreve Devam Et": 5 soru, en az 4 doğru → bilgi mührü, vakfiye parçası, XP). Hikâyeyi dinlemek (rehber paneli, aynı
 * ekranda) ve Tarih Defteri (kaynaklı kayıtlar) isteğe bağlıdır. Gerçek ziyaret, bilgi mühründen sonra ayrı bir bonus
 * görevdir (mesafe kuralı, simülasyon işareti ve konumun saklanmaması aynen). Ziyaret uyarısı oyun adımlarından önce
 * görünür (CLAUDE.md §5). Kurallar sunucudadır.
 */
export default function GameMonument() {
  const { id = '' } = useParams()
  const auth = useAuth()
  const uid = progressId(auth)
  const { t, lang } = useLang()
  const player = usePlayer()
  const guide = useGuide()
  const m = useLoad((s) => getMonument(id, s), [id])
  const game = useLoad((s) => getGame(id, uid, s), [id, uid])
  const city = m.data ? citySlug(m.data.city) : ''
  // R6.8: görevi hazır olmayan eserde, hazır başka bir göreve geçiş için rota okunur.
  const notReady = game.data?.quiz_available === false && !game.data.knowledge
  const route = useLoad((s) => (notReady && city ? getRoute(city, uid, null, s).catch(() => null) : Promise.resolve(null)), [notReady, city, uid])
  const other = route.data?.stops.find((s) => s.monument_id !== id && s.quest_ready !== false)
  useEffect(() => {
    if (city) rememberGameCity(city)
  }, [city])
  // Rehber paneli bu eserle açılır ("Hikâyeyi dinle"); ayrılınca bağlam kalkar.
  const loaded = m.data
  useEffect(() => {
    if (loaded) guide.setMonument({ monument_id: loaded.monument_id, name: loaded.name, name_en: loaded.name_en, facts: loaded.facts })
    return () => guide.setMonument(null)
  }, [loaded, guide])

  // Tarih Defteri: modal <dialog> (üst katman; Esc; odak açan düğmeye döner).
  const [bookOpen, setBookOpen] = useState(false)
  const book = useRef<HTMLDialogElement>(null)
  const bookBtn = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    const d = book.current
    if (!d) return
    if (bookOpen && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!bookOpen && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [bookOpen])
  useEffect(() => {
    if (!bookOpen && wasOpen.current) bookBtn.current?.focus()
    wasOpen.current = bookOpen
  }, [bookOpen])

  // Bonus: gerçek ziyaret (konum yalnızca istek süresince kullanılır).
  const [visit, setVisit] = useState<{ text: string; extra?: { d: number; r: number }; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  async function doVisit(body: { latitude?: number; longitude?: number; simulate?: boolean }) {
    setBusy(true)
    try {
      const r = await sendVisit(id, uid, body)
      const extra = r.status === 'out_of_range' && r.distance_m != null ? { d: r.distance_m, r: r.radius_m } : undefined
      setVisit({ text: VISIT_TEXT[r.status], extra, ok: r.status === 'gold' || r.status === 'already' })
      game.reload()
      player.refresh()
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

  if (m.loading) return <main className="vk-task"><p className="vk-page__state" role="status">{t('Eser yükleniyor…')}</p></main>
  if (m.error || !m.data)
    return (
      <main className="vk-task">
        <p className="vk-page__state vk-page__state--error" role="alert">{t('Eser bulunamadı veya yüklenemedi.')}</p>
        <Link to={gamePath.home} className="vk-task__back">← {t('Vakfiye Odası’na dön')}</Link>
      </main>
    )

  const d = m.data
  const cover = d.images[0]
  const name = nameOf(d, lang)
  const notice = textIn(d.site_notice, d.site_notice_en, lang)
  const g = game.data
  const status = !g ? '' : g.visit ? 'Altın mühür kazanıldı' : g.knowledge ? 'Bilgi mührü kazanıldı' : g.started ? 'Göreve başlandı' : 'Henüz keşfedilmedi'

  return (
    <main className="vk-task">
      <Link to={gamePath.home} className="vk-task__back">← {t('Vakfiye Odası')}</Link>

      <header className="vk-task__head">
        {cover && <img className="vk-task__img" src={mediaUrl(cover.card_file || cover.file)} alt="" />}
        <div className="vk-task__title">
          <p className="vk-task__eyebrow">{typeLabel(d.type)} · {d.district}, {d.city}</p>
          <h1>{name}</h1>
          {status && <p className="vk-task__status">{t(status)}</p>}
        </div>
      </header>

      {d.site_notice && (
        <aside className="vk-task__notice" aria-label={t('Ziyaret uyarısı')}>
          <strong>{t('Ziyaret ederken')}</strong> <span lang={notice.turkishOnly ? 'tr' : undefined}>{notice.text}</span>
        </aside>
      )}

      {game.loading && !g && <p className="vk-page__state" role="status">{t('Görev yükleniyor…')}</p>}
      {game.error && (
        <p className="vk-page__state vk-page__state--error" role="alert">
          {t('Görev yüklenemedi.')} <button type="button" className="vk-link-btn" onClick={game.reload}>{t('Tekrar dene')}</button>
        </p>
      )}

      {g && (
        <article className="vk-folio vk-task__folio">
          <section className="vk-task__quest" aria-labelledby="gorev">
            <p className="vk-folio__eyebrow">{t('Bilgi görevi')}</p>
            {g.knowledge ? (
              <div className="vk-task__done">
                <Seal kind={g.visit ? 'gold' : 'knowledge'} label={t(g.visit ? 'Altın mühür' : 'Bilgi mührü')} size={72} />
                <div>
                  <h2 id="gorev" className="vk-folio__h">{t('Bilgi mührü kazanıldı')}</h2>
                  <p className="vk-task__line">{t('{date} · +50 XP · vakfiyenin bir parçası yerine oturdu.', { date: date(g.knowledge.earned_at) })}</p>
                </div>
              </div>
            ) : (
              <>
                <h2 id="gorev" className="vk-folio__h">{g.quiz_available === false ? t('Görev hazırlanıyor') : t('{n} soru, en az {m} doğru', { n: g.quiz_size, m: g.pass_mark })}</h2>
                {g.quiz_available !== false && <p className="vk-task__line">{t('Başarınca bilgi mührü, vakfiyenin bir parçası ve 50 XP senin.')}</p>}
                {g.quiz_available === undefined ? (
                  // Eski sunucu (R6.7 öncesi kurallar): sınav şartları farklı; arayüz yanlış bir "soru yok" demez.
                  <p className="vk-task__line" role="status">{t(PROFILE_FAIL_TEXT.outdated)}</p>
                ) : g.ready_for_quiz ? (
                  <Link to={gamePath.quiz(id)} className="vk-waxbtn vk-task__go">{g.started ? t('Göreve Devam Et') : t('Göreve Başla')}</Link>
                ) : g.quiz_available === false ? (
                  <div className="vk-task__soon" role="status">
                    <p className="vk-task__line">
                      {t('Bu eserin bilgi görevi hazırlanıyor: onaylı kayıtlarından henüz 5 soru çıkmıyor. Eserin hikâyesini ve Tarih Defteri’ni yine inceleyebilirsin.')}
                    </p>
                    {other && (
                      <Link to={gamePath.monument(other.monument_id)} className="vk-task__extra vk-task__extra--strong">
                        {t('Hazır bir görevle devam et: {name}', { name: nameOf(other, lang) })}
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="vk-task__line" role="status">{t('Görev şu anda başlatılamıyor; biraz sonra yeniden dene.')}</p>
                )}
              </>
            )}
            <div className="vk-task__extras" role="group" aria-label={t('İsteğe bağlı')}>
              <button type="button" className="vk-task__extra" onClick={() => guide.open('listen')}>{t('Hikâyeyi dinle')}</button>
              <button ref={bookBtn} type="button" className="vk-task__extra" aria-haspopup="dialog" aria-expanded={bookOpen}
                onClick={() => (guide.close(), setBookOpen(true))}>{t('Tarih Defteri')}</button>
              <span className="vk-task__hint">{t('İsteğe bağlı · dinlemek ve rehbere sormak da XP kazandırır')}</span>
            </div>
          </section>

          {g.knowledge && (
            <section className="vk-task__visit" aria-labelledby="ziyaret">
              <p className="vk-folio__eyebrow">{t('Bonus görev')}</p>
              <h2 id="ziyaret" className="vk-folio__h">{t('Eseri yerinde ziyaret et')}</h2>
              {g.visit ? (
                <p className="vk-task__line">
                  {t('Altın mühür kazanıldı · {date}', { date: date(g.visit.earned_at) })}
                  {g.visit.simulated && ' ' + t('(sunum modu: simüle edilmiş ziyaret)')}
                </p>
              ) : (
                <>
                  <p className="vk-task__line">
                    {t('Eserin önünde konumun {r} m içinde doğrulanınca mührün ve parçan altına döner (+100 XP). Konumun kaydedilmez. Gidemiyorsan sorun değil: diğer eserlerle devam edebilirsin.', { r: g.visit_radius_m })}
                  </p>
                  <div className="vk-task__actions">
                    <button type="button" className="vk-task__extra vk-task__extra--strong" onClick={locate} disabled={busy}>{t('Konumumu doğrula')}</button>
                    {g.simulated_visit_allowed && (
                      <button type="button" className="vk-task__extra" onClick={() => void doVisit({ simulate: true })} disabled={busy}>
                        {t('Sunum modu: ziyareti simüle et')}
                      </button>
                    )}
                  </div>
                </>
              )}
              {visit && (
                <p className={visit.ok ? 'vk-task__ok' : 'vk-task__warn'} role="status">
                  {t(visit.text)}
                  {visit.extra && ' ' + t('(yaklaşık {d} m uzaktasın; {r} m içinde olmalısın)', visit.extra)}
                </p>
              )}
            </section>
          )}
        </article>
      )}

      <dialog ref={book} className="vk-bookdlg" aria-labelledby="defter-h" onClose={() => setBookOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            setBookOpen(false)
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setBookOpen(false)
        }}>
        {bookOpen && (
          <div className="vk-bookdlg__inner">
            <h2 id="defter-h" className="vk-sr-only">{t('Tarih Defteri')}</h2>
            <HistoryBook key={`${id}-${lang}`} facts={d.facts} monumentName={name} headingId="defter-h" startOpen onClose={() => setBookOpen(false)} />
          </div>
        )}
      </dialog>
    </main>
  )
}
