import type { PersonCard } from '../api'
import { useLang } from '../i18n'
import './people-cards.css'

const SKIP = new Set(['Sultan', 'Şehzade', 've'])
/** Baş harf madalyonu: unvan ve sıra sayıları atlanır (Sultan II. Murad → M, Yıldırım Bayezid → YB). */
export function monogram(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => !SKIP.has(w) && !/^[IVX]+\.$/.test(w))
    .slice(0, 2)
    .map((w) => w.charAt(0).toLocaleUpperCase('tr'))
    .join('')
}

/**
 * Eserle ilgili tarihî kişiler. Kişi adına konuşulmaz (anlatıcı yerel rehberdir); kart yalnızca onaylı kaydın
 * metnini ve kaynağını gösterir. Fotogerçekçi yüz yerine baş harf madalyonu kullanılır (CLAUDE.md §5).
 */
export function PeopleCards({ people, compact = false }: {
  people: PersonCard[]
  /** R3.12: kısa bâni satırı; metni boş olan kartta yalnızca rol, ad ve kaynak (giriş paragrafı tekrar edilmez). */
  compact?: boolean
}) {
  const { t } = useLang()
  if (!people.length) return null
  return (
    <section className={`vk-people${compact ? ' vk-people--compact' : ''}`} aria-label={t('Eserle ilgili tarihî kişiler')}>
      {people.map((p) => (
        <article key={`${p.role}-${p.fact_id}`} className="vk-person">
          <div className="vk-person__medal" aria-hidden="true">
            <span>{monogram(p.name)}</span>
          </div>
          <div className="vk-person__body">
            <p className="vk-person__role">{t(p.role_label)}</p>
            <h2 className="vk-person__name">{p.name}</h2>
            {p.text && <p className="vk-person__text">{p.text}</p>}
            <p className="vk-person__src">
              {p.certainty !== 'documented' && <span className="vk-cert vk-cert--uncertain">{p.certainty === 'reported' ? t('Rivayet') : t('Kesin değil')}</span>}
              {t('Kaynak:')} {p.source}
            </p>
          </div>
        </article>
      ))}
    </section>
  )
}
