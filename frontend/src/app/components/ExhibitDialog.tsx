import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'

/**
 * Sergi penceresi (R6.11): Tarih Defteri ve Fotoğraf Arşivi tarayıcının üst katmanında açılan modal bir `<dialog>`'dur.
 * Hiçbir sayfa öğesi (yapışkan menü, rehber düğmesi) üstüne çıkıp tıklamaları yutamaz; Esc ve arka plana tıklama kapatır;
 * kapanınca odak açan nesneye döner. İçerik yalnızca açıkken oluşturulur. İç içe pencerede (fotoğraf inceleyicisi) Esc
 * önce içteki pencereyi kapatır (içteki olay `preventDefault` ile işaretlenir).
 */
export function ExhibitDialog({ open, onClose, labelledBy, className, returnFocus, children }: {
  open: boolean
  onClose: () => void
  labelledBy: string
  className: string
  returnFocus: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const wasOpen = useRef(false)
  // Pencere, içerikteki odak isteğinden önce açılmalı: düzen etkisi pasif etkilerden önce çalışır.
  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [open])
  useEffect(() => {
    if (!open && wasOpen.current) returnFocus.current?.focus()
    wasOpen.current = open
  }, [open, returnFocus])
  return (
    <dialog ref={ref} className={className} aria-labelledby={labelledBy}
      // React iç pencerenin (fotoğraf inceleyicisi) close/cancel olayını da buraya iletir: yalnızca kendi olayımız kapatır.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return
        // Esc: durum burada eşitlenir (kapanma React durumuyla).
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => {
        // jsdom ve eski tarayıcılar için Esc açıkça da kapatır (iç pencere işlediyse dokunulmaz).
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          onClose()
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose() // arka plana tıklama
      }}>
      {open && children}
    </dialog>
  )
}
