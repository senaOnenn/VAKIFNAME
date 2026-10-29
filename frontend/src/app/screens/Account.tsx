import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { deleteAccount, endGuest, logout, resendVerification, useAuth } from '../session'
import './city.css'
import './account.css'

/** Hesap: kim olarak girildiği, çıkış ve (KVKK) hesabı ve ilerlemeyi kalıcı silme. */
export default function Account() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resend, setResend] = useState<{ state: 'idle' | 'busy' | 'sent' | 'error'; message?: string }>({ state: 'idle' })

  const leave = () => navigate('/giris', { replace: true })

  if (auth.status !== 'user') {
    return (
      <main className="vk-city">
        <section className="vk-city__intro">
          <h1>Hesap</h1>
          <p>Misafir olarak keşfediyorsun. İlerlemen bu cihazda tutulur; hesap açınca hesabına taşınır.</p>
          <div className="vk-account__actions">
            <Link to="/giris" className="vk-btn" onClick={() => endGuest()}>Hesap aç veya giriş yap</Link>
            <button type="button" className="vk-btn vk-btn--ghost" onClick={() => { endGuest(); leave() }}>
              Misafir oturumunu kapat
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
      setError(e instanceof ApiError ? e.message : 'Hesap silinemedi.')
      setBusy(false)
    }
  }

  async function sendAgain() {
    setResend({ state: 'busy' })
    try {
      await resendVerification()
      setResend({ state: 'sent' })
    } catch (e) {
      setResend({ state: 'error', message: e instanceof ApiError ? e.message : 'Bağlantı gönderilemedi.' })
    }
  }

  return (
    <main className="vk-city">
      <section className="vk-city__intro">
        <h1>Hesap</h1>
        <dl className="vk-account__info">
          {user.display_name && (<><dt>Ad</dt><dd>{user.display_name}</dd></>)}
          <dt>E-posta</dt>
          <dd>{user.email ?? '—'}</dd>
          <dt>Giriş yöntemi</dt>
          <dd>{user.provider === 'google' ? 'Google' : 'E-posta ve parola'}</dd>
          {user.email_verified !== undefined && (
            <>
              <dt>E-posta durumu</dt>
              <dd>
                <span className={user.email_verified ? 'vk-account__badge vk-account__badge--ok' : 'vk-account__badge'}>
                  {user.email_verified ? 'Doğrulandı' : 'Doğrulanmadı'}
                </span>
              </dd>
            </>
          )}
        </dl>
        {user.email_verified === false && (
          <div className="vk-account__verify">
            <p>
              Hesabını korumak ve parolanı unutursan yenileyebilmek için e-posta adresini doğrula. Bağlantı 24 saat geçerlidir.
            </p>
            <button type="button" className="vk-btn vk-btn--ghost" onClick={() => void sendAgain()}
              disabled={resend.state === 'busy'} aria-busy={resend.state === 'busy'}>
              {resend.state === 'busy' ? 'Gönderiliyor…' : 'Bağlantıyı yeniden gönder'}
            </button>
            <p aria-live="polite" className={resend.state === 'error' ? 'vk-auth__error' : 'vk-account__hint'}>
              {resend.state === 'sent' && `Doğrulama bağlantısını ${user.email ?? 'e-posta adresine'} gönderdik.`}
              {resend.state === 'error' && resend.message}
            </p>
          </div>
        )}
        <div className="vk-account__actions">
          <button type="button" className="vk-btn vk-btn--ghost" onClick={() => void logout().finally(leave)}>
            Çıkış
          </button>
        </div>

        <section className="vk-account__danger" aria-labelledby="hesap-sil">
          <h2 id="hesap-sil">Hesabı sil</h2>
          <p>Hesabın, mühürlerin ve ilerlemen kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
          {!confirming ? (
            <button type="button" className="vk-link-btn" onClick={() => setConfirming(true)}>Hesabımı silmek istiyorum</button>
          ) : (
            <div className="vk-account__actions">
              <button type="button" className="vk-btn vk-btn--danger" onClick={() => void remove()} disabled={busy}>
                {busy ? 'Siliniyor…' : 'Evet, kalıcı olarak sil'}
              </button>
              <button type="button" className="vk-btn vk-btn--ghost" onClick={() => setConfirming(false)}>Vazgeç</button>
            </div>
          )}
          {error && <p className="vk-auth__error" role="alert">{error}</p>}
        </section>
      </section>
    </main>
  )
}
