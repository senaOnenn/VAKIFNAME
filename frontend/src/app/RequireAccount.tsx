import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useLang } from './i18n'
import { useAuth } from './session'

/** Giriş sayfasının dönüş adresi parametresi (`/giris?sonra=/oyun/rota/bursa`). */
export const NEXT_PARAM = 'sonra'

/**
 * Girişten sonra gidilecek adres: yalnızca bu sitenin içindeki bir yol kabul edilir (açık yönlendirme olmasın).
 * `//başka-site`, `/\başka-site`, tam adres ve kontrol karakterleri reddedilir; geçersizse `fallback`.
 */
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw || raw.length > 512) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback
  if (raw === '/giris' || raw.startsWith('/giris?') || raw.startsWith('/giris/')) return fallback
  return raw
}

/** Giriş sayfasının adresi; girişten sonra `to` adresine dönülür. */
export function loginPath(to: string): string {
  return `/giris?${NEXT_PARAM}=${encodeURIComponent(to)}`
}

/**
 * R6.2: oyun yalnızca hesapla oynanır. Oturum yoksa (misafir dahil) giriş sayfasına gider, istenen adres korunur.
 * Bu yalnızca arayüz kapısıdır; asıl denetim sunucudadır (`require_progress_access`: oturumsuz istek 401, başka hesabın
 * ilerlemesi 403). Oturum denetlenirken hiçbir oyun verisi istenmez.
 */
export function RequireAccount({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const { pathname, search, hash } = useLocation()
  const { t } = useLang()
  if (auth.status === 'loading') {
    return (
      <main className="vk-page">
        <p className="vk-page__state" role="status">{t('Oturum denetleniyor…')}</p>
      </main>
    )
  }
  if (auth.status !== 'user') return <Navigate to={loginPath(pathname + search + hash)} replace />
  return <>{children}</>
}
