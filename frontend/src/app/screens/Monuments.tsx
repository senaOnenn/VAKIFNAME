import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { accountId, citySlug, getMonuments, getRoute, statusMap, typeLabel, useLoad } from '../api'
import { MapIcon } from '../components/Icons'
import { MonumentCard } from '../components/MonumentCard'
import { sealOnly } from '../components/StatusBadge'
import { PageState } from '../components/PageState'
import { nameOf } from '../contentLang'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import { ExploreMap } from './ExploreMap'
import './discover.css'
import './explore.css'
import './collection.css'

/** Arama için sadeleştirme: Türkçe küçük harf, ı→i, aksan/şapka ve çengeller düşer ("CAMİ", "camı", "Câmi" → "cami"). */
const fold = (s: string) =>
  s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** Eser adı (ve onaylı alternatif adları) sorgudaki bütün kelimeleri içeriyor mu? Boş sorgu her eseri geçirir. */
function nameMatches(names: string[], query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = names.map(fold).join(' ')
  return words.every((w) => hay.includes(w))
}

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />
  </svg>
)

/** Liste görünümü simgesi (süs; düğmenin adı metindir). */
const ListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
    <rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
)

/** Keşfet (`/eserler`, liste) ve Harita (`/harita`): sergi karşılaması, şehir ve türe göre filtre, kazanılmış mühür
 * rozetleri. Görünüm adresten gelir; böylece ana menüde ayrı bölümlerdir ve tarayıcının geri tuşu görünümler arasında
 * çalışır. R2: dijital müze düzeni (büyük fotoğraflı editoryal kartlar); stiller `explore.css`. */
