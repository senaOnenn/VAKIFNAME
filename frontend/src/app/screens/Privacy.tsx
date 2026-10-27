import { Link } from 'react-router-dom'
import './city.css'
import './account.css'

/**
 * Kişisel verilerin işlenmesine dair bilgilendirme. Metin, sistemin gerçekte sakladığı verilere göre yazılmıştır
 * (backend/app/accounts.py, progress.py). Hukuki metin değildir; yayın öncesi kurumun KVKK metniyle değiştirilmelidir.
 */
export default function Privacy() {
  return (
    <main className="vk-city">
      <section className="vk-city__intro vk-privacy">
        <h1>Aydınlatma metni</h1>
        <p>VAKIFNAME bir yarışma prototipidir. Hangi verileri neden tuttuğumuzu açıkça yazıyoruz.</p>
        <h2>Hesap açarsan</h2>
        <ul>
          <li>E-posta adresin ve (isteğe bağlı) adın.</li>
          <li>Parolan değil, yalnızca geri çevrilemeyen özeti (scrypt). Parolan tarayıcıda da saklanmaz.</li>
          <li>Google ile girersen Google'ın sana verdiği hesap kimliği ve doğrulanmış e-postan.</li>
          <li>Oturumu açık tutan bir çerez (<code>vk_session</code>, 30 gün). Sunucuda yalnızca özeti tutulur.</li>
        </ul>
        <h2>Oyunda</h2>
        <ul>
          <li>Cevapladığın sorular ve kazandığın mühürler (eser ve tarih).</li>
          <li>Ziyaret doğrulaması için konumun yalnızca o an kontrol edilir; konum geçmişi tutulmaz.</li>
          <li>Misafirken ilerlemen bu cihazda rastgele bir kimlikle tutulur; hesap açınca hesabına taşınır.</li>
        </ul>
        <h2>Hakların</h2>
        <ul>
          <li>Hesap sayfasından hesabını ve tüm ilerlemeni kalıcı olarak silebilirsin.</li>
          <li>Verilerin reklam veya üçüncü taraflarla paylaşım için kullanılmaz.</li>
        </ul>
        <Link to="/giris" className="vk-btn vk-btn--ghost">← Geri dön</Link>
      </section>
    </main>
  )
}
