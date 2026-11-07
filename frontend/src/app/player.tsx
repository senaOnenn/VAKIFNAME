import { createContext, useContext, useEffect } from 'react'
import { ApiError } from '../api/client'
import { backendIsCurrent, getPlayerProfile, REQUIRED_API_VERSION, type PlayerProfile, type Stage, type XpSource } from './api'
import { useLang } from './i18n'
import { refreshAuth } from './session'

/**
 * Oyun panelinin oyuncu profili bağlamı (R6.4). Görev tamamlanınca (sınav, ziyaret) ekran `refresh()` çağırır; profil
 * sunucudan yeniden okunur ve XP arttıysa küçük bir bildirim çıkar. XP istemcide hesaplanmaz.
 */
export const PlayerContext = createContext<{ refresh: () => void; profile: PlayerProfile | null }>({ refresh: () => undefined, profile: null })
export const usePlayer = () => useContext(PlayerContext)

/** Görünüm aşamalarının adları (yalnızca kozmetik; seviyeden hesaplanır). */
export const STAGE_LABEL: Record<Stage, string> = {
  baslangic: 'Başlangıç',
  gezginlik: 'Gezginlik',
  arastirmaci: 'Araştırmacı',
  muhafiz: 'Vakfiye Muhafızı',
}

/** XP kazanım nedenleri (sunucudaki `source`). */
export const XP_REASON: Record<XpSource, string> = {
  first_discovery: 'İlk eser keşfi',
  listened: 'Anlatımı dinledin',
  listen_and_ask: 'Rehbere soru sordun',
  knowledge: 'Bilgi mührü',
  visit: 'Doğrulanmış ziyaret',
}

// --- Profil yükleme ve hata türleri (R6.4.1) ------------------------------------------------------------------------

/** Kullanıcıya gösterilecek hata türü; teknik ayrıntı ve sunucu iç mesajı gösterilmez. */
export type ProfileFail = 'offline' | 'session' | 'outdated' | 'error'
export type ProfileResult = { profile: PlayerProfile; fail: null } | { profile: null; fail: ProfileFail }

export const PROFILE_FAIL_TEXT: Record<ProfileFail, string> = {
  offline: 'Sunucuya bağlanılamıyor. Bağlantını kontrol edip yeniden dene.',
  session: 'Oturumunun süresi doldu. Devam etmek için yeniden giriş yap.',
  outdated: 'Oyun sunucusu güncel değil; oyuncu bilgileri alınamadı. Biraz sonra yeniden dene.',
  error: 'Oyuncu bilgileri alınamadı; yeniden dene.',
}

/** Hatanın türü: bağlantı yok, oturum düşmüş, sunucu eski sürüm (uç yok) ya da başka bir sunucu hatası. */
export async function profileFailure(e: unknown, signal?: AbortSignal): Promise<ProfileFail> {
  if (!(e instanceof ApiError)) return 'error'
  if (e.kind === 'network' || e.kind === 'timeout') return 'offline'
  if (e.status === 401) return 'session'
  if (e.status === 404 || e.status === 405) {
    if (!(await backendIsCurrent(signal))) {
      // Geliştirici için (kişisel veri yok): çalışan sunucu bu arayüzden eski.
      console.warn(`VAKIFNAME: sunucu API sürümü ${REQUIRED_API_VERSION}'ten eski; arka ucu güncel kodla yeniden başlatın.`)
      return 'outdated'
    }
  }
  return 'error'
}

/** Profili okur; hata fırlatmak yerine türünü döndürür (iptal edilen istek hariç). Varsayılan profil uydurulmaz. */
export async function loadPlayerProfile(signal: AbortSignal): Promise<ProfileResult> {
  try {
    return { profile: await getPlayerProfile(signal), fail: null }
  } catch (e) {
    if (signal.aborted) throw e
    return { profile: null, fail: await profileFailure(e, signal) }
  }
}

/**
 * Profil hatası: türüne uygun kısa mesaj ve "Tekrar dene". Oturum düşmüşse oturum durumu tazelenir; oyun kapısı
 * (RequireAccount) kullanıcıyı girişe, sonra aynı adrese götürür.
 */
export function PlayerLoadError({ fail, onRetry, className }: { fail: ProfileFail; onRetry: () => void; className?: string }) {
  const { t } = useLang()
  useEffect(() => {
    if (fail === 'session') void refreshAuth()
  }, [fail])
  return (
    <p className={className} role="alert">
      {t(PROFILE_FAIL_TEXT[fail])}{' '}
      {fail !== 'session' && <button type="button" className="vk-link-btn" onClick={onRetry}>{t('Tekrar dene')}</button>}
    </p>
  )
}
