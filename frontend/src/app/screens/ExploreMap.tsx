import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MonumentSummary } from '../../catalog/types'
import { mediaUrl, typeLabel, type MonumentStatus } from '../api'
import { useGuide } from '../components/GuideWidget'
import { PageState } from '../components/PageState'
import type { MapPoint } from '../components/RouteMap'
import { creditIn, nameOf } from '../contentLang'
import { useLang } from '../i18n'
import { useVisitPlan } from '../visitPlan'
import './explore-map.css'

const RouteMap = lazy(() => import('../components/RouteMap'))

/**
 * R4 keşif haritası (`/harita`, `/harita?eser=<kimlik>`): yayımlanmış bütün eserler renkli işaretlerle; oyun kilidi yok
 * (yalnızca kazanılmış mühür görünür). Bir eser seçilince adı, görseli ve eser sayfası bağlantısı panelde açılır.
 * "Ziyaret rotam": ziyaretçinin kendi seçtiği eserler, kendi sırasıyla (`visitPlan.ts`); oyun rotasından bağımsızdır.
 * Konum istenmez; mesafe ve süre gösterilmez (yürüyüş yolu verisi yok). Haritaya erişemeyenler için aynı seçim listeden
 * de yapılır ("Haritadaki eserler").
 */
export function ExploreMap({ shown, all, status, focusId, onFocusChange }: {
  /** Arama ve filtrelerden geçen eserler (haritada gösterilir). */
  shown: MonumentSummary[]
  /** Bütün katalog (plandaki eser filtre dışında kalsa da plan ve haritada durur). */
  all: MonumentSummary[]
  status: Record<string, MonumentStatus | undefined>
  /** Adresteki `?eser=`: seçili ve odaklanılan eser. */
  focusId: string | null
  onFocusChange: (id: string | null) => void
}) {
  const { t, lang } = useLang()
  const { plan, add, remove, move, reset } = useVisitPlan()
  const [announce, setAnnounce] = useState('')
  const cardHeading = useRef<HTMLHeadingElement>(null)
  const planHeading = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const focusCard = useRef(false)
  const cardId = useId()
  const planId = useId()

  const byId = new Map(all.map((m) => [m.monument_id, m]))
  const selected = focusId ? byId.get(focusId) : undefined
  // R6.10: rehber haritada seçili eserin kaynaklarıyla cevaplar; seçim kalkınca (ya da sayfadan çıkınca) genel sohbete döner.
  const guide = useGuide()
  const pick = selected ? { monument_id: selected.monument_id, name: selected.name, name_en: selected.name_en } : null
  const pickKey = pick ? `${pick.monument_id}|${pick.name}|${pick.name_en ?? ''}` : ''
  useEffect(() => {
    guide.setTopic(pick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey, guide])
  useEffect(() => () => guide.setTopic(null), [guide])
  const stops = plan.map((id) => byId.get(id)).filter((m): m is MonumentSummary => !!m)
  const order = new Map(stops.map((m, i) => [m.monument_id, i + 1]))
  const name = (m: MonumentSummary) => nameOf(m, lang)

  // Harita: filtreden geçenler + plandaki eserler (filtre dışında kalsalar da rota görünür kalır).
  const onMap = [...shown, ...stops.filter((m) => !shown.includes(m))].filter((m) => m.location)
  const points: MapPoint[] = onMap.map((m) => {
    const n = order.get(m.monument_id)
    return {
      id: m.monument_id, name: name(m), lat: m.location!.latitude, lng: m.location!.longitude, status: status[m.monument_id],
      planned: n, label: n ? t('{name}, rotanda {n}. durak', { name: name(m), n }) : name(m),
    }
  })
  const path = stops.filter((m) => m.location).map((m) => [m.location!.latitude, m.location!.longitude] as [number, number])

  function select(id: string, fromUser = true) {
    focusCard.current = fromUser
    onFocusChange(id)
  }
  // Haritadan ya da listeden seçilince odak eser kartına geçer (ekran okuyucu adı duyar); adresten gelişte odak çalınmaz.
  useEffect(() => {
    if (focusCard.current && selected) cardHeading.current?.focus()
    focusCard.current = false
  }, [selected])

  // Plan değişince odak: taşınan durağın aynı düğmesi (sınırdaysa diğeri), çıkarılan durağın yerine gelen, ya da başlık.
  useEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    const el = key === 'heading' ? planHeading.current : document.querySelector<HTMLButtonElement>(`[data-plan-btn="${key}"]`)
    if (el instanceof HTMLButtonElement && el.disabled) {
      const [id, dir] = key.split('|')
      document.querySelector<HTMLButtonElement>(`[data-plan-btn="${id}|${dir === 'up' ? 'down' : 'up'}"]`)?.focus()
    } else el?.focus()
  }, [plan])

  const toggle = (m: MonumentSummary) => {
    if (order.has(m.monument_id)) {
      remove(m.monument_id)
      setAnnounce(t('{name} rotandan çıkarıldı.', { name: name(m) }))
    } else {
      add(m.monument_id)
      setAnnounce(t('{name} rotana eklendi ({n}. durak).', { name: name(m), n: stops.length + 1 }))
    }
  }
  const moveStop = (m: MonumentSummary, delta: -1 | 1) => {
    const n = order.get(m.monument_id)!
    pendingFocus.current = `${m.monument_id}|${delta < 0 ? 'up' : 'down'}`
    move(m.monument_id, delta)
    setAnnounce(t('{name} artık {n}. durak.', { name: name(m), n: n + delta }))
  }
  const removeStop = (m: MonumentSummary) => {
    const i = stops.indexOf(m)
    const after = stops[i + 1] ?? stops[i - 1]
    pendingFocus.current = after ? `${after.monument_id}|remove` : 'heading'
    remove(m.monument_id)
    setAnnounce(t('{name} rotandan çıkarıldı.', { name: name(m) }))
  }
  const resetPlan = () => {
    pendingFocus.current = 'heading'
    reset()
    setAnnounce(t('Rota sıfırlandı.'))
  }

  return (
    <div className="vk-xmap">
      <div className="vk-xmap__stage">
        {points.length === 0 ? (
          <PageState kind="empty" title={t('Haritada gösterilecek konumlu eser yok.')}>
            {t('Konumu onaylanan eserler haritada görünür.')}
          </PageState>
        ) : (
          <Suspense fallback={<PageState kind="loading" title={t('Harita yükleniyor…')} />}>
            <RouteMap points={points} path={path} selectedId={selected?.monument_id ?? null} focusId={selected?.location ? selected.monument_id : null}
              onSelect={(id) => select(id)} className="vk-xmap__map" />
          </Suspense>
        )}
        <ul className="vk-xmap__legend" aria-label={t('Harita açıklaması')}>
          <li><span className="vk-xmap__key vk-xmap__key--plain" aria-hidden="true" />{t('Eser')}</li>
          <li><span className="vk-xmap__key vk-xmap__key--planned" aria-hidden="true">1</span>{t('Rotandaki sıra')}</li>
          <li><span className="vk-xmap__key vk-xmap__key--seal" aria-hidden="true">✓</span>{t('Kazanılmış mühür')}</li>
        </ul>
      </div>

      <div className="vk-xmap__side">
        {selected ? (
          <section className="vk-xmap__card" aria-labelledby={cardId}>
            {selected.cover && (
              <figure className="vk-xmap__photo">
                <img src={mediaUrl(selected.cover.file)} alt={t('{name} görünümü', { name: name(selected) })} loading="lazy" decoding="async" width={640} height={427} />
                {selected.cover.attribution && <figcaption>{creditIn(selected.cover.attribution, lang)}</figcaption>}
              </figure>
            )}
            <p className="vk-xmap__eyebrow">{typeLabel(selected.type)} · {selected.district ? `${selected.district}, ` : ''}{selected.city}</p>
            <h2 id={cardId} ref={cardHeading} tabIndex={-1}>{name(selected)}</h2>
            {!selected.location && <p className="vk-xmap__note">{t('Bu eserin konumu haritada gösterilmiyor.')}</p>}
            <div className="vk-xmap__actions">
              <Link to={`/eser/${encodeURIComponent(selected.monument_id)}`} className="vk-btn">{t('Eseri aç')}</Link>
              {selected.location && (
                <button type="button" className="vk-btn vk-btn--ghost" onClick={() => toggle(selected)}>
                  {order.has(selected.monument_id) ? t('Rotadan çıkar') : t('Rotaya ekle')}
                </button>
              )}
              <button type="button" className="vk-link-btn" onClick={() => onFocusChange(null)}>{t('Seçimi kapat')}</button>
            </div>
          </section>
        ) : (
          <p className="vk-xmap__hint">{t('Haritada bir esere dokun ya da aşağıdaki listeden seç: adı, görseli ve hikâyesinin bağlantısı burada açılır.')}</p>
        )}

        <section className="vk-plan" aria-labelledby={planId}>
          <h2 id={planId} ref={planHeading} tabIndex={-1}>{t('Ziyaret rotam')}</h2>
          <p className="vk-plan__lead">{t('Gezmek istediğin eserleri seç, sırayı sen belirle. Oyun rotasından ve mühürlerden bağımsızdır; kilit yoktur.')}</p>
          {stops.length === 0 ? (
            <p className="vk-plan__empty">{t('Henüz eser seçmedin. Bir eser seçip “Rotaya ekle”ye dokun.')}</p>
          ) : (
            <>
              <ol className="vk-plan__list" aria-label={t('Ziyaret sırası')}>
                {stops.map((m, i) => (
                  <li key={m.monument_id} className="vk-plan__stop">
                    <span className="vk-plan__n" aria-hidden="true">{i + 1}</span>
                    <span className="vk-plan__body">
                      <Link to={`/eser/${encodeURIComponent(m.monument_id)}`} className="vk-plan__name">{name(m)}</Link>
                      <span className="vk-plan__meta">{typeLabel(m.type)} · {m.city}</span>
                    </span>
                    <span className="vk-plan__btns">
                      <button type="button" className="vk-plan__btn" data-plan-btn={`${m.monument_id}|up`} disabled={i === 0}
                        aria-label={t('{name}: bir öne al', { name: name(m) })} onClick={() => moveStop(m, -1)}>↑</button>
                      <button type="button" className="vk-plan__btn" data-plan-btn={`${m.monument_id}|down`} disabled={i === stops.length - 1}
                        aria-label={t('{name}: bir arkaya al', { name: name(m) })} onClick={() => moveStop(m, 1)}>↓</button>
                      <button type="button" className="vk-plan__btn" data-plan-btn={`${m.monument_id}|remove`}
                        aria-label={t('{name}: rotadan çıkar', { name: name(m) })} onClick={() => removeStop(m)}>×</button>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="vk-plan__note">{t('Mesafe ve yürüme süresi gösterilmez; haritadaki kesikli çizgi yalnızca sırayı gösterir, yol tarifi değildir.')}</p>
              <button type="button" className="vk-btn vk-btn--ghost vk-plan__reset" onClick={resetPlan}>{t('Rotayı sıfırla')}</button>
            </>
          )}
        </section>

        <details className="vk-xmap__list">
          <summary>{t('Haritadaki eserler ({n})', { n: onMap.length })}</summary>
          <ul>
            {onMap.map((m) => (
              <li key={m.monument_id}>
                <button type="button" className="vk-xmap__pick" aria-current={m.monument_id === selected?.monument_id ? 'true' : undefined}
                  onClick={() => select(m.monument_id)}>
                  {order.has(m.monument_id) && <span className="vk-plan__n" aria-hidden="true">{order.get(m.monument_id)}</span>}
                  {name(m)}
                  {order.has(m.monument_id) && <span className="vk-sr-only">{t(' (rotanda {n}. durak)', { n: order.get(m.monument_id)! })}</span>}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div role="status" className="vk-sr-only">{announce}</div>
    </div>
  )
}
