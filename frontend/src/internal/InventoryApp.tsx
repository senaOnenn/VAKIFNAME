import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { InventoryTable } from './InventoryTable'
import { LocationCandidatesPanel } from './LocationCandidates'
import { MonumentReview } from './MonumentReview'
import { ResearchMapPanel } from './ResearchMapPanel'
import { closeSession, getMonuments, getStatus, hasSession, isUnauthorized, openSession } from './reviewClient'
import { BatchReviewPanel } from './BatchReview'
import { ZipGalleryPreviewPanel } from './ZipGalleryPreview'
import { ReviewerBar, ReviewOverviewPanel } from './ReviewWorkflow'
import type { ReviewerInfo } from './types'

type Session = { state: 'checking' } | { state: 'anonymous'; notice?: string } | { state: 'authenticated' } | {
  state: 'unreachable'
  error: unknown
}

function errorText(error: unknown): string {
  const e = error as ApiError
  if (e?.kind === 'network') {
    return 'Dahili inceleme sunucusuna ulaşılamadı. Sunucu yalnızca 127.0.0.1:8765 üzerinde çalışır; README’deki "Dahili API" adımına bakın.'
  }
  return e?.message ?? 'Beklenmeyen bir hata oluştu.'
}

function LoginForm({ notice, onSuccess }: { notice?: string; onSuccess: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = inputRef.current
    if (!input?.value) return
    setBusy(true)
    setError(null)
    // Anahtar React durumunda tutulmaz; yalnızca bu istekte gönderilir ve alan hemen temizlenir.
    const token = input.value
    input.value = ''
    try {
      await openSession(token)
      onSuccess()
    } catch (e) {
      const status = (e as ApiError).status
      setError(
        status === 401
          ? 'Erişim anahtarı geçersiz.'
          : status === 429
            ? 'Çok fazla hatalı deneme. Bir dakika sonra tekrar deneyin.'
            : errorText(e),
      )
      setBusy(false)
      input.focus()
    }
  }

  return (
    <form className="inventory-login" onSubmit={submit} aria-labelledby="inventory-login-title">
      <h2 id="inventory-login-title">Yetkili inceleme girişi</h2>
      <p>
        Bu ekran yalnızca yetkili dahili geliştirme içindir. Erişim anahtarını sunucu yöneticisinden alın; anahtar bu
        sayfada saklanmaz. Giriş sonrası tarayıcıya yalnızca kısa ömürlü bir oturum çerezi verilir.
      </p>
      {notice && <p className="notice notice--warning">{notice}</p>}
      <label htmlFor="inventory-token">Dahili erişim anahtarı</label>
      <input
        ref={inputRef}
        id="inventory-token"
        name="token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        aria-describedby={error ? 'inventory-login-error' : undefined}
      />
      {error && (
        <p id="inventory-login-error" className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button button--primary" disabled={busy}>
        {busy ? 'Doğrulanıyor…' : 'Oturum aç'}
      </button>
    </form>
  )
}

function StatusStrip({ onUnauthorized }: { onUnauthorized: () => void }) {
  const status = useApi(getStatus, 'internal-status')
  const unauthorized = status.status === 'error' && isUnauthorized(status.error)
  useEffect(() => {
    if (unauthorized) onUnauthorized()
  }, [unauthorized, onUnauthorized])
  if (status.status !== 'success') return null
  const s = status.data
  const items: [number, string][] = [
    [s.counts.monuments, 'eser'],
    [s.counts.existing_historical_facts, `olgu · ${s.publicly_usable_facts} yayına uygun`],
    [s.counts.unapproved_drafts, 'karantinadaki aday'],
    [s.images, `görsel · ${s.publishable_images} yayınlanabilir`],
    [s.locations.missing, 'eserde koordinat yok'],
    [s.locations.unverified, 'eserde doğrulanmamış koordinat adayı'],
    [s.locations.verified, 'eserde doğrulanmış konum'],
    [s.counts.open_editorial_issues, 'açık editoryal sorun'],
  ]
  return (
    <ul className="inventory-stats" aria-label="Envanter özeti">
      {items.map(([n, label]) => (
        <li key={label}>
          <strong>{n}</strong> {label}
        </li>
      ))}
    </ul>
  )
}

function Inventory({ onUnauthorized }: { onUnauthorized: () => void }) {
  const monuments = useApi(getMonuments, 'internal-monuments')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewer, setReviewer] = useState<ReviewerInfo | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const unauthorized = monuments.status === 'error' && isUnauthorized(monuments.error)
  useEffect(() => {
    if (unauthorized) onUnauthorized()
  }, [unauthorized, onUnauthorized])
  useEffect(() => {
    if (selectedId) panelRef.current?.focus()
  }, [selectedId])

  return (
    <>
      <StatusStrip onUnauthorized={onUnauthorized} />
      <ReviewerBar onChange={setReviewer} />
      <BatchReviewPanel key={`batch-${reviewer?.reviewer_id ?? 'anonim'}`} reviewer={reviewer} />
      {monuments.status === 'success' && <ZipGalleryPreviewPanel monuments={monuments.data} />}
      {monuments.status === 'success' && (
        <ResearchMapPanel monuments={monuments.data} selectedId={selectedId} onSelect={setSelectedId} />
      )}
      <ReviewOverviewPanel key={reviewer?.reviewer_id ?? 'anonim'} reviewer={reviewer} />
      <LocationCandidatesPanel />
      {monuments.status === 'loading' && <p>Eserler yükleniyor…</p>}
      {monuments.status === 'error' && !unauthorized && (
        <div className="notice notice--error" role="alert">
          <div>
            <p className="notice__title">Envanter yüklenemedi</p>
            <p>{errorText(monuments.error)}</p>
            <button type="button" className="button button--secondary" onClick={monuments.reload}>
              Tekrar dene
            </button>
          </div>
        </div>
      )}
      {monuments.status === 'success' && (
        <InventoryTable monuments={monuments.data} selectedId={selectedId} onSelect={setSelectedId} />
      )}
      {selectedId && (
        <MonumentReview
          ref={panelRef}
          key={selectedId}
          monumentId={selectedId}
          reviewer={reviewer}
          onClose={() => setSelectedId(null)}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  )
}

/**
 * Gerçek Bursa Envanteri: dahili, erişim kontrollü önizleme. Yalnızca doğrulanmamış konum adaylarını gösteren bir
 * araştırma haritası içerir; görev, check-in ve pasaport içermez.
 */
export default function InventoryApp() {
  const [session, setSession] = useState<Session>({ state: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    hasSession(controller.signal).then(
      (ok) => {
        if (!controller.signal.aborted) setSession(ok ? { state: 'authenticated' } : { state: 'anonymous' })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setSession({ state: 'unreachable', error })
      },
    )
    return () => controller.abort()
  }, [attempt])

  const expired = useCallback(
    () => setSession({ state: 'anonymous', notice: 'Oturumun süresi doldu veya kapatıldı. Yeniden giriş yapın.' }),
    [],
  )

  async function logout() {
    try {
      await closeSession()
    } finally {
      setSession({ state: 'anonymous', notice: 'Oturum kapatıldı.' })
    }
  }

  return (
    <div className="inventory">
      <header className="inventory-header">
        <div className="container inventory-header__inner">
          <div>
            <p className="inventory-header__eyebrow">VAKIFNAME · Dahili önizleme</p>
            <h1 className="inventory-header__title">Gerçek Bursa Envanteri</h1>
          </div>
          {session.state === 'authenticated' && (
            <button type="button" className="button button--light" onClick={logout}>
              Oturumu kapat
            </button>
          )}
        </div>
      </header>
      <main className="container inventory-main">
        <div className="notice notice--warning">
          <div>
            <p className="notice__title">Yayında değil · editör, lisans ve konum onayı bekliyor</p>
            <p>
              Buradaki kayıtlar genel uygulamada, haritada, görevlerde veya RAG sohbetinde kullanılmaz. Koordinatı
              doğrulanmamış eser genel haritada işaretlenmez ve check-in yapılamaz; aşağıdaki araştırma haritası yalnızca
              doğrulanmamış konum adaylarını inceleme için gösterir. Görseller lisans incelemesi tamamlanana kadar
              gösterilmez. Kaynak sayfaları fiziksel PDF sayfasıdır, basılı sayfa numarası değildir.
            </p>
          </div>
        </div>
        {session.state === 'checking' && <p>Oturum denetleniyor…</p>}
        {session.state === 'unreachable' && (
          <div className="notice notice--error" role="alert">
            <div>
              <p className="notice__title">Dahili sunucu kullanılamıyor</p>
              <p>{errorText(session.error)}</p>
              <button type="button" className="button button--secondary" onClick={() => setAttempt((n) => n + 1)}>
                Tekrar dene
              </button>
            </div>
          </div>
        )}
        {session.state === 'anonymous' && (
          <LoginForm notice={session.notice} onSuccess={() => setSession({ state: 'authenticated' })} />
        )}
        {session.state === 'authenticated' && <Inventory onUnauthorized={expired} />}
      </main>
    </div>
  )
}
