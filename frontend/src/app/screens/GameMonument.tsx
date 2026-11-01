import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { citySlug, getGame, getMonument, mediaUrl, progressId, typeLabel, useLoad } from '../api'
import { GamePanel } from '../components/GamePanel'
import { nameOf, textIn } from '../contentLang'
import { gamePath, rememberGameCity } from '../gameCity'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import './discover.css'
import './monument.css'
import './game-home.css'

/**
 * Oyun panelinde bir eserin mühür yolu: üç kademe (dinle ve sor → Rozeti Al → ziyaret). Anlatım ve kaynaklı bilgi eser
 * sayfasında kalır; buradan oraya bağlantı verilir. Ziyaret uyarısı oyun adımlarından önce görünür (CLAUDE.md §5).
 */
export default function GameMonument() {
  const { id = '' } = useParams()
  const auth = useAuth()
  const uid = progressId(auth)
  const { t, lang } = useLang()
  const m = useLoad((s) => getMonument(id, s), [id])
  const game = useLoad((s) => getGame(id, uid, s), [id, uid])
  const city = m.data ? citySlug(m.data.city) : ''
  // Oyun menüsündeki "Rotam" bu eserin şehrine döner.
  useEffect(() => {
    if (city) rememberGameCity(city)
  }, [city])

  if (m.loading) return <main className="vk-page"><p className="vk-page__state" role="status">{t('Eser yükleniyor…')}</p></main>
  if (m.error || !m.data)
    return (
      <main className="vk-page">
        <p className="vk-page__state vk-page__state--error" role="alert">{t('Eser bulunamadı veya yüklenemedi.')}</p>
        <Link to={gamePath.home} className="vk-btn vk-btn--ghost">← {t('Oyun girişine dön')}</Link>
      </main>
    )

  const d = m.data
  const cover = d.images[0]
  const name = nameOf(d, lang)
  const notice = textIn(d.site_notice, d.site_notice_en, lang)
  return (
    <main className="vk-page vk-gmon">
      <Link to={gamePath.route(city)} className="vk-gmon__back">← {t('Rotaya dön')}</Link>
      <header className="vk-gmon__head">
        {cover && <img className="vk-gmon__img" src={mediaUrl(cover.card_file || cover.file)} alt="" />}
        <div>
          <p className="vk-page__eyebrow">{typeLabel(d.type)} · {d.district}, {d.city}</p>
          <h1>{name}</h1>
          <Link to={`/eser/${encodeURIComponent(id)}`} className="vk-gmon__story">{t('Eserin hikâyesini ve kaynaklarını aç')} →</Link>
        </div>
      </header>

      {d.site_notice && (
        <aside className="vk-notice" aria-label={t('Ziyaret uyarısı')}>
          <strong>{t('Ziyaret ederken')}</strong>
          <p lang={notice.turkishOnly ? 'tr' : undefined}>{notice.text}</p>
        </aside>
      )}

      {game.loading && !game.data && <p className="vk-page__state" role="status">{t('Mühür yolu yükleniyor…')}</p>}
      {game.error && (
        <p className="vk-page__state vk-page__state--error" role="alert">
          {t('Mühür yolu yüklenemedi.')} <button type="button" className="vk-link-btn" onClick={game.reload}>{t('Tekrar dene')}</button>
        </p>
      )}
      {game.data && <GamePanel id={id} uid={uid} city={city} game={game.data} onChange={game.reload} />}
    </main>
  )
}
