import { useEffect, useId, useRef, useState } from 'react'
import { setA11y, useA11y, type TextSize } from '../a11y'
import { useLang } from '../i18n'
import './a11y-menu.css'

const SIZES: [TextSize, string][] = [
  ['normal', 'Normal'],
  ['large', 'Büyük'],
  ['xlarge', 'Çok büyük'],
]

/** Erişilebilirlik ayarları menüsü (7 Kasım): dil seçicinin yanında, her sayfada aynı yerde. */
export function A11yMenu({ className = '' }: { className?: string }) {
  const { t } = useLang()
  const p = useA11y()
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`vk-a11y ${className}`} ref={wrap}>
      <button ref={btn} type="button" className="vk-a11y__btn" aria-expanded={open} aria-controls={`${id}-p`}
        aria-label={t('Erişilebilirlik ayarları')} title={t('Erişilebilirlik ayarları')} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="4.6" r="1.9" />
          <path d="M4.5 8.6c2.5.8 5 1.1 7.5 1.1s5-.3 7.5-1.1" />
          <path d="M12 9.7v5" />
          <path d="m12 14.7-3.2 6M12 14.7l3.2 6" />
        </svg>
      </button>
      {open && (
        <div id={`${id}-p`} className="vk-a11y__panel" role="dialog" aria-labelledby={`${id}-h`}>
          <h2 id={`${id}-h`} className="vk-a11y__h">{t('Erişilebilirlik')}</h2>
          <fieldset className="vk-a11y__set">
            <legend>{t('Yazı boyutu')}</legend>
            <div className="vk-a11y__sizes">
              {SIZES.map(([v, label]) => (
                <label key={v} className="vk-a11y__size">
                  <input type="radio" name={`${id}-text`} checked={p.text === v} onChange={() => setA11y({ text: v })} />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="vk-a11y__check">
            <input type="checkbox" checked={p.contrast} onChange={(e) => setA11y({ contrast: e.target.checked })} />
            <span>{t('Yüksek kontrast')}</span>
          </label>
          <label className="vk-a11y__check">
            <input type="checkbox" checked={p.calm} onChange={(e) => setA11y({ calm: e.target.checked })} />
            <span>{t('Hareketi azalt')}</span>
          </label>
          <label className="vk-a11y__check">
            <input type="checkbox" checked={p.untimed} onChange={(e) => setA11y({ untimed: e.target.checked })} />
            <span>
              {t('Sorularda süre sınırı olmasın')}
              <small>{t('Her soruda 30 saniye yerine istediğin kadar düşünebilirsin.')}</small>
            </span>
          </label>
          <p className="vk-a11y__note">{t('Ayarlar yalnızca bu tarayıcıda saklanır.')}</p>
        </div>
      )}
    </div>
  )
}
