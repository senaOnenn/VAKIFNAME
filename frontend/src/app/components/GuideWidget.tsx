import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { accountId, sendEngagement, type MonumentDetail } from '../api'
import { nameOf } from '../contentLang'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import guidePortrait from '../../assets/guide/rehber-osmanli-320.webp'
import { GuideDrawer } from './GuideDrawer'
// R6.12: panelin içeriği (anlatım, ses, dudak senkronu, sohbet, fotoğraf) ilk açılışta yüklenir; ana sayfanın ilk
// paketine girmez. Düğme ve panel çerçevesi hemen hazırdır.
const Narrator = lazy(() => import('./Narrator').then((m) => ({ default: m.Narrator })))
const GuideChat = lazy(() => import('./Narrator').then((m) => ({ default: m.GuideChat })))
type GuideRequest = import('./Narrator').GuideRequest

type GuideMonument = Pick<MonumentDetail, 'monument_id' | 'name' | 'name_en' | 'facts'>
interface GuideApi {
  /** Eser sayfası yüklediği eseri bildirir (ek API çağrısı yok); ayrılırken `null`. */
  setMonument: (m: GuideMonument | null) => void
  /** Başka bir pencere açılırken (ör. Tarih Defteri) rehber paneli kapanır. */
  close: () => void
  /** R6.7: paneli bildirilen eserle açar (görev ekranındaki "Hikâyeyi dinle": `listen`, soru için `ask`). */
  open: (tab?: 'listen' | 'ask') => void
  /** R6.10: haritada seçili eser (`/harita?eser=`); sorular o eserin kaynaklarıyla cevaplanır. Seçim kalkınca `null`. */
  setTopic: (m: GuideTopic | null) => void
  /** R6.14: sayfadan (ana sayfadaki rehber bölümü) soru ya da fotoğraf iletir: panel aynı sayfada açılır, soru panelin
   * sohbetinde bir kez gönderilir. Panel içeriği henüz yüklenmediyse istek bekler, kaybolmaz. */
  ask: (r: { question?: string; photo?: File }) => void
}
type GuideTopic = Pick<MonumentDetail, 'monument_id' | 'name' | 'name_en'>
const GuideContext = createContext<GuideApi>({
  setMonument: () => undefined, close: () => undefined, open: () => undefined, setTopic: () => undefined, ask: () => undefined,
})
export const useGuide = () => useContext(GuideContext)

/**
 * Rehberin görünmediği sayfalar: rehber sayfasının kendisi (aynı sayfada ikinci rehber olmasın), giriş/hesap akışı,
 * yönetim ve "Rozeti Al" soruları (rehber soruların cevabını vermesin; yeni yetki oluşmaz).
 */
const HIDDEN = ['/rehber', '/giris', '/gizlilik', '/dogrula', '/sifre-sifirla', '/sifre-yenile', '/yonetim/*', '/oyun/eser/:id/rozet', '/eser/:id/rozet']

/**
 * R3.11 Site genelinde "Rehbere Sor": uygulamada tek bir kez oluşturulur (yönlendiricinin içinde, sayfaların dışında),
 * böylece sayfalar arasında sohbet korunur ve aynı sayfada ikinci rehber çıkmaz. Sağ alt köşede portre + etiket.
 * - Eser sayfasında: o eserin kimliğiyle kaynaklı sohbet ve ayrı "Anlatım" sekmesi (kendiliğinden konuşmaz); sorular
 *   oyunun "dinle ve sor" adımına sayılır. Eser değişince eser sohbeti sıfırlanır (eski eser bilgisi taşınmaz).
 * - Diğer sayfalarda: bütün onaylı katalog üzerinden genel sohbet (Rehber sayfasıyla aynı kaynaklı hat).
 * Her iki sohbet de ilk açılışta oluşturulur, sonra yalnızca gizlenir. Fotoğraf yalnızca sunucu `photo: true` derse.
 */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [monument, setMonumentState] = useState<GuideMonument | null>(null)
  const [topic, setTopicState] = useState<GuideTopic | null>(null)
  const [open, setOpen] = useState(false)
  const setMonument = useCallback((m: GuideMonument | null) => setMonumentState(m), [])
  const setTopic = useCallback((m: GuideTopic | null) => setTopicState(m), [])
  const close = useCallback(() => setOpen(false), [])
  const [tabRequest, setTabRequest] = useState<{ tab: 'listen' | 'ask'; n: number } | null>(null)
  const openGuide = useCallback((tab: 'listen' | 'ask' = 'ask') => {
    setTabRequest((r) => ({ tab, n: (r?.n ?? 0) + 1 }))
    setOpen(true)
  }, [])
  // R6.14: bekleyen istek (numaralı). Genel sohbet işleyince silinir; aynı numara ikinci kez işlenmez.
  const [request, setRequest] = useState<GuideRequest | null>(null)
  const ask = useCallback((r: { question?: string; photo?: File }) => {
    if (!r.question?.trim() && !r.photo) return
    setRequest((p) => ({ id: (p?.id ?? 0) + 1, question: r.question?.trim(), photo: r.photo }))
    setOpen(true)
  }, [])
  const requestDone = useCallback((id: number) => setRequest((p) => (p && p.id === id ? { id } : p)), [])
  const api = useMemo(() => ({ setMonument, close, open: openGuide, setTopic, ask }), [setMonument, close, openGuide, setTopic, ask])
  return (
    <GuideContext.Provider value={api}>
      {children}
      <GuideWidget monument={monument} topic={topic} open={open} setOpen={setOpen} tabRequest={tabRequest}
        request={request?.question || request?.photo ? request : null} onRequestDone={requestDone} />
    </GuideContext.Provider>
  )
}

