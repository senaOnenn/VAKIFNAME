import { Link } from 'react-router-dom'
import './city.css'

/** Yapım aşamasındaki sayfa: çıkmaz sokak olmasın diye açıkça belirtilir ve geri dönüş verilir. */
export default function Pending({ title, text }: { title: string; text: string }) {
  return (
    <main className="vk-city">
      <section className="vk-city__intro">
        <h1>{title}</h1>
        <p>{text}</p>
        <Link to="/sehir" className="vk-btn vk-btn--ghost">← Şehirlere dön</Link>
      </section>
    </main>
  )
}
