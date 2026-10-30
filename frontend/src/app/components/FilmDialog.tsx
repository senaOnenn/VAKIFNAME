import { useEffect, useId, useRef } from 'react'
import { useLang } from '../i18n'
import './film-dialog.css'

const BASE = import.meta.env.BASE_URL
export const FILM_URL = `${BASE}media/tanitim.mp4?v=${__MEDIA_VERSION__}`
const VTT = { tr: `${BASE}media/tanitim-tr.vtt?v=${__MEDIA_VERSION__}`, en: `${BASE}media/tanitim-en.vtt?v=${__MEDIA_VERSION__}` }

/**
 * Tanıtım filmi (Faz 9): ekranı kaplayan pencere. Ses kullanıcı açınca başlar; altyazı varsayılan olarak açıktır (arayüz
 * dilinde). Esc ya da "Kapat" ile kapanır, odak açan düğmeye döner (yerel `<dialog>`).
 */
export function FilmDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLang()
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
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

  return (
    <dialog ref={ref} className="vk-film" aria-labelledby={`${id}-h`} onClose={onClose} onCancel={onClose}>
      <div className="vk-film__bar">
        <h2 id={`${id}-h`}>{t('Tanıtım filmi')}</h2>
        <button type="button" className="vk-film__close" onClick={onClose}>
          {t('Kapat')}
        </button>
      </div>
      {open && (
        <video className="vk-film__video" src={FILM_URL} controls autoPlay playsInline preload="metadata">
          <track kind="subtitles" srcLang="tr" label="Türkçe" src={VTT.tr} default={lang === 'tr'} />
          <track kind="subtitles" srcLang="en" label="English" src={VTT.en} default={lang === 'en'} />
        </video>
      )}
      <p className="vk-film__note">
        {t('Seslendirme, ekip üyemizin sesinden izniyle yapay zekâ ile üretildi. Rehber bir canlandırmadır.')}
      </p>
    </dialog>
  )
}