function GuideWidget({ monument: reported, topic: reportedTopic, open, setOpen, tabRequest, request, onRequestDone }: {
  request: GuideRequest | null; onRequestDone: (id: number) => void
  monument: GuideMonument | null; topic: GuideTopic | null; open: boolean; setOpen: (v: boolean | ((x: boolean) => boolean)) => void
  tabRequest: { tab: 'listen' | 'ask'; n: number } | null
}) {
  const { t, lang } = useLang()
  const auth = useAuth()
  const { pathname, search } = useLocation()
  const button = useRef<HTMLButtonElement>(null)
  const hidden = HIDDEN.some((p) => matchPath(p, pathname))
  // Eser sayfası ve oyundaki görev ekranı aynı eser bağlamını kullanır (R6.7: anlatım görev ekranında da dinlenir).
  const page = matchPath('/eser/:id', pathname) ?? matchPath('/oyun/eser/:id', pathname)
  // R6.10: bildirilen eser yalnızca adresteki eserle aynıysa kullanılır. Eser A'dan B'ye geçerken B yüklenene dek A'nın
  // bağlamı (ve sohbeti) gösterilmez; o arada genel sohbet açılır.
  const monument = page && reported?.monument_id === page.params.id ? reported : null
  // Harita: seçili eser (adresteki `?eser=` ile aynıysa) o eserin kaynaklarıyla; seçim yoksa genel.
  const mapPick = pathname === '/harita' ? new URLSearchParams(search).get('eser') : null
  const topic = mapPick && reportedTopic?.monument_id === mapPick ? reportedTopic : null
  const active = monument ? 'monument' : topic ? 'topic' : 'general'
  // Sohbetler ilk kez gerektiğinde oluşturulur; eser sohbeti yalnızca son açılan eser için tutulur.
  const [general, setGeneral] = useState(false)
  const [kept, setKept] = useState<GuideMonument | null>(null)
  const [keptTopic, setKeptTopic] = useState<GuideTopic | null>(null)
  useEffect(() => {
    if (!open) return
    if (active === 'general') setGeneral(true)
    else if (active === 'topic' && topic && keptTopic?.monument_id !== topic.monument_id) setKeptTopic(topic)
    else if (monument && kept?.monument_id !== monument.monument_id) setKept(monument)
  }, [open, active, monument, kept, topic, keptTopic])
  // Rehberin görünmediği sayfaya geçilince panel kapanır (sohbet korunur).
  useEffect(() => {
    if (hidden) setOpen(false)
  }, [hidden, setOpen])

  const showMonument = active === 'monument' && kept && kept.monument_id === monument?.monument_id
  const showTopic = active === 'topic' && keptTopic && keptTopic.monument_id === topic?.monument_id
  const close = useCallback(() => setOpen(false), [setOpen])
  const engage = (event: 'listened' | 'asked') => {
    // Oyunun ilk adımı (dinle ve sor) yalnızca hesapla kaydedilir (R6.2); misafirken rehber yine tam çalışır.
    const uid = accountId(auth)
    if (kept && uid) sendEngagement(kept.monument_id, uid, event).catch(() => undefined)
  }
  const subject = active === 'monument' ? monument : active === 'topic' ? topic : null
  const context = subject
    ? t('Yerel rehber, canlandırma. Konu: {name}', { name: nameOf(subject, lang) })
    : t('Yerel rehber, canlandırma. Konu: bütün eserler')

  return (
    <>
      {/* Gizli sayfada yalnızca düğme kalkar; oluşturulmuş sohbetler bellekte kalır (geri dönünce yerinde). */}
      {!hidden && (
        <button ref={button} type="button" className={`vk-guidefab${pathname === '/' ? ' vk-guidefab--home' : ''}`}
          aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {/* Görünür etiket = erişilebilir ad; portre süstür. */}
          <span className="vk-guidefab__label">{t('Rehbere Sor')}</span>
          <img src={guidePortrait} alt="" width={56} height={56} />
        </button>
      )}
      {(general || kept || keptTopic) && (
        <GuideDrawer open={open && !hidden} onClose={close} returnFocus={button} context={context}>
          <Suspense fallback={<p className="vk-drawer__loading" role="status">{t('Rehber hazırlanıyor…')}</p>}>
          {kept && (
            <div hidden={!showMonument} className="vk-drawer__slot">
              <Narrator key={`${kept.monument_id}-${lang}`} monument={kept} initialTab="ask" active={open && !!showMonument} titleHidden
                requestTab={tabRequest}
                onListened={() => engage('listened')} onAsked={() => engage('asked')} />
            </div>
          )}
          {keptTopic && (
            <div hidden={!showTopic} className="vk-drawer__slot vk-drawer__slot--general">
              <GuideChat key={`${keptTopic.monument_id}-${lang}`} monumentId={keptTopic.monument_id} monumentName={nameOf(keptTopic, lang)}
                hideHeading allowPhoto />
            </div>
          )}
          {general && (
            <div hidden={active !== 'general'} className="vk-drawer__slot vk-drawer__slot--general">
              <GuideChat key={lang} monumentId={null} allowPhoto hideHeading placeholder="Örn. Bir külliyede hangi yapılar bulunur?"
                request={request} onRequestDone={onRequestDone} />
            </div>
          )}
          </Suspense>
        </GuideDrawer>
      )}
    </>
  )
}
