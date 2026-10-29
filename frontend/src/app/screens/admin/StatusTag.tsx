import type { ContentStatus } from '../../api'
import { STATUS_LABEL } from './labels'

/** İçerik durumu: metinle yazılır, renk yalnızca destekler. */
export function StatusTag({ status }: { status: ContentStatus }) {
  return <span className={`vk-ctag vk-ctag--${status}`}>{STATUS_LABEL[status]}</span>
}

/** Kaydın kaynağı: katalog (onaylı V20, salt okunur) veya içerik yönetiminde eklenen. */
export function OriginTag({ origin }: { origin: 'catalog' | 'content' }) {
  return <span className={`vk-ctag vk-ctag--${origin}`}>{origin === 'catalog' ? 'Katalog' : 'Yeni eser'}</span>
}
