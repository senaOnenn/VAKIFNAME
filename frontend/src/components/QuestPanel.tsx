import { forwardRef, useRef } from 'react'
import type { Place } from '../api/types'
import type { CheckInState } from '../hooks/useCheckIn'
import { describeApiError } from './ApiErrorMessage'
import { DemoBadge } from './DemoBadge'
import { AlertIcon, CheckCircleIcon, MapPinIcon, ScrollIcon } from './Icons'
import { QuestStatusBadge } from './QuestStatusBadge'
import type { CheckInOutcome, QuestStatus } from './questStatus'
import { Seal } from './Seal'

interface Props {
  place: Place | null
  status: QuestStatus | null
  checkIn: CheckInState | undefined
  outcome: CheckInOutcome | null
  onCheckIn: (place: Place) => void
  onReloadPassport: () => void
}

const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeStyle: 'short' })

export function formatStampDate(iso: string) {
  return dateFormat.format(new Date(iso))
}

function CheckInResult({
  place,
  outcome,
  checkIn,
  onRetry,
  onReloadPassport,
}: {
  place: Place
  outcome: CheckInOutcome
  checkIn: CheckInState
  onRetry: () => void
  onReloadPassport: () => void
}) {
  const retryButton = (
    <button type="button" className="button button--secondary" onClick={onRetry}>
      Tekrar dene
    </button>
  )
  const reason = checkIn.status === 'error' ? describeApiError(checkIn.error) : ''
  const response = checkIn.status === 'done' ? checkIn.response : null

  switch (outcome) {
    case 'pending':
      return <p className="notice">Demo check-in backend’e gönderildi, yanıt bekleniyor…</p>

    // Check-in yanıtı alınamadı: sunucu isteği işlemiş olabilir, sonuç pasaporttan doğrulanır.
    case 'verifying':
      return (
        <p className="notice">
          <span>
            <strong>İşlem sonucu doğrulanamadı.</strong> Check-in yanıtı alınamadı; pasaport kontrol ediliyor… {reason}
          </span>
        </p>
      )

    case 'unknown':
      return (
        <div className="notice notice--warning">
          <AlertIcon className="notice__icon" />
          <div>
            <p className="notice__title">İşlem sonucu doğrulanamadı</p>
            <p>
              Check-in yanıtı alınamadı ve pasaport da yüklenemedi. Mührün eklenip eklenmediği şu anda bilinmiyor.{' '}
              {reason}
            </p>
            <p>Tekrar denemek güvenlidir: aynı görev için ikinci mühür oluşturulmaz.</p>
            {retryButton}
          </div>
        </div>
      )

    case 'not-earned':
      return (
        <div className="notice notice--error">
          <AlertIcon className="notice__icon" />
          <div>
            <p className="notice__title">Check-in tamamlanamadı</p>
            <p>{reason}</p>
            <p>Pasaport kontrol edildi: bu eser için mühür yok.</p>
            {retryButton}
          </div>
        </div>
      )

    case 'confirmed':
      return (
        <div className="notice notice--success">
          <CheckCircleIcon className="notice__icon" />
          <div>
            <p className="notice__title">Görev tamamlanmış</p>
            <p>
              Check-in yanıtı alınamadı, ancak backend’den yeniden okunan pasaport bu görevin mührünü içeriyor.
            </p>
            <a className="button button--secondary" href="#pasaport">
              Pasaportu gör
            </a>
          </div>
        </div>
      )

    case 'out-of-range': {
      if (!response) return null
      return (
        <div className="notice notice--warning">
          <AlertIcon className="notice__icon" />
          <div>
            <p className="notice__title">Konum görev alanı dışında</p>
            <p>
              Bildirilen konum eserden {response.distance_m.toLocaleString('tr-TR')} m uzakta; izin verilen yarıçap{' '}
              {response.allowed_radius_m.toLocaleString('tr-TR')} m. Görev tamamlanmadı ve mühür kazanılmadı.
            </p>
          </div>
        </div>
      )
    }

    case 'earned-unverified':
      return (
        <div className="notice notice--warning">
          <AlertIcon className="notice__icon" />
          <div>
            <p className="notice__title">Check-in onaylandı, pasaport yenilenemedi</p>
            <p>
              Backend görevi onayladı, ancak pasaport yüklenemediği için mühür pasaportunda henüz gösterilemiyor.
            </p>
            <button type="button" className="button button--secondary" onClick={onReloadPassport}>
              Pasaportu yeniden yükle
            </button>
          </div>
        </div>
      )

    // Sunucu yeniden başlatılıp pasaport boş dönerse eski başarı mesajı ekranda kalıp çelişki yaratmaz.
    case 'stale':
      return null

    case 'already': {
      if (!response) return null
      return (
        <p className="notice">
          <span>
            <strong>Bu görev daha önce tamamlanmıştı.</strong> Yeni mühür eklenmedi; pasaportundaki mevcut mühür
            {response.stamp && <> ({formatStampDate(response.stamp.earned_at)} tarihinde kazanıldı)</>} aynen duruyor.
          </span>
        </p>
      )
    }

    case 'earned': {
      if (!response) return null
      return (
        <div className="notice notice--success quest-success">
          <Seal className="quest-success__seal" />
          <div>
            <p className="notice__title">Görev tamamlandı!</p>
            <p>
              Backend check-in’i onayladı ve pasaportuna <strong>{response.stamp?.place_name ?? place.name}</strong>{' '}
              mührü eklendi.
            </p>
            <a className="button button--secondary" href="#pasaport">
              Pasaportu gör
            </a>
          </div>
        </div>
      )
    }
  }
}

