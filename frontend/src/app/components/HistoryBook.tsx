import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { MonumentFact } from '../api'
import { factIn } from '../contentLang'
import { useLang } from '../i18n'
import { sourceRef } from '../sourceRef'
import './history-book.css'

/** Doğrulanmamış içerik kesin bilgi gibi sunulmaz (şartname 5.1.3): kesinlik her kayıtta görünür. */
const CERTAINTY: Record<string, string> = {
  documented: 'Kaynaklarda belgelenmiş',
  reported: 'Aktarılan bilgi (rivayet)',
  uncertain: 'Kesin değil',
}

/** Şemse: badem biçimli orta madalyon, içinde sekiz köşeli yıldız (Osmanlı cilt bezemesi). Süstür. */
export function Semse() {
  return (
    <svg className="vk-book__semse" viewBox="0 -12 120 204" aria-hidden="true" focusable="false">
      <path d="M60 4 C96 40 112 70 112 90 C112 110 96 140 60 176 C24 140 8 110 8 90 C8 70 24 40 60 4 Z" />
      <path className="vk-book__semse-in" d="M60 22 C88 50 100 74 100 90 C100 106 88 130 60 158 C32 130 20 106 20 90 C20 74 32 50 60 22 Z" />
      <g transform="translate(60 90)">
        <rect x="-20" y="-20" width="40" height="40" />
        <rect x="-20" y="-20" width="40" height="40" transform="rotate(45)" />
        <circle r="8" />
      </g>
      <path className="vk-book__semse-tip" d="M60 4 V-10 M60 176 V190" />
    </svg>
  )
}

