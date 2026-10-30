import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { EN } from './i18n-en'

/**
 * Arayüz dili (Faz 11, karar 15 = C). Türkçe metnin kendisi anahtardır: `t('Eserler')` Türkçede aynen, İngilizcede
 * sözlükteki karşılığıyla döner; karşılığı yoksa Türkçe kalır (geliştirmede bir kez uyarılır). Yer tutucular `{ad}`.
 *
 * İlk dil: kayıtlı seçim (`vakifname.lang`) → tarayıcı dili (`en*` → İngilizce) → Türkçe. Seçim kalıcıdır; `<html lang>`
 * eşlenir. Yönetim ekranları Türkçe kalır. Sunucunun hata metinleri (`detail`) olduğu gibi gösterilir.
 * Tarihî içerik (kayıtlar, anlatım) bu sözlükten değil, onaylı İngilizce alanlardan gelir (makine çevirisi yok).
 */
export type Lang = 'tr' | 'en'

const KEY = 'vakifname.lang'
let current: Lang | null = null
const listeners = new Set<() => void>()
const warned = new Set<string>()

function stored(): Lang | null {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'tr' || v === 'en' ? v : null
  } catch {
    return null
  }
}

function fromBrowser(): Lang {
  if (typeof navigator === 'undefined') return 'tr'
  const list = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const l of list) {
    const code = (l || '').toLowerCase()
    if (code.startsWith('tr')) return 'tr'
    if (code.startsWith('en')) return 'en'
  }
  return 'tr'
}

export function getLang(): Lang {
  if (current === null) current = stored() ?? fromBrowser()
  return current
}

function syncHtml(lang: Lang) {
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

export function setLang(lang: Lang) {
  current = lang
  try {
    window.localStorage.setItem(KEY, lang)
  } catch {
    /* bellek içi kalır */
  }
  syncHtml(lang)
  listeners.forEach((l) => l())
}

/** Testler için: kayıtlı seçimi ve bellekteki dili unutur (tarayıcı diline göre yeniden belirlenir). */
export function resetLangForTests() {
  current = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* yoksay */
  }
  listeners.forEach((l) => l())
}

/** `{ad}` yer tutucusu; `{n|tekil|çoğul}` sayıya göre (n 1 ise tekil). */
const fill = (s: string, vars?: Record<string, string | number>) =>
  vars
    ? s
        .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_m, k: string, one: string, many: string) => (Number(vars[k]) === 1 ? one : many))
        .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
    : s

export function translate(lang: Lang, tr: string, vars?: Record<string, string | number>): string {
  if (lang === 'tr') return fill(tr, vars)
  const en = EN[tr]
  if (en === undefined) {
    if (import.meta.env.DEV && !warned.has(tr)) {
      warned.add(tr)
      console.warn(`[i18n] İngilizce karşılık yok: ${JSON.stringify(tr)}`)
    }
    return fill(tr, vars)
  }
  return fill(en, vars)
}

/** Dil bileşenin dışında da gerekirse (ör. yardımcı işlevler): o anki dilde çeviri. */
export const t = (tr: string, vars?: Record<string, string | number>) => translate(getLang(), tr, vars)

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useLang() {
  const lang = useSyncExternalStore(subscribe, getLang, getLang)
  return {
    lang,
    setLang,
    t: (tr: string, vars?: Record<string, string | number>) => translate(lang, tr, vars),
    /** Tarih/sayı biçimi için yerel ayar. */
    locale: lang === 'en' ? 'en-GB' : 'tr-TR',
  }
}

/** `<html lang>` dille eşlenir. Dil durumu sağlayıcı olmadan da çalışır (modül düzeyi depo); bu yalnızca eşleme yapar. */
export function LangProvider({ children }: { children: ReactNode }) {
  const { lang } = useLang()
  useEffect(() => syncHtml(lang), [lang])
  return <>{children}</>
}

/** TR | EN seçici: düğme grubu, seçili olan `aria-pressed`. Erişilebilir ad görünen kısaltmayı içerir (WCAG 2.5.3). */
export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, t: tt } = useLang()
  return (
    <div className={`vk-lang ${className}`} role="group" aria-label={tt('Dil')}>
      <button type="button" lang="tr" aria-pressed={lang === 'tr'} onClick={() => setLang('tr')} aria-label="TR – Türkçe">
        TR
      </button>
      <button type="button" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')} aria-label="EN – English">
        EN
      </button>
    </div>
  )
}
