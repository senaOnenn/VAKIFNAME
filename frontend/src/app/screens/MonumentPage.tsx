import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { accountId, citySlug, getGame, getLocalPhotos, getMonument, getPeople, getRoute, localMediaUrl, mediaUrl, statusMap, useLoad } from '../api'
import { ExhibitDialog } from '../components/ExhibitDialog'
import { useGuide } from '../components/GuideWidget'
import { HistoryBook } from '../components/HistoryBook'
import { ExhibitHero, ExhibitHighlights, ExhibitRecord, highlightFacts, leadFact, sourceIndex } from '../components/MonumentDetail'
import { PhotoArchive, type ArchivePhoto } from '../components/PhotoArchive'
import { VisitPlanner } from '../components/VisitPlanner'
import { gamePath } from '../gameCity'
import { sealOnly, StatusBadge } from '../components/StatusBadge'
import { creditIn, nameOf, textIn } from '../contentLang'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import './discover.css'
import './monument.css'
import './monument-layout.css'
import './monument-exhibit.css'

/**
 * Eser sayfası (R6.11): bütün eserler için TEK sergi şablonu (components/MonumentDetail.tsx). İlk ekranda eserin adı,
 * kaynaklı kısa girişi, temel bilgileri, ziyaret notu, bilgi görevi ve harita; yanında kemerli nişte iki arşiv nesnesi
 * (Tarih Defteri, Fotoğraf Arşivi) üst katmanda açılan pencerelere girer. Altta öne çıkan 2–3 kayıt ve duvar etiketi
 * (ziyaret, ayrıntılı künye, kaynak yayın). Büyük kapak fotoğrafı yoktur. Rehber site genelindeki sağ alt düğmededir.
 */
