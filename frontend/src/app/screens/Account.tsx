import { useNavigate } from 'react-router-dom'
import { endSession, useSession } from '../session'
import './city.css'

/** Hesap: oturum bilgisi ve çıkış. Hesap silme ve gerçek hesap bilgisi Faz 2 sunucusuyla gelir. */
export default function Account() {
  const session = useSession()
  const navigate = useNavigate()
  return (
    <main className="vk-city">
      <section className="vk-city__intro">
        <h1>Hesap</h1>
        <p>
          {session?.kind === 'guest'
            ? 'Misafir olarak keşfediyorsun. İlerlemen bu cihazda tutulur; hesap açınca hesabına taşınır.'
            : `Geçici oturum: ${session?.email ?? ''}. Hesap sistemi yapım aşamasında.`}
        </p>
        <button
          type="button"
          className="vk-btn vk-btn--ghost"
          onClick={() => {
            endSession()
            navigate('/giris', { replace: true })
          }}
        >
          Çıkış
        </button>
      </section>
    </main>
  )
}
