import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { putMonumentEn, type MonumentEdit } from '../../api'
import { DRAFT_NOTE, formatWhen } from './labels'
import { StatusTag } from './StatusTag'

/**
 * Eserin İngilizcesi (Faz 11): İngilizce ad ve ziyaret uyarısı (katalog eserinde de) ve yayındaki Türkçe kayıtların
 * İngilizce durumları. Her kaydın çevirisi `/yonetim/icerik/ceviri/:factId` düzenleyicisinde onaylanır.
 */
export function EnglishCard({ edit, onChange }: { edit: MonumentEdit; onChange: () => void }) {
  const id = useId()
  const m = edit.monument
  const en = edit.monument_en ?? null
  const [name, setName] = useState(en?.name_en ?? '')
  const [notice, setNotice] = useState(en?.site_notice_en ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)
  const byFact = new Map((edit.translations ?? []).map((t) => [t.fact_id, t]))
  const facts = edit.tr_facts ?? []

  async function save(publish: boolean) {
    if (!name.trim()) {
      setMsg({ text: 'İngilizce ad boş bırakılamaz.', error: true })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await putMonumentEn(m.monument_id, { name_en: name.trim(), site_notice_en: notice.trim() || null, publish })
      setMsg({ text: publish ? 'İngilizce ad yayımlandı.' : 'İngilizce ad taslak olarak kaydedildi.', error: false })
      onChange()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Kaydedilemedi.', error: true })
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save(false)
  }

  return (
    <section className="vk-admin__card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>İngilizce</h2>
      <p className="vk-admin__note">
        İngilizce metin kitabın İngilizce bölümünden alınır; makine çevirisi kullanılmaz. İngilizcesi onaylanmamış bilgi
        İngilizce arayüzde Türkçe olarak gösterilir.
      </p>

      <form className="vk-cform vk-cform--grid" onSubmit={submit} noValidate aria-label="İngilizce ad ve ziyaret uyarısı">
        {en && (
          <p className="vk-content__muted">
            <StatusTag status={en.status} />{' '}
            {en.decision ? `${en.decision.by} · ${formatWhen(en.decision.at)}` : 'Henüz onaylanmadı'}
          </p>
        )}
        <label htmlFor={`${id}-name`}>İngilizce ad</label>
        <input id={`${id}-name`} lang="en" value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Grand Mosque of Bursa" />
        <label htmlFor={`${id}-notice`}>İngilizce ziyaret uyarısı (isteğe bağlı)</label>
        <textarea id={`${id}-notice`} lang="en" rows={2} value={notice} onChange={(e) => setNotice(e.target.value)} />
        {en?.status !== 'published' && <p className="vk-admin__note">{DRAFT_NOTE}</p>}
        <div className="vk-cform__actions">
          <button type="submit" className="vk-btn vk-btn--ghost" disabled={busy}>Taslak olarak kaydet</button>
          <button type="button" className="vk-btn" disabled={busy} onClick={() => void save(true)}>Kaydet ve yayımla</button>
        </div>
        <p className={msg?.error ? 'vk-cform__error' : 'vk-admin__note'} role={msg?.error ? 'alert' : 'status'}>{msg?.text ?? ''}</p>
      </form>

      <h3>Kayıtların İngilizcesi</h3>
      {facts.length === 0 ? (
        <p className="vk-admin__note">Bu eserin yayında Türkçe kaydı yok.</p>
      ) : (
        <ul className="vk-content__list" aria-label="Kayıtların İngilizce durumu">
          {facts.map((f) => {
            const t = byFact.get(f.fact_id)
            return (
              <li key={f.fact_id}>
                <Link to={`/yonetim/icerik/ceviri/${f.fact_id}`}>{f.title}</Link>
                {t ? <StatusTag status={t.status} /> : <span className="vk-ctag vk-ctag--none">Yok</span>}
                <span className="vk-content__muted" lang={t ? 'en' : undefined}>{t ? t.title_en : 'İngilizcesi yok'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
