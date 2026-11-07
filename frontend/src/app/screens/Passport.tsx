import { Link } from 'react-router-dom'
import { citySlug, getMonuments, getSealBook, getVakfiyeLayout, progressId, useLoad, type PlayerProfile } from '../api'
import { characterOf } from '../characters'
import { KasifPortrait } from '../components/KasifPortrait'
import { VakfiyePuzzle } from '../components/VakfiyePuzzle'
import { nameOf } from '../contentLang'
import { gamePath, lastGameCity } from '../gameCity'
import { getLang, useLang } from '../i18n'
import { loadPlayerProfile, STAGE_LABEL } from '../player'
import { useAuth } from '../session'
import { vakfiyeBoard } from '../vakfiye'
import '../components/game-parts.css'
import '../game-layout.css'
import './passport.css'

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short' })

/** Kompakt kâşif künyesi (başlık satırında): portre, ad, aşama, seviye ve ince XP çubuğu. Değerler sunucudan gelir. */
function CrestLine({ profile }: { profile: PlayerProfile }) {
  const { t } = useLang()
  const hero = characterOf(profile.character?.id)
  const p = profile.progress
  if (!hero) return null
  const span = p.next_level_xp !== null ? p.next_level_xp - p.level_xp : 0
  const into = p.xp - p.level_xp
  return (
    <section className="vk-book2__crest" aria-label={t('Kâşifin')} data-stage={p.stage}>
      <span className="vk-book2__portrait"><KasifPortrait id={hero.id} stage={p.stage} crop="bust" /></span>
      <span className="vk-book2__who">
        <span className="vk-book2__name">{t(hero.name)}</span>
        <span className="vk-book2__stage">{t(STAGE_LABEL[p.stage])}</span>
      </span>
      <span className="vk-book2__lv">
        <span>{t('Seviye {n}', { n: p.level })}</span>
        <span className="vk-book2__xp">{p.next_level_xp !== null ? t('{xp} / {next} XP', { xp: p.xp, next: p.next_level_xp }) : t('{xp} XP · en üst seviye', { xp: p.xp })}</span>
        {p.next_level_xp !== null && (
          <progress className="vk-book2__meter" max={span} value={into}
            aria-label={t('Seviye {n} için ilerleme: {have} / {need} XP', { n: p.level + 1, have: into, need: span })} />
        )}
      </span>
    </section>
  )
}

/**
 * Mühür Defteri (R6.16): masaüstünde tek ekranlık, açılmış bir koleksiyon defteri. Başlık satırında kâşif künyesi; tek
 * parşömen yaprakta solda Kayıp Vakfiye (R6.9 sabit yuvaları; Vakfiye Odası ile aynı `vakfiyeBoard`), sağda 10 eserin
 * mühür kaydı (her satırda bilgi ve altın mühür ayrı işaretli). Sayılar yapbozun altında bir kez yazılır (tekrar yok).
 * Telefonda sırayla: künye, yapboz, mühürler. Veriler hesabındır (sunucu); istemci hesaplamaz.
 */
