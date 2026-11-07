import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { mediaUrl, typeLabel, type MonumentSummary } from '../api'
import { creditIn, nameOf, textIn } from '../contentLang'
import { useLang } from '../i18n'
import { useNear } from '../story/common'
import type { SealStatus } from './StatusBadge'

const SEAL_LABEL: Record<SealStatus, string> = { completed: 'Bilgi mührü', gold: 'Altın mühür' }

/**
 * R6.13 Koleksiyon kartı (Keşfet): müze çerçevesinde eserin kendi katalog fotoğrafı (kart dosyası, 3:2, sabit oran: CLS
 * yok), küçük tür ve ilçe etiketi, eser adı, onaylı kısa tanıtım (en çok 3 satır), "Eseri Keşfet" ve fotoğrafın atfı.
 * Kartın tamamı tek bağlantıdır (adı eserin adıdır); atıf bağlantının dışında kalır ve kısaltılmaz (lisans gizlenmez).
 * Kazanılmış mühür fotoğrafın köşesinde küçük bir işarettir; kazanılmamış eserde kilit ya da olumsuz durum gösterilmez.
 * `priority`: ilk kartın fotoğrafı (sayfanın en büyük görünür öğesi) hemen ve öncelikli yüklenir; diğerleri tarayıcının
 * tembel yüklemesiyle (görünür alandakiler yine hemen gelir; telefonda görünmeyenler ilk fotoğrafla bant genişliği paylaşmaz).
 */
export function MonumentCard({ m, seal, priority = false }: { m: MonumentSummary; seal?: SealStatus; priority?: boolean }) {
  const { t, lang } = useLang()
  const lead = textIn(m.lead, m.lead_en, lang)
  const name = nameOf(m, lang)
  // R6.13 ölçümü: tarayıcının yerleşik tembel yüklemesi telefonda birkaç ekran ilerideki kartları da hemen indiriyor ve ilk
  // kartın fotoğrafıyla (LCP) bant genişliği paylaşıyordu. Kart fotoğrafı görünür alana 300 px kala istenir (tek seferlik
  // gözlemci; sürekli döngü yok). Çerçevenin oranı sabit olduğu için fotoğraf gelince sayfa kaymaz.
  const frame = useRef<HTMLDivElement>(null)
  const near = useNear(frame, '300px 0px') || priority
  return (
    <article className="vk-ccard">
      <div className="vk-ccard__frame" ref={frame}>
        {m.cover && near
          ? <img src={mediaUrl(m.cover.file)} alt="" width={900} height={600} loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'low'} decoding="async" />
          : !m.cover && <div className="vk-ccard__noimg" />}
        {seal && (
          <span className={`vk-ccard__seal vk-ccard__seal--${seal}`} title={t(SEAL_LABEL[seal])}>
            <span aria-hidden="true" className="vk-ccard__seal-dot" />
            <span className="vk-sr-only">{t(SEAL_LABEL[seal])}</span>
          </span>
        )}
      </div>
      <div className="vk-ccard__body">
        <p className="vk-ccard__type">{[typeLabel(m.type), m.district].filter(Boolean).join(', ')}</p>
        <h3 className="vk-ccard__name">
          <Link to={`/eser/${encodeURIComponent(m.monument_id)}`} className="vk-ccard__link">{name}</Link>
        </h3>
        {lead.text && <p className="vk-ccard__lead" lang={lead.turkishOnly ? 'tr' : undefined}>{lead.text}</p>}
        <p className="vk-ccard__go" aria-hidden="true">
          {t('Eseri Keşfet')}
          <svg viewBox="0 0 20 12" width="20" height="12" focusable="false"><path d="M1 6h17M13 1l5 5-5 5" /></svg>
        </p>
      </div>
      {m.cover?.attribution && <p className="vk-ccard__credit">{creditIn(m.cover.attribution, lang)}</p>}
    </article>
  )
}