export default function Monuments() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { t, lang } = useLang()
  const catalog = useLoad((s) => getMonuments(s), [])
  // R6.2: kazanılmış mühürler yalnızca hesapla gösterilir; misafir ilerleme isteği göndermez.
  const uid = accountId(auth)
  const [query, setQuery] = useState('')
  const searchId = useId()
  const typesId = useId()
  const view: 'liste' | 'harita' = useLocation().pathname === '/harita' ? 'harita' : 'liste'
  const setView = (v: 'liste' | 'harita') => navigate(v === 'harita' ? '/harita' : '/eserler')
  // R4: `/harita?eser=<kimlik>` seçili ve odaklanılan eser (eser sayfasındaki "Haritada gör"); seçim adrese yazılır.
  const [params, setParams] = useSearchParams()
  // R6.11: eser sayfasındaki koleksiyon yolu (`?sehir=Bursa&tur=cami`) filtreyi hazır açar; sonra filtre sayfada değişir.
  const [type, setType] = useState(() => (view === 'liste' && params.get('tur')) || '')
  const [city, setCity] = useState(() => (view === 'liste' && params.get('sehir')) || '')
  const urlType = view === 'liste' ? params.get('tur') ?? '' : null
  const urlCity = view === 'liste' ? params.get('sehir') ?? '' : null
  useEffect(() => {
    if (urlType !== null) setType(urlType)
    if (urlCity !== null) setCity(urlCity)
  }, [urlType, urlCity])
  const focusId = view === 'harita' ? params.get('eser') : null
  const setFocus = (id: string | null) => setParams(id ? { eser: id } : {}, { replace: true })

  const all = catalog.data?.monuments ?? []
  // Mühür durumları her şehrin kendi rotasından gelir; bir rota yüklenemezse o şehrin eserleri yine listelenir. Rotadaki
  // kilit/açık durumu bu ekranda gösterilmez (R1): bütün eserler renkli ve keşfedilebilir; yalnızca kazanılmış mühür görünür.
  const slugs = [...new Set(all.map((m) => citySlug(m.city)))].sort().join(',')
  const routes = useLoad(
    (s) => Promise.all((slugs && uid ? slugs.split(',') : []).map((c) => getRoute(c, uid!, null, s).catch(() => null))),
    [uid, slugs],
  )
  const status = Object.assign({}, ...(routes.data ?? []).map(statusMap)) as ReturnType<typeof statusMap>
  const types = useMemo(() => [...new Set(all.map((m) => m.type))].sort((a, b) => a.localeCompare(b, 'tr')), [all])
  const cities = useMemo(() => [...new Set(all.map((m) => m.city))], [all])
  // Arama, şehir ve tür filtreleriyle birlikte çalışır (hepsi aynı anda); liste ve harita aynı süzülmüş kümeyi gösterir.
  const shown = all.filter((m) => (!type || m.type === type) && (!city || citySlug(m.city) === city)
    && nameMatches([m.name, nameOf(m, lang), ...(m.alternative_names ?? [])], query))
  // Filtre temizleme, "Tümü" ve "Tüm şehirler" seçimleriyle aynı durumu kurar (arama da boşalır); odak sayaç satırına
  // geçer ki klavye kullanıcısı kaybolan düğmeyle birlikte sayfanın başına düşmesin.
  const countRef = useRef<HTMLParagraphElement>(null)
  const clearFilters = () => {
    setType('')
    setCity('')
    setQuery('')
    countRef.current?.focus()
  }

  const towns = [...new Set(all.map((m) => m.city))]
  // R6.13 koleksiyon girişi: şehir katalogdan gelir (tek şehir varsa adı, yoksa yalnızca "Vakıf mirası"; CLAUDE.md §1).
  const place = towns.length === 1 ? towns[0] : null
  const cityName = cities.find((c) => citySlug(c) === city)
  const active = [
    ...(cityName ? [cityName] : []),
    ...(type ? [typeLabel(type)] : []),
    ...(query.trim() ? [`“${query.trim()}”`] : []),
  ]
  // Arka plan (yalnızca geniş ekranda, CSS medya sorgusuyla indirilir): ana sayfanın mevcut, optimize avlu illüstrasyonu.
  const backdrop = { ['--vk-coll-bg' as string]: `url("${import.meta.env.BASE_URL}media/sahne/scene-5-1280.webp?v=${__MEDIA_VERSION__}")` }

  return (
    <main className={`vk-explore vk-coll${view === 'harita' ? ' vk-coll--map' : ''}`} style={backdrop}>
      <header className="vk-coll__head">
        <p className="vk-coll__eyebrow">{place ? `${place} / ${t('Vakıf mirası')}` : t('Vakıf mirası')}</p>
        <h1>{view === 'harita' ? t('Eser haritası') : t('Eserlerin İzinde')}</h1>
        <p className="vk-coll__lead">{t('Vakıf mirasını keşfet. Her eser, geçmişten bugüne uzanan ayrı bir hikâye taşır.')}</p>
        {/* Satırın yeri baştan ayrılır: katalog gelince altındaki çubuk ve kartlar kaymaz (CLS). */}
        <p className="vk-coll__meta">
          {catalog.data && all.length > 0 ? `${t('{n} eser', { n: all.length })}, ${t('{n} şehir', { n: towns.length })}` : ' '}
        </p>
      </header>

      {/* Tek keşif çubuğu: arama (öncelikli), şehir, eser türü ve görünüm (Liste | Harita). Süzme anında olur (sayfa
          yenilenmez); seçili filtreler altta özetlenir ve tek düğmeyle temizlenir. */}
      <div className="vk-coll__bar" role="search" aria-label={t('Eserleri ara ve süz')}>
        <div className="vk-coll__search">
          <label htmlFor={searchId} className="vk-sr-only">{t('Eser ara')}</label>
          <SearchIcon />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Eser adı yaz, ör. Ulu Cami')}
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
          />
        </div>
        <label className="vk-coll__city">
          <span className="vk-sr-only">{t('Şehir')}</span>
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">{t('Tüm şehirler')}</option>
            {cities.map((c) => (
              <option key={c} value={citySlug(c)}>{c}</option>
            ))}
          </select>
        </label>
        <div className="vk-coll__types" role="group" aria-labelledby={typesId}>
          <span className="vk-sr-only" id={typesId}>{t('Eser türü')}</span>
          {['', ...types].map((ty) => (
            <button key={ty || 'tumu'} type="button" className="vk-coll__chip" aria-pressed={type === ty} onClick={() => setType(ty)}>
              {ty ? typeLabel(ty) : t('Tümü')}
            </button>
          ))}
        </div>
        <div className="vk-coll__view" role="group" aria-label={t('Görünüm')}>
          {(['liste', 'harita'] as const).map((v) => (
            <button key={v} type="button" className="vk-coll__chip vk-coll__chip--view" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'liste' ? <ListIcon /> : <MapIcon />}
              <span className="vk-coll__vlabel">{v === 'liste' ? t('Liste') : t('Harita')}</span>
            </button>
          ))}
        </div>
      </div>

      {catalog.loading && <PageState kind="loading" title={t('Eserler yükleniyor…')} />}
      {catalog.error && (
        <PageState kind="error" title={t('Eserler yüklenemedi:')} action={{ label: t('Tekrar dene'), onClick: catalog.reload }}>
          {catalog.error}
        </PageState>
      )}
      {catalog.data && all.length === 0 && (
        <PageState kind="empty" title={t('Katalogda henüz yayımlanmış eser yok.')}>
          {t('Eserler onaylandıkça burada görünecek.')}
        </PageState>
      )}
      {catalog.data && all.length > 0 && (
        <>
          <h2 className="vk-sr-only">{t('Eser listesi')}</h2>
          <div className="vk-coll__status">
            <p className="vk-page__count" aria-live="polite" ref={countRef} tabIndex={-1}>
              {t('{n} eser', { n: shown.length })}
              {active.length > 0 && <span className="vk-coll__active">{active.join(', ')}</span>}
            </p>
            {active.length > 0 && shown.length > 0 && <button type="button" className="vk-link-btn vk-coll__clear" onClick={clearFilters}>{t('Filtreleri temizle')}</button>}
          </div>
          {shown.length === 0 ? (
            query.trim() ? (
              <PageState kind="filtered-empty" title={t('“{q}” ile eşleşen eser bulunamadı.', { q: query.trim() })} action={{ label: t('Filtreleri temizle'), onClick: clearFilters }}>
                {t('Yazımı kontrol edebilir, eserin adından bir kelime deneyebilir ya da arama ve filtreleri temizleyebilirsin.')}
              </PageState>
            ) : (
              <PageState kind="filtered-empty" title={t('Seçilen filtrelerle eşleşen eser yok.')} action={{ label: t('Filtreleri temizle'), onClick: clearFilters }}>
                {t('Başka bir şehir ya da tür seçebilir veya filtreleri temizleyebilirsin.')}
              </PageState>
            )
          ) : view === 'liste' ? (
            <div className="vk-coll__grid">
              {shown.map((m, i) => (
                <MonumentCard key={m.monument_id} m={m} seal={sealOnly(status[m.monument_id])} priority={i === 0} />
              ))}
            </div>
          ) : (
            <ExploreMap
              shown={shown}
              all={all}
              status={Object.fromEntries(all.map((m) => [m.monument_id, sealOnly(status[m.monument_id])]))}
              focusId={focusId}
              onFocusChange={setFocus}
            />
          )}
        </>
      )}
    </main>
  )
}
