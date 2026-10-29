import { useCallback, useId, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { GoogleButton } from '../components/GoogleButton'
import { GoldRule, Ornament } from '../components/Ornament'
import { googleSignIn, login, register, startGuest, useAuth } from '../session'
import './auth.css'

type Tab = 'giris' | 'kayit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 422) return 'Bilgileri kontrol et: geçerli bir e-posta ve 8–128 karakterlik bir parola gerekli.'
    return e.message
  }
  return 'Beklenmeyen bir hata oluştu.'
}

/** Giriş / Kayıt: Google ile devam, e-posta + parola, üye olmadan keşfet. */
export default function Auth() {
  const navigate = useNavigate()
  const auth = useAuth()
  const uid = useId()
  const [tab, setTab] = useState<Tab>('giris')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [googleNote, setGoogleNote] = useState('')

  const register_ = tab === 'kayit'

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!EMAIL_RE.test(email.trim())) e.email = 'Geçerli bir e-posta adresi yaz.'
    if (password.length < 8) e.password = 'Parola en az 8 karakter olmalı.'
    if (register_ && again !== password) e.again = 'Parolalar aynı değil.'
    return e
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setFormError('')
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      if (register_) {
        const user = await register(email.trim(), password)
        // Şehir ekranında "doğrulama bağlantısı gönderildi" bildirimi çıkar (bkz. AppShell).
        navigate('/sehir', { replace: true, state: { verifySent: user.email } })
      } else {
        await login(email.trim(), password)
        navigate('/sehir')
      }
    } catch (e) {
      setFormError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const onGoogle = useCallback(
    async (idToken: string) => {
      setGoogleNote('')
      try {
        await googleSignIn(idToken)
        navigate('/sehir')
      } catch (e) {
        setGoogleNote(messageOf(e))
      }
    },
    [navigate],
  )

  function guest() {
    startGuest()
    navigate('/sehir')
  }

  if (auth.status === 'user') return <Navigate to="/sehir" replace />

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

          <GoogleButton onCredential={onGoogle} onError={setGoogleNote} />
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
                  setFormError('')
                }}
              >
                {t === 'giris' ? 'Giriş yap' : 'Kayıt ol'}
              </button>
            ))}
          </div>

          <div id={fieldId('form')} role="tabpanel" aria-labelledby={fieldId(`tab-${tab}`)}>
          <form onSubmit={submit} noValidate className="vk-auth__form">
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
              autoComplete={register_ ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? fieldId('pw-e') : undefined}
            />
            {errors.password && <p id={fieldId('pw-e')} className="vk-auth__error" role="alert">{errors.password}</p>}

            {register_ && (
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

            {formError && (
              <p className="vk-auth__error vk-auth__error--form" role="alert">
                {formError}
              </p>
            )}
            <button type="submit" className="vk-btn vk-btn--block" disabled={busy} aria-busy={busy}>
              {busy ? 'Gönderiliyor…' : register_ ? 'Hesap oluştur' : 'Giriş yap'}
            </button>
            {!register_ && (
              <Link to="/sifre-sifirla" className="vk-auth__forgot">Şifremi unuttum</Link>
            )}
          </form>
          </div>

          <button type="button" className="vk-btn vk-btn--ghost vk-btn--block vk-auth__guest" onClick={guest}>
            Üye olmadan keşfet
          </button>
          <p className="vk-auth__note vk-auth__legal">
            Devam ederek <Link to="/gizlilik">aydınlatma metnini</Link> okuduğunu kabul edersin.
          </p>
        </div>
      </section>
    </main>
  )
}
