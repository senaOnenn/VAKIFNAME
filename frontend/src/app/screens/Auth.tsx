import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoldRule, Ornament } from '../components/Ornament'
import { startSession } from '../session'
import './auth.css'

type Tab = 'giris' | 'kayit'
/** Google Cloud'daki "VAKIFNAME" projesinden alınan Web istemci kimliği (gizli değildir). Boşsa Google girişi kapalıdır. */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** Giriş / Kayıt: Google ile devam, e-posta + parola, üye olmadan keşfet. */
export default function Auth() {
  const navigate = useNavigate()
  const uid = useId()
  const [tab, setTab] = useState<Tab>('giris')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [googleNote, setGoogleNote] = useState('')

  const register = tab === 'kayit'

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!EMAIL_RE.test(email.trim())) e.email = 'Geçerli bir e-posta adresi yaz.'
    if (password.length < 8) e.password = 'Parola en az 8 karakter olmalı.'
    if (register && again !== password) e.again = 'Parolalar aynı değil.'
    return e
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    // Hesap sistemi (sunucu) Faz 2'de gelir; şimdilik yalnızca bu tarayıcıda geçici oturum açılır. Parola saklanmaz.
    startSession('provisional', email.trim())
    navigate('/sehir')
  }

  function google() {
    if (!GOOGLE_CLIENT_ID) {
      setGoogleNote('Google ile giriş henüz etkinleştirilmedi. Şimdilik e-posta ile devam edebilir veya üye olmadan keşfedebilirsin.')
      return
    }
    // Faz 2: Google Identity Services ile kimlik belirteci alınır ve SUNUCUDA doğrulanır.
    setGoogleNote('Google girişi bağlantısı Faz 2’de tamamlanacak.')
  }

  function guest() {
    startSession('guest')
    navigate('/sehir')
  }

  const fieldId = (n: string) => `${uid}-${n}`

  return (
    <main className="vk-auth">
      <section className="vk-auth__hero" aria-hidden="false">
        <Ornament className="vk-auth__ornament" />
        <div className="vk-auth__brand">
          <p className="vk-auth__eyebrow">Vakıf Eserleri Envanter Projesi</p>
          <h1 className="vk-auth__title">VAKIFNAME</h1>
          <GoldRule className="vk-auth__rule" />
          <p className="vk-auth__lead">
            Vakıf eserlerinin hikâyesini dinle, bilgini sına, mühürleri topla. Eserin önüne gidince mührün altına dönüşsün.
          </p>
          <ul className="vk-auth__steps" aria-label="Nasıl çalışır">
            <li><span aria-hidden="true">I</span> Dinle ve sor</li>
            <li><span aria-hidden="true">II</span> Bilgini sına</li>
            <li><span aria-hidden="true">III</span> Ziyaret et, altın mühür al</li>
          </ul>
        </div>
      </section>

      <section className="vk-auth__panel" aria-labelledby={fieldId('h')}>
        <div className="vk-auth__card">
          <h2 id={fieldId('h')} className="vk-auth__heading">Maceraya katıl</h2>

          <button type="button" className="vk-btn vk-btn--light vk-btn--block" onClick={google}>
            <GoogleMark /> Google ile devam et
          </button>
          {googleNote && (
            <p className="vk-auth__note" role="status">
              {googleNote}
            </p>
          )}

          <p className="vk-auth__or" aria-hidden="true"><span>veya e-posta ile</span></p>

          <div className="vk-auth__tabs" role="tablist" aria-label="Hesap işlemi">
            {(['giris', 'kayit'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={fieldId(`tab-${t}`)}
                aria-selected={tab === t}
                aria-controls={fieldId('form')}
                className="vk-auth__tab"
                onClick={() => {
                  setTab(t)
                  setErrors({})
                }}
              >
                {t === 'giris' ? 'Giriş yap' : 'Kayıt ol'}
              </button>
            ))}
          </div>

          <form id={fieldId('form')} role="tabpanel" aria-labelledby={fieldId(`tab-${tab}`)} onSubmit={submit} noValidate className="vk-auth__form">
            <label htmlFor={fieldId('email')}>E-posta</label>
            <input
              id={fieldId('email')}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? fieldId('email-e') : undefined}
            />
            {errors.email && <p id={fieldId('email-e')} className="vk-auth__error" role="alert">{errors.email}</p>}

            <label htmlFor={fieldId('pw')}>Parola</label>
            <input
              id={fieldId('pw')}
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? fieldId('pw-e') : undefined}
            />
            {errors.password && <p id={fieldId('pw-e')} className="vk-auth__error" role="alert">{errors.password}</p>}

            {register && (
              <>
                <label htmlFor={fieldId('again')}>Parola (tekrar)</label>
                <input
                  id={fieldId('again')}
                  type="password"
                  autoComplete="new-password"
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                  aria-invalid={!!errors.again}
                  aria-describedby={errors.again ? fieldId('again-e') : undefined}
                />
                {errors.again && <p id={fieldId('again-e')} className="vk-auth__error" role="alert">{errors.again}</p>}
              </>
            )}

            <button type="submit" className="vk-btn vk-btn--block">
              {register ? 'Hesap oluştur' : 'Giriş yap'}
            </button>
            <p className="vk-auth__note">Hesap sistemi yapım aşamasında: şimdilik oturum yalnızca bu tarayıcıda, geçici olarak açılır.</p>
          </form>

          <button type="button" className="vk-btn vk-btn--ghost vk-btn--block vk-auth__guest" onClick={guest}>
            Üye olmadan keşfet
          </button>
        </div>
      </section>
    </main>
  )
}
