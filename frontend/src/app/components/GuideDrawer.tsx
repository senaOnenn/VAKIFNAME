import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { useLang } from '../i18n'
import guidePortrait from '../../assets/guide/rehber-kadin-320.webp'
import './guide-drawer.css'

/**
 * R3.9 / R3.11 Rehber paneli: sağdan açılan sohbet paneli (masaüstünde ~420 px, telefonda tam ekran). İçeriği çağıran
 * verir (eser sohbeti + anlatım ya da genel sohbet). Kapanınca yalnızca gizlenir (içerik ve sohbet geçmişi korunur).
 * Açılınca odak soru kutusuna (hazır değilse panel başlığına), Esc ile kapanır, odak açan düğmeye döner.
 */
export function GuideDrawer({ open, onClose, returnFocus, context, children }: {
  open: boolean
  onClose: () => void
  returnFocus: RefObject<HTMLButtonElement | null>
  /** Sohbetin konusu: eser adı ya da "bütün eserler". */
  context: string
  children: ReactNode
}) {
  const { t } = useLang()
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open) {
      // Görünen içerikteki sohbet kutusu kullanılabilirse ona, değilse panel başlığına (durum yüklenirken kutu kapalıdır).
      const box = [...(panel.current?.querySelectorAll<HTMLInputElement>('.vk-chat__form input:not([type])') ?? [])]
        .find((el) => !el.closest('[hidden]'))
      if (box && !box.disabled) box.focus()
      else heading.current?.focus()
    } else if (wasOpen.current) {
      returnFocus.current?.focus()
    }
    wasOpen.current = open
  }, [open, returnFocus])

  // Esc belge düzeyinde: soru gönderilince kutu ve düğme devre dışı kalır, odak gövdeye düşebilir; Esc yine kapatır.
  // Üstte modal bir pencere (Tarih Defteri, fotoğraf inceleyici) açıksa Esc ona aittir.
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div ref={panel} className="vk-drawer" role="dialog" aria-modal="false" aria-labelledby={`${id}-h`} aria-describedby={`${id}-c`}
      hidden={!open}>
      <div className="vk-drawer__head">
        <img className="vk-drawer__portrait" src={guidePortrait} alt="" width={48} height={48} />
        <div className="vk-drawer__who">
          <h2 id={`${id}-h`} ref={heading} tabIndex={-1}>{t('Rehber')}</h2>
          <p id={`${id}-c`}>{context}</p>
        </div>
        <button type="button" className="vk-drawer__close" onClick={onClose} aria-label={t('Rehberi kapat')}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3 3 13" /></svg>
        </button>
      </div>
      <div className="vk-drawer__body">{children}</div>
    </div>
  )
}
