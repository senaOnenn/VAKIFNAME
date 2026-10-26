import { useId, useState } from 'react'
import { errorMessage } from './AskMonument'
import { openTesterSession } from './guideClient'

/**
 * Yapay zekâ rehberi yalnızca test kullanıcılarına açıkken gösterilir. Test anahtarı bir kez sunucuya gönderilir; sunucu
 * yerine `HttpOnly` oturum çerezi verir. Anahtar URL'ye, tarayıcı deposuna veya bileşen durumuna kalıcı yazılmaz.
 */
export function TesterLogin({ onOpened }: { onOpened: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  async function submit() {
    if (key.length < 16 || busy) return
    setBusy(true)
    setError(null)
    try {
      await openTesterSession(key)
      setKey('')
      onOpened()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="tester-login">
      <summary>Yapay zekâ rehberi deneme erişimi</summary>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label htmlFor={inputId}>Test anahtarı</label>
        <input
          id={inputId}
          type="password"
          value={key}
          maxLength={256}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="submit" className="button button--light" disabled={busy || key.length < 16}>
          {busy ? 'Doğrulanıyor…' : 'Giriş'}
        </button>
      </form>
      {error && (
        <p className="notice notice--warning" role="alert">
          {error}
        </p>
      )}
    </details>
  )
}