/** Köşebent: köşe bezemesi (çeyrek madalyon). `pos` köşeyi seçer; süstür. */
function Kosebent({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <svg className={`vk-book__kose vk-book__kose--${pos}`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M0 0 H44 C40 18 18 40 0 44 Z" />
      <path className="vk-book__kose-in" d="M0 0 H30 C27 13 13 27 0 30 Z" />
    </svg>
  )
}

/**
 * R3.4 / R3.5 "Tarih Defteri": eserin onaylı tarihî kayıtları, Osmanlı cilt ve yazma geleneğinden esinlenen bir arşiv
 * defterinde. Kapalıyken şemse ve köşebentli, miklepli bir cilt (kayıt sayfaları hiç oluşturulmaz). Açıkken iki sayfa:
 * sol sayfada kaydın başlığı ve metni (cetvel içinde), sağ sayfada ketebe kaydı gibi ortalanmış künye (Kaynak, Yayın),
 * mühür biçiminde kesinlik ve yazmalardaki reklam kelimesi geleneğiyle sonraki kaydın adı. Metinler ve kayıt sırası
 * katalogdan olduğu gibi gelir; kaynak parçaları yalnızca katalog alanlarından ayrılır (`sourceRef`). Doğrulama
 * bağlantıları (ör. Kültür Portalı) veride kalır, defterde gösterilmez.
 */
export function HistoryBook({ facts, monumentName, headingId, startOpen = false, onClose }: {
  facts: MonumentFact[]; monumentName: string; headingId: string
  /** R3.7: eser sayfasının sahnesinde defter doğrudan açık başlar (kapak yan şeritte durur); odak ilk kayda geçer. */
  startOpen?: boolean
  /** R3.7: "Defteri kapat" sahneyi kapatır (verilmezse defter kapağına döner). */
  onClose?: () => void
}) {
  const { t, lang } = useLang()
  const id = useId()
  const [open, setOpen] = useState(startOpen)
  const [index, setIndex] = useState(0)
  const [turn, setTurn] = useState<'open' | 'next' | 'prev' | null>(startOpen ? 'open' : null)
  const openBtn = useRef<HTMLButtonElement>(null)
  const recordHeading = useRef<HTMLHeadingElement>(null)
  const prevBtn = useRef<HTMLButtonElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)
  const focusAfter = useRef<'record' | 'open' | 'prev' | 'next' | null>(startOpen ? 'record' : null)
  const n = facts.length

  useEffect(() => {
    const target = focusAfter.current
    focusAfter.current = null
    if (target === 'record') recordHeading.current?.focus()
    if (target === 'open') openBtn.current?.focus()
    // Sınıra gelince basılan düğme devre dışı kalır: odak kaybolmasın, diğer yön düğmesine geçsin.
    if (target === 'next') (nextBtn.current?.disabled ? prevBtn.current : nextBtn.current)?.focus()
    if (target === 'prev') (prevBtn.current?.disabled ? nextBtn.current : prevBtn.current)?.focus()
  }, [open, index])

  if (n === 0) return null

  const go = (i: number, dir: 'next' | 'prev') => {
    if (i < 0 || i >= n || i === index) {
      focusAfter.current = null
      return
    }
    setTurn(dir)
    setIndex(i)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Dizin ve bağlantılar kendi tuşlarını kullanır; "Sonraki/Önceki" düğmesine tıkladıktan sonra da yön tuşları çalışır.
    if ((e.target as HTMLElement).closest('details, a, input, textarea, select')) return
    // Sayfa yeniden oluşturulur: klavye odağı yeni kaydın başlığına geçer (kaybolmaz, sonraki tuş da çalışır).
    focusAfter.current = 'record'
    if (e.key === 'ArrowRight') go(index + 1, 'next')
    else if (e.key === 'ArrowLeft') go(index - 1, 'prev')
    else if (e.key === 'Home') go(0, 'prev')
    else if (e.key === 'End') go(n - 1, 'next')
    else {
      focusAfter.current = null
      return
    }
    e.preventDefault()
  }

  if (!open) {
    return (
      <div className="vk-book vk-book--closed">
        <button ref={openBtn} type="button" className="vk-book__cover" aria-expanded={false} aria-controls={`${id}-book`}
          aria-label={t('Tarih Defterini aç')} aria-describedby={`${id}-cover`}
          onClick={() => { focusAfter.current = 'record'; setTurn('open'); setOpen(true) }}>
          <span className="vk-book__board">
            <Kosebent pos="tl" /><Kosebent pos="tr" /><Kosebent pos="bl" /><Kosebent pos="br" />
            <Semse />
            <span className="vk-book__cover-text" id={`${id}-cover`}>
              <span className="vk-book__cover-title">{t('Tarih Defteri')}</span>
              <span className="vk-book__cover-name">{monumentName}</span>
              <span className="vk-book__cover-count">{t('{n} onaylı tarihî kayıt', { n })}</span>
            </span>
            <span className="vk-book__miklep" aria-hidden="true" />
          </span>
          <span className="vk-book__cover-cta" aria-hidden="true">{t('Tarih Defterini aç')}</span>
        </button>
      </div>
    )
  }

  const f = facts[index]
  const c = factIn(f, lang)
  const src = sourceRef(f.source?.title, c.page, lang)
  const cert = CERTAINTY[f.certainty] ? t(CERTAINTY[f.certainty]) : f.certainty
  const vol = src.volume ? `${t('Cilt')} ${src.volume}${src.edition ? ` (${src.edition})` : ''}` : null
  const page = src.page != null ? t('s. {page}', { page: src.page }) : null
  const nextFact = index < n - 1 ? factIn(facts[index + 1], lang) : null

  return (
    <div id={`${id}-book`} className="vk-book vk-book--open" role="group" aria-roledescription={t('defter')}
      aria-labelledby={headingId} onKeyDown={onKey}>
      <div className="vk-book__tools">
        <button type="button" className="vk-link-btn" onClick={() => {
          if (onClose) return onClose()
          focusAfter.current = 'open'
          setOpen(false)
        }}>
          {t('Defteri kapat')}
        </button>
      </div>

      <div className="vk-book__volume">
        <div key={f.fact_id} className={`vk-book__spread${turn ? ` vk-book__spread--${turn}` : ''}`}>
          <article className="vk-book__page vk-book__page--verso" aria-labelledby={`${id}-rec`}>
            <p className="vk-book__running" aria-hidden="true">{t('Tarih Defteri')}</p>
            <div className="vk-book__cetvel">
              <p className="vk-book__folio" aria-live="polite">{t('Kayıt {i} / {n}', { i: index + 1, n })}</p>
              <h3 id={`${id}-rec`} ref={recordHeading} tabIndex={-1} lang={c.turkishOnly ? 'tr' : undefined}>{c.title}</h3>
              <p className="vk-book__text" lang={c.turkishOnly ? 'tr' : undefined}>{c.text}</p>
              {c.turkishOnly && <p className="vk-book__tr">{t('Bu bilginin onaylı İngilizcesi henüz yok; kaynaktaki Türkçesi gösteriliyor.')}</p>}
            </div>
          </article>
          <aside className="vk-book__page vk-book__page--recto" aria-label={t('Kaynak bilgisi')}>
            <p className="vk-book__running" aria-hidden="true">{monumentName}</p>
            <div className="vk-book__cetvel vk-book__cetvel--kunye">
              <p className="vk-book__kunye-title">{t('Künye')}</p>
              <dl className="vk-book__ref">
                <div>
                  <dt>{t('Kaynak')}</dt>
                  <dd>{src.name ?? <span className="vk-book__missing">{t('Kaynak adı kayıtta yok')}</span>}</dd>
                </div>
                <div>
                  <dt>{t('Yayın')}</dt>
                  <dd>
                    {vol ?? <span className="vk-book__missing">{t('Cilt bilgisi kayıtta yok')}</span>}
                    {', '}
                    {page ?? <span className="vk-book__missing">{t('sayfa bilgisi kayıtta yok')}</span>}
                  </dd>
                </div>
                <div className="vk-book__seal-row">
                  <dt>{t('Kesinlik')}</dt>
                  <dd><span className={`vk-book__seal vk-book__seal--${f.certainty}`}>{cert}</span></dd>
                </div>
              </dl>
              {/* Reklam kelimesi: yazmalarda sayfa altına sonraki sayfanın ilk sözü yazılır; burada sonraki kaydın adı. */}
              <p className="vk-book__catchword" lang={nextFact?.turkishOnly ? 'tr' : undefined}>
                {nextFact ? t('Sonraki kayıt: {title}', { title: nextFact.title }) : t('Defterin son kaydı')}
              </p>
            </div>
          </aside>
        </div>
      </div>

      <div className="vk-book__nav">
        <button ref={prevBtn} type="button" className="vk-book__turn vk-book__turn--prev" disabled={index === 0}
          onClick={() => { focusAfter.current = 'prev'; go(index - 1, 'prev') }}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3 5 8l5 5" /></svg>
          {t('Önceki kayıt')}
        </button>
        <span className="vk-book__pos" aria-hidden="true">{index + 1} / {n}</span>
        <button ref={nextBtn} type="button" className="vk-book__turn vk-book__turn--next" disabled={index === n - 1}
          onClick={() => { focusAfter.current = 'next'; go(index + 1, 'next') }}>
          {t('Sonraki kayıt')}
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5" /></svg>
        </button>
      </div>

      <details className="vk-book__index">
        <summary>{t('Bütün kayıtlar ({n})', { n })}</summary>
        <ol>
          {facts.map((x, i) => {
            const xc = factIn(x, lang)
            return (
              <li key={x.fact_id}>
                <button type="button" className="vk-book__jump" aria-current={i === index ? 'true' : undefined}
                  onClick={() => {
                    if (i === index) return recordHeading.current?.focus()
                    focusAfter.current = 'record'
                    go(i, i > index ? 'next' : 'prev')
                  }}>
                  <span className="vk-book__jump-title" lang={xc.turkishOnly ? 'tr' : undefined}>{xc.title}</span>
                  <span className="vk-book__jump-leader" aria-hidden="true" />
                  <span className="vk-book__jump-n">{i + 1}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </details>
    </div>
  )
}
