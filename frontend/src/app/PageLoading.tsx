import { useEffect, useState } from 'react'
import { useLang } from './i18n'

/**
 * R6.12: ekran parçası yüklenirken gösterilen sakin durum. İlk 400 ms boş kalır (hızlı yüklemede yanıp sönen yazı yok);
 * daha uzun sürerse kısa bir "Yükleniyor…" yazısı belirir. Sayfa zemini aynı olduğu için titreme oluşmaz.
 */
export function PageLoading() {
  const { t } = useLang()
  const [late, setLate] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setLate(true), 400)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <main className="vk-page" aria-busy="true">
      {late && <p className="vk-page__state" role="status">{t('Yükleniyor…')}</p>}
    </main>
  )
}
