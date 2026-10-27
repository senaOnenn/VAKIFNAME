import { Link, useParams } from 'react-router-dom'
import { getMonument, getRoute, mediaUrl, progressId, statusMap, typeLabel, useLoad, type MonumentFact } from '../api'
import { GoldRule, Ornament } from '../components/Ornament'
import { StatusBadge } from '../components/StatusBadge'
import { useAuth } from '../session'
import './discover.css'
import './monument.css'

/** Doğrulanmamış içerik kesin bilgi gibi sunulmaz (şartname 5.1.3): kesinlik her bilgide görünür. */
const CERTAINTY: Record<string, string> = {
  documented: 'Kaynaklarda belgelenmiş',
  reported: 'Aktarılan bilgi (rivayet)',
  uncertain: 'Kesin değil',
}

function FactItem({ f }: { f: MonumentFact }) {
  return (
    <li className="vk-fact">
      <h3>{f.title}</h3>
      <p>{f.text}</p>
      <p className="vk-fact__meta">
        <span className={`vk-cert vk-cert--${f.certainty}`}>{CERTAINTY[f.certainty] ?? f.certainty}</span>
        <span>
          Kaynak: {f.source.title}, s. {f.source.pdf_physical_page}
          {f.sources?.map((s) => (
            <span key={s.url}>
              {' · '}
              <a href={s.url} target="_blank" rel="noreferrer">{s.publisher || s.title}</a>
            </span>
          ))}
        </span>
      </p>
    </li>
  )
}

/**
 * Eser sayfası. Sıra: görsel ve kimlik → (Faz 4) karakter anlatımı → ziyaret uyarısı → kaynaklı ayrıntı (ikinci
 * katman, gizlenmez) → galeri (her görselde atıf).
 */
export default function MonumentPage() {
  const { id = '' } = useParams()
  const auth = useAuth()
  const uid = progressId(auth)
  const m = useLoad((s) => getMonument(id, s), [id])
  const route = useLoad((s) => getRoute('bursa', uid, null, s).catch(() => null), [uid])
  const status = statusMap(route.data)[id]

  if (m.loading) return <main className="vk-page"><p className="vk-page__state" role="status">Eser yükleniyor…</p></main>
  if (m.error || !m.data)
    return (
      <main className="vk-page">
        <p className="vk-page__state vk-page__state--error" role="alert">Eser bulunamadı veya yüklenemedi.</p>
        <Link to="/eserler" className="vk-btn vk-btn--ghost">← Eserlere dön</Link>
      </main>
    )

  const d = m.data
  const cover = d.images[0]
  return (
    <main className="vk-mon">
      <header className="vk-mon__hero">
        {cover && <img className="vk-mon__img" src={mediaUrl(cover.card_file || cover.file)} alt={`${d.name} görünümü`} />}
        <div className="vk-mon__shade" aria-hidden="true" />
        <div className="vk-mon__title">
          <p className="vk-page__eyebrow">{typeLabel(d.type)} · {d.district}, {d.city}</p>
          <h1>{d.name}</h1>
          <StatusBadge status={status} />
        </div>
        {cover?.attribution && <p className="vk-mon__credit">{cover.attribution}</p>}
      </header>

      <div className="vk-mon__body">
        <section className="vk-narrator vk-narrator--soon" aria-labelledby="anlatim">
          <Ornament className="vk-narrator__orn" />
          <h2 id="anlatim">Rehberin anlatımı</h2>
          <p>Bu eseri yakında rehberimiz sesli ve altyazılı olarak anlatacak; sorularını ona yazabileceksin.</p>
        </section>

        {d.site_notice && (
          <aside className="vk-notice" aria-label="Ziyaret uyarısı">
            <strong>Ziyaret ederken</strong>
            <p>{d.site_notice}</p>
          </aside>
        )}

        <section className="vk-facts" aria-labelledby="tarihce">
          <h2 id="tarihce">Tarihçe ve kaynaklar</h2>
          <GoldRule className="vk-page__rule" />
          <p className="vk-facts__lead">{d.address}</p>
          <ol>
            {d.facts.map((f) => (
              <FactItem key={f.fact_id} f={f} />
            ))}
          </ol>
        </section>

        {d.images.length > 0 && (
          <section className="vk-gallery" aria-labelledby="galeri">
            <h2 id="galeri">Görseller</h2>
            <ul>
              {d.images.map((img, i) => (
                <li key={img.image_id}>
                  <figure>
                    <img src={mediaUrl(img.card_file || img.file)} alt={`${d.name}, görsel ${i + 1}`} loading="lazy" />
                    <figcaption>
                      {img.attribution ?? img.rights_holder}
                      {img.license_url && (
                        <>
                          {' · '}
                          <a href={img.license_url} target="_blank" rel="noreferrer">{img.license}</a>
                        </>
                      )}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
