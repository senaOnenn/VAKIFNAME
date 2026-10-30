import { Link } from 'react-router-dom'
import { mediaUrl, typeLabel, type MonumentStatus, type MonumentSummary } from '../api'
import { StatusBadge } from './StatusBadge'
import { creditIn, nameOf, textIn } from '../contentLang'
import { useLang } from '../i18n'

/** Eser kartı: kapak görseli (atıf satırıyla), tür, ad, kısa giriş ve oyun durumu. Tümü eser sayfasına bağlanır. */
export function MonumentCard({ m, status }: { m: MonumentSummary; status?: MonumentStatus }) {
  const { lang } = useLang()
  const lead = textIn(m.lead, m.lead_en, lang)
  return (
    <article className={`vk-mcard${status === 'locked' ? ' vk-mcard--locked' : ''}`}>
      <Link to={`/eser/${encodeURIComponent(m.monument_id)}`} className="vk-mcard__link">
        <div className="vk-mcard__media">
          {m.cover ? <img src={mediaUrl(m.cover.file)} alt="" loading="lazy" /> : <div className="vk-mcard__noimg" />}
          <StatusBadge status={status} />
        </div>
        <div className="vk-mcard__body">
          <span className="vk-mcard__type">{typeLabel(m.type)} · {m.district}</span>
          <h3 className="vk-mcard__name">{nameOf(m, lang)}</h3>
          {lead.text && <p className="vk-mcard__lead" lang={lead.turkishOnly ? 'tr' : undefined}>{lead.text}</p>}
        </div>
      </Link>
      {m.cover?.attribution && <p className="vk-mcard__credit">{creditIn(m.cover.attribution, lang)}</p>}
    </article>
  )
}
