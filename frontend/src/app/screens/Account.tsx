import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getMonuments, getSealBook, useLoad } from '../api'
import { PlayerCrest, SealTally } from '../components/GameParts'
import { useLang } from '../i18n'
import { loadPlayerProfile, PlayerLoadError } from '../player'
import { deleteAccount, endGuest, logout, resendVerification, useAuth } from '../session'
import './city.css'
import './account.css'
import '../game-layout.css'

/**
 * Hesap: kim olarak girildiği, oyuncu profili (R6.5: kâşif, seviye, XP, görünüm aşaması, mühürler ve vakfiye parçaları),
 * çıkış ve (KVKK) hesabı ve ilerlemeyi kalıcı silme.
 */
export default function Account() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { t } = useLang()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resend, setResend] = useState<{ state: 'idle' | 'busy' | 'sent' | 'error'; message?: string }>({ state: 'idle' })

  const leave = () => navigate('/giris', { replace: true })
  const uid = auth.status === 'user' ? auth.user.user_id : null
  const player = useLoad((s) => (uid ? loadPlayerProfile(s) : Promise.resolve(null)), [uid])
  const book = useLoad((s) => (uid ? getSealBook(uid, s).catch(() => null) : Promise.resolve(null)), [uid])
  const catalog = useLoad((s) => (uid ? getMonuments(s).catch(() => null) : Promise.resolve(null)), [uid])

  if (auth.status !== 'user') {
    return (
      <main className="vk-city">
        <section className="vk-city__intro">
          <h1>{t('Hesap')}</h1>
          <p>{t('Misafir olarak eserleri, haritayı ve rehberi kullanabilirsin. Oyun, kâşif ve ilerleme için hesap gerekir.')}</p>
          <div className="vk-account__actions">
            <Link to="/giris" className="vk-btn" onClick={() => endGuest()}>{t('Hesap aç veya giriş yap')}</Link>
            <button type="button" className="vk-btn vk-btn--ghost" onClick={() => { endGuest(); leave() }}>
              {t('Misafir oturumunu kapat')}
            </button>
          </div>
        </section>
      </main>
    )
  }

  const { user } = auth
  async function remove() {
    setBusy(true)
    setError('')
    try {
      await deleteAccount()
      leave()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Hesap silinemedi.'))
      setBusy(false)
    }
  }

  async function sendAgain() {
    setResend({ state: 'busy' })
    try {
      await resendVerification()
      setResend({ state: 'sent' })
    } catch (e) {
      setResend({ state: 'error', message: e instanceof ApiError ? e.message : t('Bağlantı gönderilemedi.') })
    }
  }

  return (
    <main className="vk-city">
      <section className="vk-city__intro">
        <h1>{t('Hesap')}</h1>
        <dl className="vk-account__info">
          {user.display_name && (<><dt>{t('Ad')}</dt><dd>{user.display_name}</dd></>)}
          <dt>{t('E-posta')}</dt>
          <dd>{user.email ?? '—'}</dd>
          <dt>{t('Giriş yöntemi')}</dt>
          <dd>{user.provider === 'google' ? 'Google' : t('E-posta ve parola')}</dd>
          {user.email_verified !== undefined && (
            <>
              <dt>{t('E-posta durumu')}</dt>
              <dd>
                <span className={user.email_verified ? 'vk-account__badge vk-account__badge--ok' : 'vk-account__badge'}>
                  {user.email_verified ? t('Doğrulandı') : t('Doğrulanmadı')}
                </span>
              </dd>
            </>
          )}
        </dl>
        {user.email_verified === false && (
          <div className="vk-account__verify">
            <p>
              {t('Hesabını korumak ve parolanı unutursan yenileyebilmek için e-posta adresini doğrula. Bağlantı 24 saat geçerlidir.')}
            </p>
            <button type="button" className="vk-btn vk-btn--ghost" onClick={() => void sendAgain()}
              disabled={resend.state === 'busy'} aria-busy={resend.state === 'busy'}>
              {resend.state === 'busy' ? t('Gönderiliyor…') : t('Bağlantıyı yeniden gönder')}
            </button>
            <p aria-live="polite" className={resend.state === 'error' ? 'vk-auth__error' : 'vk-account__hint'}>
              {resend.state === 'sent' && t('Doğrulama bağlantısını {email} gönderdik.', { email: user.email ?? t('e-posta adresine') })}
              {resend.state === 'error' && resend.message}
            </p>
          </div>
        )}
        <section className="vk-account__player" aria-labelledby="oyuncu">
          <h2 id="oyuncu">{t('Oyuncu profili')}</h2>
          {player.data?.fail && <PlayerLoadError fail={player.data.fail} onRetry={player.reload} className="vk-account__hint" />}
          {player.loading && !player.data && <p className="vk-account__hint" role="status">{t('Oyuncu profili yükleniyor…')}</p>}
          {player.data?.profile && (player.data.profile.character ? (
            <>
              <PlayerCrest profile={player.data.profile} size="profile" headingLevel={3} />
              {book.data && catalog.data && (
                <SealTally knowledge={book.data.knowledge_seals.length} gold={book.data.visit_seals.length} total={catalog.data.monuments.length} />
              )}
              <Link to="/oyun/karakter?sonra=%2Foyun" className="vk-account__change">{t('Kâşifini değiştir')}</Link>
            </>
          ) : (
            <p className="vk-account__hint">
              {t('Henüz kâşifini seçmedin.')} <Link to="/oyun/karakter?sonra=%2Foyun">{t('Kâşifini seç')}</Link>
            </p>
          ))}
        </section>
        <div className="vk-account__actions">
          <button type="button" className="vk-btn vk-btn--ghost" onClick={() => void logout().finally(leave)}>
            {t('Çıkış')}
          </button>
        </div>

        <section className="vk-account__danger" aria-labelledby="hesap-sil">
          <h2 id="hesap-sil">{t('Hesabı sil')}</h2>
          <p>{t('Hesabın, mühürlerin ve ilerlemen kalıcı olarak silinir. Bu işlem geri alınamaz.')}</p>
          {!confirming ? (
            <button type="button" className="vk-link-btn" onClick={() => setConfirming(true)}>{t('Hesabımı silmek istiyorum')}</button>
          ) : (
            <div className="vk-account__actions">
              <button type="button" className="vk-btn vk-btn--danger" onClick={() => void remove()} disabled={busy}>
                {busy ? t('Siliniyor…') : t('Evet, kalıcı olarak sil')}
              </button>
              <button type="button" className="vk-btn vk-btn--ghost" onClick={() => setConfirming(false)}>{t('Vazgeç')}</button>
            </div>
          )}
          {error && <p className="vk-auth__error" role="alert">{error}</p>}
        </section>
      </section>
    </main>
  )
}
