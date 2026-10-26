import { useEffect, useState } from 'react'
import { getSeals, PROGRESS_EVENT } from '../catalog/catalogClient'
import { useApi } from '../hooks/useApi'
import { getVisitorId } from '../visitor'
import { ScrollIcon } from './Icons'
import { Seal } from './Seal'

/**
 * Ana sayfanın "Bursa'nın Kayıp Vakfiyesi" bölümü: oyunun KURGUSAL çerçeve hikâyesi. Tarihî bir belge, olay veya gerçek
 * bir vakfiye anlatmaz; gerçek eserler hakkındaki bilgiler yalnızca onaylı katalogda yer alır.
 */
export function StorySection() {
  return (
    <section id="hikaye" className="section story" aria-labelledby="hikaye-title">
      <div className="container story__inner">
        <div>
          <p className="story__eyebrow">
            <ScrollIcon className="story__icon" /> Oyunun hikâyesi
          </p>
          <h2 id="hikaye-title" className="section__title">
            Bursa’nın Kayıp Vakfiyesi
          </h2>
        </div>
        <div className="story__body">
          <p>
            Bir vakfiyenin sayfaları şehrin dört bir yanına dağılmış. Her sayfa, bir eserin önünde çözülmeyi bekleyen
            bir ipucuna dönüşmüş. Sen bir iz sürücüsün: eserleri keşfedecek, kaynaklarını okuyacak ve görevi açılan her
            eserde pasaportuna bir mühür ekleyerek vakfiyeyi yeniden bir araya getireceksin.
          </p>
          <p className="story__note">
            Bu, oyunun kurgusal hikâyesidir; tarihî bir belgeyi veya olayı anlatmaz. Gerçek eserlerle ilgili bilgiler
            yalnızca kaynağı ve editör onayı olan katalog kayıtlarında gösterilir. Görevler, eserin konumu ve güvenli
            giriş noktası onaylandıkça açılır.
          </p>
          <div className="story__actions">
            <a className="button button--primary" href="#katalog">
              Eserlerle başla
            </a>
            <a className="button button--secondary" href="#katalog-harita">
              Haritaya bak
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeStyle: 'short' })

function formatDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFormat.format(d)
}

/**
 * Ana sayfanın "Dijital Miras Pasaportu" bölümü (`/users/{id}/seals`). İki mühür türü ayrı gösterilir:
 * bilgi mührü (keşif soruları, uzaktan) ve ziyaret mührü (yalnızca GPS check-in onaylı eserde, yerinde). Demo mühürleri
 * burada görünmez. Pasaport keşif sorusu çözüldüğünde kendiliğinden yenilenir.
 */
export function PassportIntro() {
  const [visitorId] = useState(getVisitorId)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    window.addEventListener(PROGRESS_EVENT, bump)
    return () => window.removeEventListener(PROGRESS_EVENT, bump)
  }, [])
  const seals = useApi((signal) => getSeals(visitorId, signal), `seals:${visitorId}:${version}`)
  return (
    <section id="pasaport-tanitim" className="section section--alt" aria-labelledby="pasaport-tanitim-title">
      <div className="container">
        <div className="passport passport--intro">
          <header className="passport__header">
            <Seal className="passport__emblem" />
            <div>
              <p className="passport__brand">VAKIFNAME</p>
              <h2 id="pasaport-tanitim-title" className="passport__title">
                Dijital Miras Pasaportu
              </h2>
            </div>
          </header>
          <p>
            Bir eserin bütün keşif sorularını çözdüğünde <strong>bilgi mührü</strong> pasaportuna eklenir. Konumu ve
            güvenli giriş noktası sahada onaylanan eserlerde yerinde check-in yaparak ayrıca <strong>ziyaret mührü</strong>{' '}
            kazanırsın. Mühürler yalnızca sunucu doğrularsa verilir ve aynı mühür iki kez eklenmez.
          </p>
          {seals.status === 'loading' && <p role="status">Pasaport yükleniyor…</p>}
          {seals.status === 'error' && (
            <p role="alert" className="passport__note">
              Pasaport şu anda yüklenemedi.
            </p>
          )}
          {seals.status === 'success' && (
            <>
              <div className="seal-columns">
                <div>
                  <h3>Bilgi mühürleri ({seals.data.knowledge_seals.length})</h3>
                  {seals.data.knowledge_seals.length === 0 ? (
                    <p className="passport__note" role="status">
                      Henüz bilgi mührü yok. Bir eserin hikâyesini oku ve keşif sorularını çöz.
                    </p>
                  ) : (
                    <ul className="seal-list" aria-label="Bilgi mühürleri">
                      {seals.data.knowledge_seals.map((s) => (
                        <li key={s.monument_id}>
                          <Seal className="passport__stamp-seal" /> {s.monument_name} · {formatDate(s.earned_at)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3>Ziyaret mühürleri ({seals.data.visit_seals.length})</h3>
                  {seals.data.visit_seals.length === 0 ? (
                    <p className="passport__note" role="status">
                      {seals.data.monuments.some((m) => m.checkin_available)
                        ? 'Henüz ziyaret mührü yok. GPS noktası onaylı bir eseri yerinde ziyaret et.'
                        : 'Ziyaret mühürleri, eserlerin güvenli giriş noktası sahada doğrulandıkça açılacak.'}
                    </p>
                  ) : (
                    <ul className="seal-list" aria-label="Ziyaret mühürleri">
                      {seals.data.visit_seals.map((s) => (
                        <li key={s.monument_id}>
                          <Seal className="passport__stamp-seal" /> {s.monument_name} · {formatDate(s.earned_at)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {seals.data.monuments.some((m) => m.quests > 0) && (
                <>
                  <h3>Görev ilerlemesi</h3>
                  <ul className="seal-progress" aria-label="Eserlere göre görev ilerlemesi">
                    {seals.data.monuments
                      .filter((m) => m.quests > 0)
                      .map((m) => (
                        <li key={m.monument_id}>
                          <span>{m.name}</span>
                          <span>
                            {m.solved}/{m.quests}
                          </span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </>
          )}
          <p className="passport__note">
            Pasaport bu tarayıcıya özel, rastgele bir ziyaretçi kimliğiyle sunucuda kalıcı olarak tutulur; hesap değildir ve
            kişisel bilgi içermez.
          </p>
        </div>
      </div>
    </section>
  )
}
