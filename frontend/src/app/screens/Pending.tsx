import { Link, Navigate } from 'react-router-dom'
import { useSession } from '../session'

/** Şehir sayfası: rota ve eserler Faz 3'te gelir. Çıkmaz sokak olmasın diye açıkça belirtilir ve geri dönüş verilir. */
export default function Pending({ title }: { title: string }) {
  const session = useSession()
  if (!session) return <Navigate to="/giris" replace />
  return (
    <main className="vk-city">
      <section className="vk-city__intro">
        <h1>{title}</h1>
        <p>Eserler, rota ve oyun bu sayfada yapım aşamasında. Çok yakında.</p>
        <Link to="/sehir" className="vk-btn vk-btn--ghost">← Şehirlere dön</Link>
      </section>
    </main>
  )
}
