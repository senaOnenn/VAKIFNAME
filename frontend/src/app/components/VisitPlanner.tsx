import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { MonumentDetail } from '../api'
import { addressIn } from '../contentLang'
import { useLang } from '../i18n'
import { useVisitPlan } from '../visitPlan'
import { MapIcon } from './Icons'
import './visit-and-seal.css'

/**
 * R3.12 Ziyaret künyesi (müze duvar etiketinin ziyaret kısmı): katalogdaki adres, ilçe ve şehir; ziyaret uyarısı
 * (verilirse, eylemlerden önce); "Haritada gör" (`/harita?eser=…`) ve kişisel ziyaret rotasına ekleme/çıkarma
 * (`visitPlan`, tarayıcıda; oyun rotasından ve mühürlerden bağımsız) metin bağlantıları olarak. Konumu doğrulanmamış eser
 * rotaya eklenemez; bu dürüstçe söylenir. Koordinat, mesafe veya süre gösterilmez.
 */
export function VisitPlanner({ monument, notice, extra, mapLink = true }: {
  monument: Pick<MonumentDetail, 'monument_id' | 'address' | 'district' | 'city' | 'location'> & { name: string; address_en?: string | null }
  /** Ziyaret uyarısı (ibadet mekânı/türbe kuralları): eylemlerden önce görünür (CLAUDE.md §5). */
  notice?: ReactNode
  /** Altta ek bağlantı (ör. "Oyunda keşfet"). */
  extra?: ReactNode
  /** R6.11: "Haritada gör" sayfada başka yerde (sergi girişinde) varsa burada tekrar edilmez. */
  mapLink?: boolean
}) {
  const { t, lang } = useLang()
  const headingId = useId()
  const { plan, add, remove } = useVisitPlan()
  const [note, setNote] = useState('')
  const id = monument.monument_id
  const located = !!monument.location
  const inPlan = plan.includes(id)
  const toggle = () => {
    if (inPlan) {
      remove(id)
      setNote(t('{name} ziyaret rotandan çıkarıldı.', { name: monument.name }))
    } else {
      add(id)
      setNote(t('{name} ziyaret rotana eklendi.', { name: monument.name }))
    }
  }

  return (
    <section className="vk-visitc" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('Ziyaretini planla')}</h2>
      <address className="vk-visitc__addr">
        <span>{addressIn(monument, lang)}</span>
        <span className="vk-visitc__place">{monument.district ? `${monument.district}, ${monument.city}` : monument.city}</span>
      </address>
      {notice}
      <div className="vk-visitc__actions">
        {mapLink && <Link to={`/harita?eser=${encodeURIComponent(id)}`} className="vk-visitc__link vk-visitc__link--primary"><MapIcon />{t('Haritada gör')}</Link>}
        {located && (
          <button type="button" className="vk-visitc__link" onClick={toggle}>
            {inPlan ? t('Ziyaret rotamdan çıkar') : t('Ziyaret rotama ekle')}
          </button>
        )}
      </div>
      <p className="vk-visitc__note">
        {!located
          ? t('Bu eserin konumu henüz doğrulanmadı; haritada gösterilmiyor.')
          : inPlan
            ? <>{t('Bu eser ziyaret rotanda.')} <Link to="/harita">{t('Ziyaret rotamı haritada aç')}</Link></>
            : t('Ziyaret rotası senin gezi planındır; oyun rotasından ve mühürlerden bağımsızdır.')}
      </p>
      {extra}
      <p className="vk-sr-only" role="status">{note}</p>
    </section>
  )
}
