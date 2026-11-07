import type { ReactNode } from 'react'

/**
 * Ortak sayfa durumu (Görev 50 / A2): yükleniyor, boş, filtre sonucu boş, hata ve bilgi. Stili design/page.css'tedir
 * (`.vk-state`); o dosya discover.css üzerinden yüklenir, bu bileşen CSS'i ayrıca içe aktarmaz (cascade sırası değişmesin).
 *
 * Erişilebilirlik: hata `role="alert"`, diğer durumlar `role="status"` (değişince ekran okuyucu okur); bilgi durumu
 * kalıcı bir açıklama olduğu için canlı bölge değildir. Simge yalnızca süstür; anlam başlık metnindedir.
 * Eylem düğmesi yalnızca çağıran gerçek bir işlev verdiğinde (ör. `reload`, filtre temizleme) görünür: sahte düğme yok.
 */
export type PageStateKind = 'loading' | 'empty' | 'filtered-empty' | 'error' | 'info'

export interface PageStateAction {
  label: string
  onClick: () => void
}

interface Props {
  kind: PageStateKind
  /** Ana mesaj (çevrilmiş metin). */
  title: ReactNode
  /** İsteğe bağlı açıklama satırı. */
  children?: ReactNode
  action?: PageStateAction
  className?: string
}

const svg = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false }

/** Durum simgeleri: sekiz köşeli yıldız (yükleniyor, girih motifi), boş kitap, süzgeç, ünlem, bilgi. */
function StateIcon({ kind }: { kind: PageStateKind }) {
  switch (kind) {
    case 'loading':
      return <svg {...svg}><path d="M12 3l2.6 2.7 3.8-.1-.1 3.8L21 12l-2.7 2.6.1 3.8-3.8-.1L12 21l-2.6-2.7-3.8.1.1-3.8L3 12l2.7-2.6-.1-3.8 3.8.1z" /><circle cx="12" cy="12" r="3" /></svg>
    case 'empty':
      return <svg {...svg}><path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" /><path d="M12 6v13.5" /></svg>
    case 'filtered-empty':
      return <svg {...svg}><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" /><path d="m16 16 4 4M20 16l-4 4" /></svg>
    case 'error':
      return <svg {...svg}><path d="M12 3 2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>
    case 'info':
      return <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>
  }
}

export function PageState({ kind, title, children, action, className = '' }: Props) {
  const role = kind === 'error' ? 'alert' : kind === 'info' ? undefined : 'status'
  return (
    <div className={`vk-state vk-state--${kind}${className ? ` ${className}` : ''}`} role={role} aria-busy={kind === 'loading' || undefined}>
      <span className="vk-state__icon">
        <StateIcon kind={kind} />
      </span>
      <p className="vk-state__title">{title}</p>
      {children && <p className="vk-state__detail">{children}</p>}
      {action && (
        <button type="button" className="vk-btn vk-btn--ghost vk-state__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
