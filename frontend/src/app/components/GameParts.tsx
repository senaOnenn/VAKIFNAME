import { Link } from 'react-router-dom'
import { formatDistance, typeLabel, type PlayerProfile, type RouteResult, type Stage } from '../api'
import { characterOf } from '../characters'
import { nameOf } from '../contentLang'
import { gamePath } from '../gameCity'
import { ledger, type LedgerEntry } from '../gameModel'
import { useLang } from '../i18n'
import { STAGE_LABEL } from '../player'
import { KasifPortrait } from './KasifPortrait'
import { Seal } from './Seal'
import './game-parts.css'

const STAGE_ORDER: Stage[] = ['baslangic', 'gezginlik', 'arastirmaci', 'muhafiz']
/** Aşamanın başladığı seviye (xp.py ile aynı: 1, 3, 5, 7). */
const STAGE_FROM: Record<Stage, number> = { baslangic: 1, gezginlik: 3, arastirmaci: 5, muhafiz: 7 }

/**
 * Kâşif künyesi (R6.5): kemer içinde portre, rol adı, seviye, görünüm aşaması, XP ve sonraki aşama. Değerler sunucudan
 * gelir (istemci hesaplamaz). `size="hero"` oyun masasının başında, `profile` hesap sayfasında.
 */
export function PlayerCrest({ profile, size = 'hero', headingLevel = 2 }: {
  profile: PlayerProfile
  size?: 'hero' | 'profile'
  headingLevel?: 2 | 3
}) {
  const { t } = useLang()
  const hero = characterOf(profile.character?.id)
  const p = profile.progress
  if (!hero) return null
  const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(p.stage) + 1]
  const H = headingLevel === 2 ? 'h2' : 'h3'
  const span = p.next_level_xp !== null ? p.next_level_xp - p.level_xp : 0
  const into = p.xp - p.level_xp
  return (
    <section className={`vk-crest vk-crest--${size}`} aria-label={t('Kâşifin')} data-stage={p.stage}>
      <div className="vk-crest__niche">
        <KasifPortrait id={hero.id} stage={p.stage} crop="bust" className="vk-crest__portrait" />
      </div>
      <div className="vk-crest__text">
        <p className="vk-crest__eyebrow">{t('Kâşifin')} · {t(STAGE_LABEL[p.stage])}</p>
        <H className="vk-crest__name">{t(hero.name)}</H>
        <p className="vk-crest__level">
          <span className="vk-crest__lv">{t('Seviye {n}', { n: p.level })}</span>
          <span className="vk-crest__xp">{p.next_level_xp !== null ? t('{xp} / {next} XP', { xp: p.xp, next: p.next_level_xp }) : t('{xp} XP · en üst seviye', { xp: p.xp })}</span>
        </p>
        {p.next_level_xp !== null && (
          <progress className="vk-crest__meter" max={span} value={into}
            aria-label={t('Seviye {n} için ilerleme: {have} / {need} XP', { n: p.level + 1, have: into, need: span })} />
        )}
        <p className="vk-crest__next">
          {nextStage
            ? t('{n}. seviyede yeni görünüm: {stage}', { n: STAGE_FROM[nextStage], stage: t(STAGE_LABEL[nextStage]) })
            : t('Görünümün en üst aşamada: Başkâşif')}
        </p>
      </div>
    </section>
  )
}

const STATE_TEXT: Record<LedgerEntry['state'], string> = {
  new: 'Henüz keşfedilmedi',
  started: 'Göreve başlandı',
  knowledge: 'Bilgi mührü kazanıldı',
  gold: 'Altın mühür kazanıldı',
}

/**
 * Eserler defteri (R6.7): şehrin bütün eserleri, hepsi seçilebilir (kilit yok). Her satır tek bir bağlantıdır ve doğrudan
 * eserin görev ekranına gider; durum hesaba bağlıdır (henüz keşfedilmedi, göreve başlandı, bilgi mührü, altın mühür).
 */
export function RouteLedger({ route, label }: { route: RouteResult; label: string }) {
  const { t, lang } = useLang()
  const entries = ledger(route)
  return (
    <ol className="vk-ledger" aria-label={label}>
      {entries.map((e) => {
        const name = nameOf(e, lang)
        return (
          <li key={e.monument_id} className={`vk-ledger__row vk-ledger__row--${e.state}${e.next ? ' is-next' : ''}`}>
            <Link to={gamePath.monument(e.monument_id)} className="vk-ledger__link">
              <span className="vk-ledger__mark" aria-hidden="true">
                {e.state === 'gold' ? <Seal kind="gold" label="" size={34} />
                  : e.state === 'knowledge' ? <Seal kind="knowledge" label="" size={34} />
                    : <span className="vk-ledger__n">{e.order}</span>}
              </span>
              <span className="vk-ledger__body">
                <span className="vk-ledger__name">{name}</span>
                <span className="vk-ledger__meta">
                  <span className="vk-ledger__status">{t(STATE_TEXT[e.state])}</span>
                  {!e.ready && <> <span aria-hidden="true">·</span> <span className="vk-ledger__soon">{t('görevi hazırlanıyor')}</span></>}
                  {e.next && <> <span aria-hidden="true">·</span> {t('önerilen sıradaki')}</>}
                  {e.type && <> <span aria-hidden="true">·</span> {typeLabel(e.type)}</>}
                  {e.distance_m !== undefined && <> <span aria-hidden="true">·</span> {formatDistance(e.distance_m)}</>}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

/** Mühür defteri özeti: bilgi mührü, altın mühür ve vakfiye parçaları; sayılar sunucudan. */
export function SealTally({ knowledge, gold, total, link = true }: { knowledge: number; gold: number; total: number; link?: boolean }) {
  const { t } = useLang()
  return (
    <div className="vk-tally">
      <dl className="vk-tally__list">
        <div className="vk-tally__item">
          <dt><span aria-hidden="true"><Seal kind="knowledge" label="" size={44} /></span> {t('Bilgi mührü')}</dt>
          <dd><strong>{knowledge}</strong> <span>/ {total}</span></dd>
        </div>
        <div className="vk-tally__item">
          <dt><span aria-hidden="true"><Seal kind="gold" label="" size={44} /></span> {t('Altın mühür')}</dt>
          <dd><strong>{gold}</strong> <span>/ {total}</span></dd>
        </div>
        <div className="vk-tally__item">
          <dt><span className="vk-tally__piece" aria-hidden="true" /> {t('Vakfiye parçası')}</dt>
          <dd><strong>{knowledge}</strong> <span>/ {total}</span></dd>
        </div>
      </dl>
      {link && <Link to="/pasaport" className="vk-tally__link">{t('Mühür Defteri’ni aç')}</Link>}
    </div>
  )
}
