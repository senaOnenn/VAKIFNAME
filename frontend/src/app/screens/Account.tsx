import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { deleteAccount, endGuest, logout, useAuth } from '../session'
import './city.css'
import './account.css'

/** Hesap: kim olarak girildiği, çıkış ve (KVKK) hesabı ve ilerlemeyi kalıcı silme. */
export default function Account() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
        </dl>
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