export const QuestPanel = forwardRef<HTMLElement, Props>(function QuestPanel({ place, status, checkIn, outcome, onCheckIn, onReloadPassport }, ref) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pending = checkIn?.status === 'pending'

  const tryCheckIn = () => {
    if (!place || pending) return
    onCheckIn(place)
  }

  return (
    <aside ref={ref} className="quest-panel" aria-label="Aktif görev" tabIndex={-1}>
      {place && status ? (
        <div className="quest-panel__content">
          <p className="sheet-top" aria-hidden="true">
            <span>VAKIFNAME</span>
            <span>Görev fişi</span>
          </p>
          <p className="quest-panel__eyebrow">
            <ScrollIcon /> Aktif görev
          </p>
          <h3 id="quest-panel-title" className="quest-panel__title">
            {place.name}
          </h3>
          <div className="quest-panel__meta">
            <span className="place-card__city">
              <MapPinIcon />
              {place.city}
            </span>
            {place.is_demo && <DemoBadge />}
            <QuestStatusBadge status={status} />
          </div>

          <p>
            <strong>Keşif görevi:</strong> Eserin {place.check_in_radius_m.toLocaleString('tr-TR')} m’lik görev alanında
            check-in yap ve dijital mührünü kazan.
          </p>

          <div className="notice notice--warning quest-panel__demo" role="note">
            <AlertIcon className="notice__icon" />
            <p>
              <strong>Demo check-in.</strong> Tarayıcı konumun istenmez ve kullanılmaz. Butona bastığında eserin backend
              kaydındaki koordinatlar ({place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}) gönderilir. Bu, gerçek
              bir ziyaretin kanıtı değildir ve GPS doğrulaması yapılmaz.
            </p>
          </div>

          <button
            ref={buttonRef}
            type="button"
            className="button button--primary"
            // `disabled` yerine `aria-disabled`: odak butonda kalır, klavye kullanıcısı yerini kaybetmez.
            aria-disabled={pending}
            aria-describedby="quest-panel-title"
            onClick={tryCheckIn}
          >
            {pending ? 'Kontrol ediliyor…' : 'Demo konumuyla görevi dene'}
          </button>

          {checkIn && outcome && (
            <CheckInResult
              place={place}
              outcome={outcome}
              checkIn={checkIn}
              onReloadPassport={onReloadPassport}
              onRetry={() => {
                buttonRef.current?.focus()
                tryCheckIn()
              }}
            />
          )}
        </div>
      ) : (
        <div className="detail-panel__empty">
          <ScrollIcon className="detail-panel__empty-icon" />
          <p>Bir görev kartında “Göreve başla”ya bas; görev ayrıntıları burada açılır.</p>
        </div>
      )}
    </aside>
  )
})