export default function Passport() {
  const auth = useAuth()
  const { t, lang } = useLang()
  const uid = progressId(auth)
  const catalog = useLoad((s) => getMonuments(s), [])
  const book = useLoad((s) => getSealBook(uid, s), [uid])
  const profile = useLoad((s) => loadPlayerProfile(s), [uid])
  const located = (catalog.data?.monuments ?? []).filter((m) => m.location)
  const remembered = lastGameCity()
  const city = located.some((m) => citySlug(m.city) === remembered) ? remembered! : (located[0] ? citySlug(located[0].city) : '')
  // Yerleşim yalnızca bu şehir için yüklendiğinde kullanılır (iki ekran geçici olarak farklı sıra göstermesin).
  const layout = useLoad((s) => (city ? getVakfiyeLayout(city, s).then((slots) => ({ city, slots }), () => ({ city, slots: null })) : Promise.resolve(null)), [city])
  const layoutReady = !!city && layout.data?.city === city

  if (catalog.loading || book.loading || (catalog.data && !layoutReady && city)) return <main className="vk-book2"><p className="vk-page__state" role="status">{t('Mühür Defteri yükleniyor…')}</p></main>
  if (catalog.error || book.error || !catalog.data || !book.data)
    return (
      <main className="vk-book2">
        <p className="vk-page__state vk-page__state--error" role="alert">
          {t('Mühür Defteri yüklenemedi.')}{' '}
          <button type="button" className="vk-link-btn" onClick={() => (catalog.reload(), book.reload())}>{t('Tekrar dene')}</button>
        </p>
      </main>
    )

  const knowledge = new Map(book.data.knowledge_seals.map((s) => [s.monument_id, s]))
  const visit = new Map(book.data.visit_seals.map((s) => [s.monument_id, s]))
  // R6.9: Vakfiye Odası ile aynı vakfiye: oyun şehrinin konumlu (rotadaki) eserleri, tek ve sabit yuva yerleşimi.
  const board = vakfiyeBoard(layout.data?.slots, located.filter((m) => citySlug(m.city) === city), new Set(knowledge.keys()), new Set(visit.keys()))
  const monuments = board.monuments
  const pieces = board.states
  const found = pieces.filter((p) => p !== 'missing').length
  const gold = pieces.filter((p) => p === 'gold').length
  const total = monuments.length
  const p = profile.data?.profile
  const status = found === total
    ? gold === total
      ? t('Altın Vakfiye! Bütün eserleri ziyaret ettin.')
      : t('Kayıp Vakfiye bulundu! Eserleri ziyaret ettikçe parçalar altınlaşır.')
    : gold
      ? t('{total} parçadan {found} parça bulundu, {gold} parça altın.', { total, found, gold })
      : t('{total} parçadan {found} parça bulundu.', { total, found })

  return (
    <main className="vk-book2">
      <header className="vk-book2__head">
        <h1>{t('Mühür Defteri')}</h1>
        {p?.character && <CrestLine profile={p} />}
      </header>

      <article className="vk-folio vk-book2__folio">
        <section className="vk-book2__vakfiye" aria-labelledby="vakfiye-b">
          <h2 id="vakfiye-b" className="vk-book2__h">{t('Kayıp Vakfiye')}</h2>
          <VakfiyePuzzle pieces={pieces} labels={monuments.map((m) => nameOf(m, lang))} />
          <p className="vk-book2__count">{status}</p>
        </section>

        <section className="vk-book2__seals" aria-labelledby="muhurler">
          <div className="vk-book2__seals-head">
            <h2 id="muhurler" className="vk-book2__h">{t('Mühürler')}</h2>
            <p className="vk-book2__legend" aria-hidden="true">
              <span><i className="vk-sealmark vk-sealmark--knowledge is-on" />{t('Bilgi mührü')}</span>
              <span><i className="vk-sealmark vk-sealmark--gold is-on" />{t('Altın mühür')}</span>
            </p>
          </div>
          <ul className="vk-book2__list">
            {monuments.map((m) => {
              const k = knowledge.get(m.monument_id)
              const v = visit.get(m.monument_id)
              const kind = v ? 'gold' : k ? 'knowledge' : 'empty'
              const meta = v
                ? t('Altın · ziyaret {date}', { date: date(v.earned_at) }) + (v.simulated ? ' ' + t('(simülasyon)') : '')
                : k ? t('Bilgi mührü · {date}', { date: date(k.earned_at) }) : t('Henüz yok')
              return (
                <li key={m.monument_id} data-seal-row className={`vk-book2__row vk-book2__row--${kind}`}>
                  <span className="vk-book2__marks">
                    <i className={`vk-sealmark vk-sealmark--knowledge${k || v ? ' is-on' : ''}`} role="img"
                      aria-label={k || v ? t('Bilgi mührü kazanıldı') : t('Bilgi mührü yok')} />
                    <i className={`vk-sealmark vk-sealmark--gold${v ? ' is-on' : ''}`} role="img"
                      aria-label={v ? t('Altın mühür kazanıldı') : t('Altın mühür yok')} />
                  </span>
                  <Link to={gamePath.monument(m.monument_id)} className="vk-book2__mname">{nameOf(m, lang)}</Link>
                  <span className="vk-book2__meta">{meta}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <p className="vk-book2__rule">{t('Her bilgi mührü vakfiyeye bir parça getirir; eseri yerinde ziyaret edince mühür ve parça altınlaşır.')}</p>
      </article>
    </main>
  )
}