export default function MonumentPage() {
  const { id = '' } = useParams()
  const auth = useAuth()
  // R6.2: mühür durumu ve oyun bağlantısı yalnızca hesapla; misafir ilerleme isteği göndermez.
  const uid = accountId(auth)
  const { t, lang } = useLang()
  const m = useLoad((s) => getMonument(id, s), [id])
  const city = m.data ? citySlug(m.data.city) : ''
  const route = useLoad((s) => (city && uid ? getRoute(city, uid, null, s).catch(() => null) : Promise.resolve(null)), [city, uid])
  const status = statusMap(route.data)[id]
  // Oyun durumu (Faz 5). Uç yoksa veya hata verirse görev çağrısı gösterilmez; eser bilgisi yine okunur.
  const game = useLoad((s) => (uid ? getGame(id, uid, s) : Promise.resolve(null)), [id, uid])
  // Tarihî kişiler (bâni, burada yatan, yeniden yaptıran): onaylı kayda bağlı eşleme. Yüklenemezse gösterilmez.
  const people = useLoad((s) => getPeople(id, s).catch(() => []), [id])
  const hlId = useId()
  const recId = useId()
  const visitId = useId()
  const bookH = useId()
  const photosH = useId()
  // Aynı anda tek pencere: Tarih Defteri ya da Fotoğraf Arşivi (rehber paneli de kapanır). Odak açan nesneye döner.
  const [dlg, setDlg] = useState<'book' | 'photos' | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const bookBtn = useRef<HTMLButtonElement>(null)
  const photosBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => setDlg(null), [id])
  // R6.15.2: yerel önizleme fotoğrafları yalnızca Fotoğraf Arşivi ilk açıldığında istenir (ilk sayfa yüklemesine girmez);
  // canlı sunucuda uç yoktur (404) ve liste boş kalır.
  const [wantLocal, setWantLocal] = useState(false)
  useEffect(() => setWantLocal(false), [id])
  useEffect(() => {
    if (dlg === 'photos') setWantLocal(true)
  }, [dlg])
  const local = useLoad((s) => (wantLocal ? getLocalPhotos(id, s) : Promise.resolve(null)), [id, wantLocal])
  const guide = useGuide()
  const loaded = m.data
  useEffect(() => {
    if (loaded) guide.setMonument({ monument_id: loaded.monument_id, name: loaded.name, name_en: loaded.name_en, facts: loaded.facts })
    return () => guide.setMonument(null)
  }, [loaded, guide])
  const show = (which: 'book' | 'photos') => (e?: MouseEvent<HTMLElement>) => {
    opener.current = e?.currentTarget ?? (which === 'book' ? bookBtn.current : photosBtn.current)
    guide.close()
    setDlg(which)
  }
  const close = () => setDlg(null)

  if (m.loading) return <main className="vk-page"><p className="vk-page__state" role="status">{t('Eser yükleniyor…')}</p></main>
  if (m.error || !m.data)
    return (
      <main className="vk-page">
        <p className="vk-page__state vk-page__state--error" role="alert">{t('Eser bulunamadı veya yüklenemedi.')}</p>
        <Link to="/eserler" className="vk-btn vk-btn--ghost">← {t('Eserlere dön')}</Link>
      </main>
    )

  const d = m.data
  const name = nameOf(d, lang)
  const notice = d.site_notice ? textIn(d.site_notice, d.site_notice_en, lang) : null
  const factById = new Map(d.facts.map((f) => [f.fact_id, f]))
  const peopleIn = (people.data ?? []).map((p) => ({ ...p, fact: factById.get(p.fact_id) }))
  const lead = leadFact(d.facts)
  const { titles, ref, numbered } = sourceIndex(d.facts)
  const sourceRef = (f: Parameters<typeof ref>[0]) => ref(f, lang)
  const highlights = highlightFacts(d.facts, new Set([lead?.fact_id ?? '', ...peopleIn.map((p) => p.fact_id)]))
  // Fotoğraf Arşivi (R3.8): yalnızca katalogdaki onaylı görseller ve kayıtlı bilgileri; büyük görünüm özgün dosya,
  // dizilimde kart dosyası. Atıf satırındaki Türkçe etiketler İngilizcede çevrilir; ad, lisans ve kaynak aynen kalır.
  const archive: ArchivePhoto[] = d.images.map((img, i) => ({
    key: img.image_id,
    src: mediaUrl(img.file),
    thumbSrc: mediaUrl(img.card_file || img.file),
    width: img.width ?? null,
    height: img.height ?? null,
    alt: t('{name}, görsel {n}', { name, n: i + 1 }),
    title: img.title ?? null,
    rightsHolder: img.rights_holder || null,
    attribution: img.attribution ? creditIn(img.attribution, lang) : null,
    license: img.license || null,
    licenseUrl: img.license_url ?? null,
    sourceLabel: img.source_label ?? null,
    sourceUrl: img.source_url ?? null,
  }))
  // Yerel önizleme: lisanslı fotoğrafların ardından, kaynağı karonun altında; yayın izni ayrı satırda (atıf ≠ izin).
  const permission = t('Doğrulanmadı; yalnızca yerel önizleme, kamuya açık değil')
  const localPhotos: ArchivePhoto[] = (local.data?.images ?? []).map((p, i) => ({
    key: p.image_id,
    src: localMediaUrl(p.file),
    thumbSrc: localMediaUrl(p.card_file),
    width: p.width,
    height: p.height,
    alt: t('{name}, envanter fotoğrafı {n}', { name, n: i + 1 }),
    // Görüntüleyicide tam kaynak: yayın, cilt, PDF sayfası ve (doğrulandıysa) basılı sayfa. Karonun altında kısa kaynak.
    sourceLabel: [
      p.source,
      ...(p.pdf_page ? [t('PDF s. {n}', { n: p.pdf_page })] : []),
      ...(p.printed_pages?.length ? [t('basılı s. {n}', { n: p.printed_pages.join('–') })] : []),
    ].join(', '),
    caption: t('Kaynak: {source}', { source: p.source }),
    permission,
  }))
  // Nişteki önizleme: eserin kendi katalog kapağı (ilk onaylı fotoğraf), kart boyutunda; atfı altında.
  const cover = d.images[0]
  const preview = cover ? {
    src: mediaUrl(cover.card_file || cover.file),
    alt: t('{name}, Fotoğraf Arşivi önizlemesi', { name }),
    credit: cover.attribution ? creditIn(cover.attribution, lang) : (cover.rights_holder || null),
  } : null
  const quest = game.data || auth.status === 'none' || auth.status === 'guest' ? gamePath.monument(id) : null

  return (
    <main className="vk-mon vk-exhpage">
      <ExhibitHero monument={d} name={name} lead={lead} sourceRef={sourceRef} people={peopleIn}
        seal={<StatusBadge status={sealOnly(status)} />} notice={notice} quest={quest}
        onOpenBook={show('book')} onOpenPhotos={show('photos')} bookRef={bookBtn} photosRef={photosBtn}
        photo={preview} photoCount={d.images.length} openDialog={dlg} />

      <div className="vk-exhpage__rest">
        <ExhibitHighlights facts={highlights} total={d.facts.length} sourceRef={sourceRef} onOpenBook={show('book')} headingId={hlId} />
        <div className="vk-label vk-exh-label">
          <section className="vk-exh-visit" aria-labelledby={visitId}>
            <h2 id={visitId} className="vk-sr-only">{t('Ziyaret')}</h2>
            <VisitPlanner monument={{ ...d, name }} mapLink={false} />
          </section>
          <ExhibitRecord monument={d} people={peopleIn} sourceRef={sourceRef} titles={titles} numbered={numbered} headingId={recId} />
        </div>
      </div>

      <ExhibitDialog open={dlg === 'book'} onClose={close} labelledBy={bookH} className="vk-bookdlg" returnFocus={opener}>
        <div className="vk-bookdlg__inner">
          <h2 id={bookH} className="vk-sr-only">{t('Tarih Defteri')}</h2>
          <HistoryBook key={`${id}-${lang}`} facts={d.facts} monumentName={name} headingId={bookH} startOpen onClose={close} />
        </div>
      </ExhibitDialog>
      <ExhibitDialog open={dlg === 'photos'} onClose={close} labelledBy={photosH} className="vk-photodlg" returnFocus={opener}>
        <div className="vk-photodlg__inner">
          <div className="vk-photodlg__bar">
            <p id={photosH} className="vk-photodlg__title">{name}</p>
            <button type="button" className="vk-photodlg__close" onClick={close}>{t('Arşivi kapat')}</button>
          </div>
          <PhotoArchive photos={[...archive, ...localPhotos]} monumentName={name} publishedCount={archive.length} />
        </div>
      </ExhibitDialog>
    </main>
  )
}
