import { useEffect, useState } from 'react'
import { getAdminStats, useLoad, type AdminStats } from '../api'
import { BarChart, LineChart, StatTile } from '../components/charts'
import { GoldRule } from '../components/Ornament'
import './discover.css'
import './admin.css'

const RANGES = [7, 30, 90]
const PAGE_LABEL: Record<string, string> = {
  acilis: 'Açılış', giris: 'Giriş', sehir: 'Şehir seçimi', rota: 'Rota', eserler: 'Eserler', eser: 'Eser sayfası',
  rozet: 'Rozeti Al', pasaport: 'Pasaport', hesap: 'Hesap',
}

/** Yönetim paneli: anonim ziyaret istatistikleri (sponsorun istediği ilgi ölçümü). Yalnızca yöneticiye açık. */
export default function AdminPage() {
  const [days, setDays] = useState(30)
  const stats = useLoad((s) => getAdminStats(days, s), [days])
  // Yeniden yüklenirken önceki görüntü soluk tutulur (sayfa zıplamaz).
  const [shown, setShown] = useState<AdminStats | null>(null)
  useEffect(() => {
    if (stats.data) setShown(stats.data)
  }, [stats.data])

  if (stats.error && !shown) {
    const forbidden = stats.error.includes('yöneticilere') || stats.error.includes('Oturum')
    return (
      <main className="vk-page">
        <p className="vk-page__state vk-page__state--error" role="alert">{forbidden ? stats.error : `İstatistikler yüklenemedi: ${stats.error}`}</p>
      </main>
    )
  }

  return (
    <main className="vk-page vk-admin">
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">Yönetim</p>
        <h1>Ziyaret istatistikleri</h1>
        <GoldRule className="vk-page__rule" />
        <p>Çerezsiz ve anonim sayım: kişisel veri tutulmaz; "izleme" kapalı tarayıcılar sayılmaz.</p>
      </header>

      <div className="vk-admin__filters" role="group" aria-label="Tarih aralığı">
        {RANGES.map((d) => (
          <button key={d} type="button" className="vk-chip" aria-pressed={days === d} onClick={() => setDays(d)}>
            Son {d} gün
          </button>
        ))}
      </div>

      {!shown && <p className="vk-page__state" role="status">Yükleniyor…</p>}
      {shown && (
        <div className={stats.loading ? 'vk-admin__body is-loading' : 'vk-admin__body'} aria-busy={stats.loading}>
          <div className="vk-admin__kpis">
            <StatTile label="Tekil ziyaretçi (günlük toplam)" value={shown.totals.visitors} />
            <StatTile label="Sayfa görüntüleme" value={shown.totals.pageviews} />
            <StatTile label="Eser sayfası görüntüleme" value={shown.totals.monument_views} />
          </div>

          <section className="vk-admin__card" aria-labelledby="gunluk">
            <h2 id="gunluk">Günlük ziyaretçi</h2>
            <LineChart label="Günlük tekil ziyaretçi" points={shown.days.map((d) => ({ day: d.day, value: d.visitors }))} />
            <details className="vk-admin__table">
              <summary>Tablo olarak göster</summary>
              <table>
                <thead><tr><th scope="col">Gün</th><th scope="col">Ziyaretçi</th><th scope="col">Sayfa görüntüleme</th></tr></thead>
                <tbody>
                  {[...shown.days].reverse().map((d) => (
                    <tr key={d.day}><td>{d.day}</td><td>{d.visitors}</td><td>{d.pageviews}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="vk-admin__card" aria-labelledby="en-cok">
            <h2 id="en-cok">En çok ilgi gören eserler</h2>
            {shown.monuments.length ? (
              <BarChart label="Eser sayfası görüntülemeleri" rows={shown.monuments.slice(0, 10).map((m) => ({ name: m.name, value: m.views }))} />
            ) : (
              <p className="vk-page__state">Bu aralıkta eser görüntülemesi yok.</p>
            )}
          </section>

          {shown.game && (
            <section className="vk-admin__card" aria-labelledby="huni">
              <h2 id="huni">Oyun hunisi</h2>
              <p className="vk-admin__note">Tüm zamanlar, tarih aralığından bağımsız. Sayılar (kişi, eser) çiftidir; {shown.game.players.toLocaleString('tr-TR')} tekil oyuncu.</p>
              <BarChart
                label="Oyun kademelerine ulaşan sayısı"
                rows={[
                  { name: 'Anlatımı dinleyen', value: shown.game.listened },
                  { name: 'Rehbere soran', value: shown.game.asked },
                  { name: 'Bilgi mührü alan', value: shown.game.knowledge },
                  { name: 'Eseri ziyaret eden', value: shown.game.visit },
                ]}
              />
              {shown.game.visit_simulated > 0 && (
                <p className="vk-admin__note">Ayrıca {shown.game.visit_simulated.toLocaleString('tr-TR')} sunum modu (simüle edilmiş) ziyaret; ziyaret sayısına katılmaz.</p>
              )}
            </section>
          )}

          <section className="vk-admin__card" aria-labelledby="sayfalar">
            <h2 id="sayfalar">Sayfalar</h2>
            <table className="vk-admin__pages">
              <thead><tr><th scope="col">Sayfa</th><th scope="col">Görüntüleme</th></tr></thead>
              <tbody>
                {shown.pages.map((p) => (
                  <tr key={p.page}><td>{PAGE_LABEL[p.page] ?? p.page}</td><td>{p.views.toLocaleString('tr-TR')}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
      {stats.error && shown && <p className="vk-page__state vk-page__state--error" role="alert">Güncellenemedi: {stats.error}</p>}
    </main>
  )
}

