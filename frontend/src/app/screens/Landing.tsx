import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { citySlug, getMonuments, useLoad } from '../api'
import { CITIES, withCatalog } from '../cities'
import { MonumentCard } from '../components/MonumentCard'
import { GoldRule, Ornament } from '../components/Ornament'
import { Seal } from '../components/Seal'
import { VakfiyePuzzle, type PieceState } from '../components/VakfiyePuzzle'
import { startGuest } from '../session'
import './discover.css'
import './landing.css'

const BASE = import.meta.env.BASE_URL
const HERO_VIDEO = `${BASE}media/hero.mp4`
const GUIDE_VIDEO = `${BASE}media/narrator-guide.mp4`
// Tanıtımdaki örnek yapboz: birkaç parça bulunmuş, biri ziyaretle altın.
const SAMPLE: PieceState[] = ['found', 'gold', 'missing', 'found', 'missing', 'missing', 'found', 'missing', 'missing', 'missing']
const SAMPLE_LABELS = SAMPLE.map((_, i) => `Örnek parça ${i + 1}`)

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Bölümler ekrana girerken yavaşça belirir; hareket azaltılmışsa ya da tarayıcı desteklemiyorsa hemen görünür. */
function useReveal(key: unknown) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Sonradan gelen bölümler (katalogdan eserler) de gözlenir: anahtar değişince henüz görünmeyenler yeniden bağlanır.
    const items = root.current?.querySelectorAll<HTMLElement>('.vk-reveal:not(.is-in)') ?? []
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      items.forEach((el) => el.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))),
      { threshold: 0.15 },
    )
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [key])
  return root
}

/**
 * Tanıtım (açılış animasyonundan sonra): ürünün ne olduğu ilk ekranda anlaşılır, nasıl oynandığı üç adımda görülür;
 * giriş yapmaya ya da üye olmadan göz atmaya çağırır. Uzun metin yok (CLAUDE.md §2.1). Videolar sessizdir; hareket
 * azaltılmışsa oynatılmaz.
 */
