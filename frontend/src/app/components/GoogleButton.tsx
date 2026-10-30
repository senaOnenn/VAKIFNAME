import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n'

/** Google Cloud "VAKIFNAME" projesinin Web istemci kimliği (gizli değildir). Boşsa Google girişi kapalıdır. */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const GSI_SRC = 'https://accounts.google.com/gsi/client'

interface GsiId {
  initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: 'popup' }): void
  renderButton(el: HTMLElement, o: Record<string, unknown>): void
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } }
  }
}

let loader: Promise<GsiId> | null = null
function loadGsi(): Promise<GsiId> {
  loader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GSI_SRC
    s.async = true
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('gsi')))
    s.onerror = () => {
      loader = null
      reject(new Error('gsi'))
    }
    document.head.appendChild(s)
  })
  return loader
}

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

/**
 * Google ile devam et. İstemci kimliği varsa Google'ın resmî düğmesi çizilir (marka kuralları); kimlik belirteci
 * `onCredential` ile sunucuya gider ve orada doğrulanır. Kimlik yoksa düğme dürüst bir bilgi verir.
 */
export function GoogleButton({ onCredential, onError }: { onCredential: (idToken: string) => void; onError: (m: string) => void }) {
  const slot = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const { lang, t } = useLang()
  const cb = useRef(onCredential)
  cb.current = onCredential

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    let alive = true
    loadGsi()
      .then((gsi) => {
        if (!alive || !slot.current) return
        gsi.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: 'popup',
          callback: (r) => (r.credential ? cb.current(r.credential) : onError('Google girişi tamamlanmadı.')),
        })
        slot.current.innerHTML = '' // dil değişince düğme yeniden çizilir
        gsi.renderButton(slot.current, {
          theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: lang,
          width: Math.min(360, slot.current.clientWidth || 320),
        })
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [onError, lang])

  if (GOOGLE_CLIENT_ID && !failed) return <div ref={slot} className="vk-google-slot" />
  return (
    <button
      type="button"
      className="vk-btn vk-btn--light vk-btn--block"
      onClick={() =>
        onError(
          failed
            ? 'Google girişine şu anda ulaşılamıyor. E-posta ile devam edebilir veya üye olmadan keşfedebilirsin.'
            : 'Google ile giriş henüz etkinleştirilmedi. Şimdilik e-posta ile devam edebilir veya üye olmadan keşfedebilirsin.',
        )
      }
    >
      <GoogleMark /> {t('Google ile devam et')}
    </button>
  )
}
