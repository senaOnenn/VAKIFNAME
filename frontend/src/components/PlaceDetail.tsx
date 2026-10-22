import { forwardRef } from 'react'
import { getPlace } from '../api/client'
import type { Place } from '../api/types'
import { useApi } from '../hooks/useApi'
import { ApiErrorMessage } from './ApiErrorMessage'
import { DemoBadge } from './DemoBadge'
import { ArchitectureDrawing } from './ArchitectureDrawing'
import { CloseIcon, CompassIcon, ExternalLinkIcon, MapPinIcon, ScrollIcon } from './Icons'

interface Props {
  selectedId: string | null
  onClose: () => void
  onShowOnMap: () => void
  onGoToQuest: (placeId: string) => void
}

function isSafeUrl(url: string) {
  return /^https?:\/\//i.test(url)
}

function Source({ place }: { place: Place }) {
  const { source_title: title, source_url: url } = place
  if (!title && !url) return <dd>Bu kayıt için kaynak bilgisi bulunmuyor.</dd>
  if (url && isSafeUrl(url)) {
    return (
      <dd>
        <a href={url} target="_blank" rel="noopener noreferrer" className="detail__link">
          {title || url}
          <ExternalLinkIcon />
          <span className="visually-hidden">(yeni sekmede açılır)</span>
        </a>
      </dd>
    )
  }
  return <dd>{title}</dd>
}

function PlaceDetailContent({ placeId, onClose, onShowOnMap, onGoToQuest }: Props & { placeId: string }) {
  const place = useApi((signal) => getPlace(placeId, signal), placeId)

  if (place.status === 'loading') {
    return (
      <p className="notice" role="status">
        Eser ayrıntıları yükleniyor…
      </p>
    )
  }

  if (place.status === 'error') {
    const notFound = place.error.kind === 'http' && place.error.status === 404
    return (
      <>
        {notFound ? (
          <div className="notice notice--error" role="alert">
            <p className="notice__title">Eser bulunamadı</p>
            <p>“{placeId}” kimliğine sahip bir eser yok. Bağlantı hatalı olabilir ya da eser listeden kaldırılmış olabilir.</p>
          </div>
        ) : (
          <ApiErrorMessage title="Eser ayrıntıları yüklenemedi" error={place.error} onRetry={place.reload} />
        )}
        <button type="button" className="button button--secondary" onClick={onClose}>
          Seçimi temizle
        </button>
      </>
    )
  }

  const p = place.data
  return (
    <article className="detail" aria-labelledby="detail-title">
      <p className="sheet-top" aria-hidden="true">
        <span>VAKIFNAME</span>
        <span>Eser fişi</span>
      </p>
      <div className="detail__visual">
        <ArchitectureDrawing variant="revakli" />
      </div>
      <p className="detail__visual-caption">Bu eser için henüz görsel eklenmedi; çizim temsilidir.</p>

      <header className="detail__header">
        <h3 id="detail-title" className="detail__title">
          {p.name}
        </h3>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Ayrıntıları kapat">
          <CloseIcon />
        </button>
      </header>

      {p.is_demo && (
        <p className="notice notice--warning">
          <strong>Kurgusal demo kaydı.</strong> Bu eser ve konumu test amaçlıdır; gerçek bir tarihî eseri temsil etmez.
        </p>
      )}

      <p className="detail__description">{p.description}</p>

      <dl className="detail__facts">
        <div>
          <dt>Şehir</dt>
          <dd>{p.city}</dd>
        </div>
        <div>
          <dt>Kayıt durumu</dt>
          <dd>{p.is_demo ? <DemoBadge /> : 'Gerçek eser kaydı'}</dd>
        </div>
        <div>
          <dt>Konum</dt>
          <dd>
            <MapPinIcon /> {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
          </dd>
        </div>
        <div>
          <dt>Kaynak</dt>
          <Source place={p} />
        </div>
      </dl>

      <div className="detail__actions">
        <button type="button" className="button button--primary" onClick={() => onGoToQuest(p.id)}>
          <ScrollIcon /> Bu eserin görevine git
        </button>
        <button type="button" className="button button--secondary" onClick={onShowOnMap}>
          <CompassIcon /> Haritada göster
        </button>
      </div>
    </article>
  )
}

export const PlaceDetail = forwardRef<HTMLElement, Props>(function PlaceDetail(props, ref) {
  return (
    <aside ref={ref} className="detail-panel" aria-label="Eser ayrıntıları" tabIndex={-1}>
      {props.selectedId ? (
        // `key` ile her eser seçiminde içerik ve istek durumu sıfırlanır.
        <PlaceDetailContent key={props.selectedId} placeId={props.selectedId} {...props} />
      ) : (
        <div className="detail-panel__empty">
          <CompassIcon className="detail-panel__empty-icon" />
          <p>Ayrıntılarını görmek için listeden ya da haritadan bir eser seç.</p>
        </div>
      )}
    </aside>
  )
})
