import { useEffect, useRef, useState } from 'react'
import type { Passport } from '../api/types'
import type { ApiState } from '../hooks/useApi'
import { ApiErrorMessage } from './ApiErrorMessage'
import { formatStampDate } from './QuestPanel'
import { Seal } from './Seal'

interface Props {
  userId: string
  passport: ApiState<Passport> & { reload: () => void }
}

export function PassportSection({ userId, passport }: Props) {
  // Yalnızca kullanıcının başlattığı yenilemenin sonucu duyurulur; sayfa açılışındaki yükleme sessizdir.
  // `requested` → yükleme başladı (`loading`) → sonuç geldi sırasıyla izlenir; eski veri yanlışlıkla duyurulmaz.
  const [refresh, setRefresh] = useState<'idle' | 'requested' | 'loading'>('idle')
  const [announcement, setAnnouncement] = useState('')
  const refreshButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (refresh === 'requested' && passport.status === 'loading') setRefresh('loading')
    if (refresh === 'loading' && passport.status !== 'loading') {
      setRefresh('idle')
      setAnnouncement(
        passport.status === 'success'
          ? `Pasaport yenilendi. Toplam ${passport.data.total_stamps} mühür.`
          : 'Pasaport yüklenemedi.',
      )
    }
  }, [refresh, passport])

  const requestRefresh = () => {
    setAnnouncement('')
    setRefresh('requested')
    passport.reload()
  }

  return (
    <section id="pasaport" className="section section--alt" aria-labelledby="pasaport-title">
      <div className="container">
        <div className="passport">
          <header className="passport__header">
            <Seal className="passport__emblem" />
            <div>
              <p className="passport__brand">VAKIFNAME</p>
              <h2 id="pasaport-title" className="passport__title">
                Dijital Miras Pasaportu
              </h2>
            </div>
          </header>

          <dl className="passport__holder">
            <div>
              <dt>Demo oyuncu kimliği</dt>
              <dd>
                <code>{userId}</code>
              </dd>
            </div>
          </dl>
          <p className="passport__note">
            Bu kimlik bir kullanıcı hesabı değildir ve güvenli kimlik doğrulama sağlamaz: yalnızca bu tarayıcı
            sekmesinin oturumunda tutulan rastgele bir demo etiketidir. Ad, e-posta gibi kişisel bilgi istenmez.
          </p>

          <div className="passport__toolbar">
            <button ref={refreshButtonRef} type="button" className="button button--secondary" onClick={requestRefresh}>
              Pasaportu yenile
            </button>
          </div>
          <p className="visually-hidden" role="status" aria-atomic="true">
            {announcement}
          </p>

          {passport.status === 'loading' && <p className="notice">Pasaport backend’den yükleniyor…</p>}

          {passport.status === 'error' && (
            // Sayfa açılışında arka planda yüklenir; hata ekranda gösterilir, yenileme sonucu yukarıdaki bölgeyle duyurulur.
            <ApiErrorMessage
              title="Pasaport yüklenemedi"
              error={passport.error}
              live={false}
              onRetry={() => {
                // Hata kutusu yeniden yüklemede kaldırılır; odak kaybolmasın diye yenile butonuna taşınır.
                refreshButtonRef.current?.focus()
                requestRefresh()
              }}
            />
          )}

          {passport.status === 'success' && (
            <>
              <p className="passport__total">
                <span className="passport__total-label">Toplam mühür</span>
                <span className="passport__total-value">{passport.data.total_stamps}</span>
              </p>

              {passport.data.stamps.length === 0 ? (
                <div className="passport__empty">
                  <Seal earned={false} className="passport__empty-seal" />
                  <p>
                    <strong>Pasaportun henüz boş.</strong> <a href="#gorevler">Görevler</a> bölümünden bir demo görevini
                    tamamladığında, backend’in onayladığı mühür burada görünecek.
                  </p>
                </div>
              ) : (
                <ol className="stamp-grid" aria-label="Kazanılan mühürler">
                  {passport.data.stamps.map((stamp) => (
                    <li key={stamp.place_id} className="stamp">
                      <Seal className="stamp__seal" />
                      <h3 className="stamp__name">{stamp.place_name}</h3>
                      <p className="stamp__date">
                        Kazanıldı: <time dateTime={stamp.earned_at}>{formatStampDate(stamp.earned_at)}</time>
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}

          <p className="passport__footnote">
            Mühürler yalnızca backend’in döndürdüğü pasaport verisinden gösterilir. İlerleme sunucu belleğinde tutulur;
            sunucu yeniden başlatılırsa mühürler silinebilir. Demo check-in gerçek bir ziyaretin kanıtı değildir.
          </p>
        </div>
      </div>
    </section>
  )
}