export default function Landing() {
  const navigate = useNavigate()
  const reduced = prefersReducedMotion()
  const [heroVideo, setHeroVideo] = useState(true)
  const [guideVideo, setGuideVideo] = useState(true)
  const catalog = useLoad((s) => getMonuments(s), [])
  const all = catalog.data?.monuments ?? []
  const featured = all.filter((m) => m.cover).slice(0, 3)
  const cities = withCatalog(CITIES, catalog.data ? all.map((m) => m.city) : null, citySlug)
  const open = cities.filter((c) => c.open).map((c) => c.name)
  const soon = cities.filter((c) => !c.open).map((c) => c.name)
  const root = useReveal(featured.length)

  const guest = () => {
    startGuest()
    navigate('/sehir')
  }
  const ctas = (
    <div className="vk-land__ctas">
      <Link to="/giris" className="vk-btn">Keşfe başla</Link>
      <button type="button" className="vk-btn vk-btn--ghost" onClick={guest}>Üye olmadan göz at</button>
    </div>
  )

  return (
    <div className="vk-land" ref={root}>
      <header className="vk-land__bar">
        <span className="vk-land__mark">VAKIFNAME</span>
        <Link to="/giris" className="vk-land__login">Giriş yap</Link>
      </header>

      <main>
        <section className="vk-land__hero" aria-labelledby="land-h">
          {heroVideo && (
            <video
              className="vk-land__video"
              src={reduced ? `${HERO_VIDEO}#t=6` : HERO_VIDEO}
              autoPlay={!reduced}
              muted
              loop
              playsInline
              preload={reduced ? 'metadata' : 'auto'}
              aria-hidden="true"
              onError={() => setHeroVideo(false)}
            />
          )}
          <div className="vk-land__veil" aria-hidden="true" />
          <Ornament className="vk-land__ornament" />
          <div className="vk-land__hero-body">
            <p className="vk-land__eyebrow">Vakıf Eserleri Envanter Projesi</p>
            <h1 id="land-h" className="vk-land__title">Vakıf eserlerini yerinde keşfet</h1>
            <GoldRule className="vk-land__rule" />
            <p className="vk-land__lead">
              Rehberin eserin hikâyesini anlatır; sen dinler, sorar, bilgini sınarsın. Eserin önüne gittiğinde mührün altına döner.
            </p>
            {ctas}
            <p className="vk-land__fine">Ücretsiz · Her bilgi kaynağıyla</p>
          </div>
          <a href="#nasil" className="vk-land__scroll" aria-label="Nasıl çalıştığını gör">
            <span aria-hidden="true">⌄</span>
          </a>
        </section>

        <section id="nasil" className="vk-land__section" aria-labelledby="nasil-h">
          <h2 id="nasil-h" className="vk-land__h2 vk-reveal">Üç adımda bir eser</h2>
          <ol className="vk-land__steps">
            <li className="vk-land__step vk-reveal">
              <div className="vk-land__visual vk-land__guide">
                {guideVideo ? (
                  <video
                    src={reduced ? `${GUIDE_VIDEO}#t=2` : GUIDE_VIDEO}
                    autoPlay={!reduced}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                    onError={() => setGuideVideo(false)}
                  />
                ) : (
                  <span className="vk-land__guide-fallback" aria-hidden="true">Rehber</span>
                )}
              </div>
              <span className="vk-land__num" aria-hidden="true">I</span>
              <h3>Dinle ve sor</h3>
              <p>Rehber eserin hikâyesini sesli ve altyazılı anlatır. Aklına takılanı ona sorarsın.</p>
            </li>
            <li className="vk-land__step vk-reveal">
              <div className="vk-land__visual">
                <Seal kind="knowledge" label="Bilgi mührü" size={112} />
              </div>
              <span className="vk-land__num" aria-hidden="true">II</span>
              <h3>Bilgini sına</h3>
              <p>Beş kısa soru. Dördünü bilirsen bilgi mührü senin.</p>
            </li>
            <li className="vk-land__step vk-reveal">
              <div className="vk-land__visual">
                <Seal kind="gold" label="Altın mühür" size={112} />
              </div>
              <span className="vk-land__num" aria-hidden="true">III</span>
              <h3>Eseri ziyaret et</h3>
              <p>Eserin önüne gittiğinde mührün altına dönüşür.</p>
            </li>
          </ol>
        </section>

        <section className="vk-land__section vk-land__vakfiye" aria-labelledby="vakfiye-h">
          <div className="vk-land__vakfiye-art vk-reveal">
            <VakfiyePuzzle pieces={SAMPLE} labels={SAMPLE_LABELS} />
          </div>
          <div className="vk-land__vakfiye-text vk-reveal">
            <p className="vk-land__eyebrow">Kayıp Vakfiye</p>
            <h2 id="vakfiye-h" className="vk-land__h2">Her mühür, kayıp bir vakfiyenin bir parçası</h2>
            <p>Bir şehrin eserlerini tamamladıkça parçalar yerine oturur. Ziyaret ettiğin eserin parçası altınla parlar.</p>
          </div>
        </section>

        {featured.length > 0 && (
          <section className="vk-land__section" aria-labelledby="eserler-h">
            <h2 id="eserler-h" className="vk-land__h2 vk-reveal">Seni bekleyen eserler</h2>
            <div className="vk-grid vk-land__grid vk-reveal">
              {featured.map((m) => (
                <MonumentCard key={m.monument_id} m={m} />
              ))}
            </div>
          </section>
        )}

        <section className="vk-land__section" aria-labelledby="guven-h">
          <h2 id="guven-h" className="vk-land__h2 vk-reveal">Güvenilir bilgi, saygılı bir dil</h2>
          <ul className="vk-land__trust vk-reveal">
            <li>
              <h3>Kaynaklı</h3>
              <p>Her bilgi, envanter yayınındaki sayfasıyla birlikte gösterilir.</p>
            </li>
            <li>
              <h3>Dürüst</h3>
              <p>Rivayet ve kesin olmayan bilgi öyle söylenir; bilinmeyen uydurulmaz.</p>
            </li>
            <li>
              <h3>Vakur</h3>
              <p>İbadet mekânlarında ziyaret adabı her adımda hatırlatılır.</p>
            </li>
          </ul>
          {open.length > 0 && (
            <p className="vk-land__cities vk-reveal">
              {open.join(', ')} ile başladık{soon.length > 0 ? `; ${soon.join(', ')} yolda.` : '.'}
            </p>
          )}
        </section>

        <section className="vk-land__final" aria-labelledby="son-h">
          <h2 id="son-h" className="vk-land__h2">İlk mührün seni bekliyor</h2>
          {ctas}
        </section>
      </main>

      <footer className="vk-land__foot">
        <Link to="/gizlilik">Aydınlatma metni</Link>
      </footer>
    </div>
  )
}
