import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { GoldRule } from '../components/Ornament'
import { clearLinkToken, readLinkToken, requestPasswordReset, resetPassword, useAuth, verifyEmail } from '../session'
import './auth.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.kind === 'http' && e.status !== 422) return e.message
  if (e instanceof ApiError && e.kind !== 'http') return 'Sunucuya ulaşılamadı. Bağlantını kontrol edip yeniden dene.'
  return fallback
}

/** Bağlantının belirtecini bir kez okur ve hemen adres çubuğundan siler (geçmişte ve ekran görüntüsünde kalmasın). */
function useLinkToken(): string | null {
  const [token] = useState(readLinkToken)
  useEffect(() => clearLinkToken(), [])
  return token
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <main className="vk-auth vk-auth--single">
      <section className="vk-auth__panel" aria-labelledby={id}>
        <div className="vk-auth__card">
          <p className="vk-auth__eyebrow">VAKIFNAME</p>
          <h1 id={id} className="vk-auth__heading">{title}</h1>
          <GoldRule className="vk-auth__rule" />
          {children}
        </div>
      </section>
    </main>
  )
}

/** `/dogrula#t=…`: e-posta doğrulama bağlantısı. */
export function VerifyEmail() {
  const token = useLinkToken()
  const auth = useAuth()
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>(token ? 'checking' : 'error')
  const [error, setError] = useState(token ? '' : 'Bağlantı eksik ya da bozuk. E-postadaki bağlantıyı yeniden aç.')

  useEffect(() => {
    if (!token) return
    let live = true
    verifyEmail(token).then(
      () => live && setStatus('ok'),
      (e) => {
        if (!live) return
        setError(messageOf(e, 'Bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Yeni bir bağlantı iste.'))
        setStatus('error')
      },
    )
    return () => {
      live = false
    }
  }, [token])

  const signedIn = auth.status === 'user'
  return (
    <Card title={status === 'ok' ? 'E-postan doğrulandı' : 'E-posta doğrulama'}>
      <div aria-live="polite" className="vk-auth__message">
        {status === 'checking' && <p role="status">Bağlantı denetleniyor…</p>}
        {status === 'ok' && <p role="status">Teşekkürler. Hesabının e-posta adresi artık doğrulanmış.</p>}
        {status === 'error' && <p className="vk-auth__error vk-auth__error--form" role="alert">{error}</p>}
      </div>
      {status === 'ok' && (
        <Link to={signedIn ? '/sehir' : '/giris'} className="vk-btn vk-btn--block">
          {signedIn ? 'Keşfe devam et' : 'Giriş yap'}
        </Link>
      )}
      {status === 'error' && (
        <Link to={signedIn ? '/hesap' : '/giris'} className="vk-btn vk-btn--ghost vk-btn--block">
          {signedIn ? 'Hesabımdan yeni bağlantı iste' : 'Giriş sayfasına dön'}
        </Link>
      )}
    </Card>
  )
}

/** `/sifre-sifirla`: parola yenileme bağlantısı iste. Cevap, hesabın olup olmadığını belli etmez. */
export function ForgotPassword() {
  const uid = useId()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setError('')
    if (!EMAIL_RE.test(email.trim())) {
      setError('Geçerli bir e-posta adresi yaz.')
      return
    }
    setBusy(true)
    try {
      await requestPasswordReset(email.trim())
      setSent(true)
    } catch (e) {
      setError(messageOf(e, 'Geçerli bir e-posta adresi yaz.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Parolanı yenile">
      {sent ? (
        <p role="status" className="vk-auth__message">
          Bu adresle kayıtlı bir hesap varsa parola yenileme bağlantısını gönderdik. Bağlantı kısa süre geçerlidir;
          gelen kutunu ve istenmeyen e-posta klasörünü kontrol et.
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="vk-auth__form">
          <p className="vk-auth__note">Hesabının e-posta adresini yaz; yeni parola belirlemen için bir bağlantı gönderelim.</p>
          <label htmlFor={`${uid}-email`}>E-posta</label>
          <input
            id={`${uid}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `${uid}-e` : undefined}
          />
          {error && <p id={`${uid}-e`} className="vk-auth__error" role="alert">{error}</p>}
          <button type="submit" className="vk-btn vk-btn--block" disabled={busy} aria-busy={busy}>
            {busy ? 'Gönderiliyor…' : 'Bağlantı gönder'}
          </button>
        </form>
      )}
      <Link to="/giris" className="vk-auth__back">Giriş sayfasına dön</Link>
    </Card>
  )
}

/** `/sifre-yenile#t=…`: yeni parola. Başarılıysa sunucu eski oturumları kapatır ve bu cihazda oturum açar. */
export function ResetPassword() {
  const token = useLinkToken()
  const navigate = useNavigate()
  const uid = useId()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!token) {
    return (
      <Card title="Parolanı yenile">
        <p className="vk-auth__error vk-auth__error--form" role="alert">
          Bağlantı eksik ya da bozuk. E-postadaki bağlantıyı yeniden aç veya yeni bir bağlantı iste.
        </p>
        <Link to="/sifre-sifirla" className="vk-btn vk-btn--block">Yeni bağlantı iste</Link>
      </Card>
    )
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setFormError('')
    const found: Record<string, string> = {}
    if (password.length < 8) found.password = 'Parola en az 8 karakter olmalı.'
    else if (password.length > 128) found.password = 'Parola en fazla 128 karakter olabilir.'
    if (again !== password) found.again = 'Parolalar aynı değil.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      await resetPassword(token!, password)
      navigate('/sehir', { replace: true })
    } catch (e) {
      setFormError(messageOf(e, 'Parola kaydedilemedi.'))
      setBusy(false)
    }
  }

  return (
    <Card title="Yeni parola belirle">
      <form onSubmit={submit} noValidate className="vk-auth__form">
        <p className="vk-auth__note">Yeni parolan kaydedilince diğer cihazlardaki oturumların kapanır.</p>
        <label htmlFor={`${uid}-pw`}>Yeni parola</label>
        <input
          id={`${uid}-pw`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? `${uid}-pw-e` : undefined}
        />
        {errors.password && <p id={`${uid}-pw-e`} className="vk-auth__error" role="alert">{errors.password}</p>}
        <label htmlFor={`${uid}-again`}>Yeni parola (tekrar)</label>
        <input
          id={`${uid}-again`}
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          aria-invalid={!!errors.again}
          aria-describedby={errors.again ? `${uid}-again-e` : undefined}
        />
        {errors.again && <p id={`${uid}-again-e`} className="vk-auth__error" role="alert">{errors.again}</p>}
        {formError && (
          <p className="vk-auth__error vk-auth__error--form" role="alert">
            {formError} <Link to="/sifre-sifirla">Yeni bağlantı iste</Link>
          </p>
        )}
        <button type="submit" className="vk-btn vk-btn--block" disabled={busy} aria-busy={busy}>
          {busy ? 'Kaydediliyor…' : 'Parolayı kaydet'}
        </button>
      </form>
    </Card>
  )
}
