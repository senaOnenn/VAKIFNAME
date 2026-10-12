import { forwardRef, useRef } from 'react'
import type { Place } from '../api/types'
import type { CheckInState } from '../hooks/useCheckIn'
import { describeApiError } from './ApiErrorMessage'
import { DemoBadge } from './DemoBadge'
import { AlertIcon, MapPinIcon, ScrollIcon } from './Icons'
import { QuestStatusBadge } from './QuestStatusBadge'
import type { QuestStatus } from './questStatus'
import { Seal } from './Seal'

interface Props {
  place: Place | null
  status: QuestStatus | null
  checkIn: CheckInState | undefined
  onCheckIn: (place: Place) => void
}

const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeStyle: 'short' })

export function formatStampDate(iso: string) {
  return dateFormat.format(new Date(iso))
}

function CheckInResult({ place, status, checkIn, onRetry }: { place: Place; status: QuestStatus; checkIn: CheckInState; onRetry: () => void }) {
  if (checkIn.status === 'pending') {
    return <p className="notice">Demo check-in backend’e gönderildi, yanıt bekleniyor…</p>
  }

  if (checkIn.status === 'error') {
    return (
      <div className="notice notice--error">
        <AlertIcon className="notice__icon" />
        <div>
          <p className="notice__title">Check-in tamamlanamadı</p>
          <p>{describeApiError(checkIn.error)}</p>
          <p>Mühür eklenmedi.</p>
          <button type="button" className="button button--secondary" onClick={onRetry}>
            Tekrar dene
          </button>
        </div>
      </div>
    )
  }

  const { response } = checkIn
  if (response.status === 'out_of_range') {
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

  // Başarı bildirimi, pasaport hâlâ bu mührü içeriyorsa gösterilir. Sunucu yeniden başlatılıp pasaport boş
  // dönerse eski başarı mesajı ekranda kalıp çelişki yaratmaz.
  if (status !== 'completed' && status !== 'checking') return null

  if (response.status === 'already_completed') {
    return (
      <p className="notice">
        <span>
          <strong>Bu görev daha önce tamamlanmıştı.</strong> Yeni mühür eklenmedi; pasaportundaki mevcut mühür
          {response.stamp && <> ({formatStampDate(response.stamp.earned_at)} tarihinde kazanıldı)</>} aynen duruyor.
        </span>
      </p>
    )
  }

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

export const QuestPanel = forwardRef<HTMLElement, Props>(function QuestPanel({ place, status, checkIn, onCheckIn }, ref) {
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

          {checkIn && (
            <CheckInResult
              place={place}
              status={status}
              checkIn={checkIn}
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
