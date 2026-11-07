import { typeLabel, type MonumentDetail } from '../api'
import { addressIn, altNamesIn } from '../contentLang'
import { useLang } from '../i18n'

/**
 * Eser künyesi (R3): yalnızca onaylı katalogda bulunan alanlar — tür, ilçe/şehir, adres, onaylı diğer adlar, kayıtların
 * dayandığı kaynak yayınlar ve sayılar. Yeni bilgi üretilmez; alan yoksa satır gösterilmez. Tanım listesi (`dl`) olarak
 * işaretlenir: ekran okuyucu "terim — değer" çiftlerini doğru okur.
 */
export function MonumentFactSheet({ monument: d, headingId, compact = false }: {
  monument: Pick<MonumentDetail, 'type' | 'district' | 'city' | 'address' | 'alternative_names' | 'facts' | 'images'> &
    Partial<Pick<MonumentDetail, 'alternative_names_en' | 'address_en'>>
  headingId: string
  /** R3.8: küçük künye — tür, diğer adlar ve kaynak yayınlar. Konum ve adres ziyaret alanında, sayılar defter ve arşivde. */
  compact?: boolean
}) {
  const { t, lang } = useLang()
  const alt = altNamesIn(d, lang)
  const sources = [...new Set(d.facts.map((f) => f.source?.title).filter((s): s is string => !!s))]
  const rows: [string, string][] = compact ? [
    [t('Tür'), typeLabel(d.type)],
    ...(alt.length ? [[t('Diğer adları'), alt.join(' · ')] as [string, string]] : []),
    ...(sources.length ? [[sources.length > 1 ? t('Kaynak yayınlar') : t('Kaynak yayın'), sources.join(' · ')] as [string, string]] : []),
  ] : [
    [t('Tür'), typeLabel(d.type)],
    [t('Konum'), [d.district, d.city].filter(Boolean).join(', ')],
    [t('Adres'), addressIn(d, lang)],
    ...(alt.length ? [[t('Diğer adları'), alt.join(' · ')] as [string, string]] : []),
    ...(sources.length ? [[sources.length > 1 ? t('Kaynak yayınlar') : t('Kaynak yayın'), sources.join(' · ')] as [string, string]] : []),
    [t('Onaylı kayıt'), String(d.facts.length)],
    [t('Fotoğraf'), String(d.images.length)],
  ]
  return (
    <section className={`vk-sheet${compact ? ' vk-sheet--compact' : ''}`} aria-labelledby={headingId}>
      <h2 id={headingId} className="vk-sheet__h">{t('Künye')}</h2>
      <dl className="vk-sheet__list">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="vk-sheet__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
