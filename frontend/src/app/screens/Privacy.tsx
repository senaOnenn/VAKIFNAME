import { Link } from 'react-router-dom'
import { useLang } from '../i18n'
import './city.css'
import './account.css'

/**
 * Kişisel verilerin işlenmesine dair bilgilendirme. Metin, sistemin gerçekte sakladığı verilere göre yazılmıştır
 * (backend/app/accounts.py, progress.py, guide_routes.py, stats.py; 7 Kasım: rehber, istatistik ve tarayıcıdaki ayarlar
 * eklendi). Hukuki metin değildir; yayın öncesi kurumun KVKK metniyle değiştirilmelidir.
 */
export default function Privacy() {
  const { t } = useLang()
  return (
    <main className="vk-city">
      <section className="vk-city__intro vk-privacy">
        <h1>{t('Aydınlatma metni')}</h1>
        <p>{t('VAKIFNAME bir yarışma prototipidir. Hangi verileri neden tuttuğumuzu açıkça yazıyoruz.')}</p>
        <h2>{t('Hesap açarsan')}</h2>
        <ul>
          <li>{t('E-posta adresin ve (isteğe bağlı) adın.')}</li>
          <li>{t('Parolan değil, yalnızca geri çevrilemeyen özeti (scrypt). Parolan tarayıcıda da saklanmaz.')}</li>
          <li>{t("Google ile girersen Google'ın sana verdiği hesap kimliği ve doğrulanmış e-postan.")}</li>
          <li>{t('Oturumu açık tutan bir çerez')} (<code>vk_session</code>, {t('30 gün')}). {t('Sunucuda yalnızca özeti tutulur.')}</li>
        </ul>
        <h2>{t('Oyunda')}</h2>
        <ul>
          <li>{t('Cevapladığın sorular ve kazandığın mühürler (eser ve tarih).')}</li>
          <li>{t('Ziyaret doğrulaması için konumun yalnızca o an kontrol edilir; konum geçmişi tutulmaz.')}</li>
          <li>{t('Misafirken ilerlemen bu cihazda rastgele bir kimlikle tutulur; hesap açınca hesabına taşınır.')}</li>
        </ul>
        <h2>{t('Rehberle konuşursan')}</h2>
        <ul>
          <li>{t('Yazdığın soru, cevap üretilmesi için yapay zekâ hizmetine (Anthropic Claude) gönderilir. Soru ve konuşma bizde kaydedilmez, loglanmaz.')}</li>
          <li>{t('İstersen yüklediğin fotoğraf yalnızca o istek için bellekte işlenir, bizde kaydedilmez ve görsel tanıma hizmetine (OpenRouter üzerinden ücretsiz bir model) gönderilir. Ücretsiz hizmetler gönderilen içeriği kendi koşullarına göre saklayabilir; bu yüzden fotoğrafta yüz bulunursa hiçbir yere gönderilmeden reddedilir.')}</li>
          <li>{t('Bu hizmetler yurt dışındaki sunucularda çalışabilir.')}</li>
        </ul>
        <h2>{t('Ziyaret istatistikleri')}</h2>
        <ul>
          <li>{t('Çerez kullanmadan yalnızca günlük sayaçlar tutulur (ziyaretçi sayısı, sayfa ve eser görüntülenmesi). IP adresin ve tarayıcı bilgin diske yazılmaz.')}</li>
        </ul>
        <h2>{t('Bu cihazda')}</h2>
        <ul>
          <li>{t('Dil seçimin, erişilebilirlik ayarların ve açılış animasyonunu gördüğün bu tarayıcıda saklanır; sunucuya gönderilmez.')}</li>
        </ul>
        <h2>{t('Hakların')}</h2>
        <ul>
          <li>{t('Hesap sayfasından hesabını ve tüm ilerlemeni kalıcı olarak silebilirsin.')}</li>
          <li>{t('Verilerin reklam için kullanılmaz ve satılmaz; yalnızca yukarıda yazılan hizmetlere, yazılan amaçla gider.')}</li>
        </ul>
        <h2>{t('Lisanslar')}</h2>
        <ul>
          <li>{t('Eser bilgileri ve kitap fotoğrafları Vakıf Eserleri Envanter Projesi yayınlarındandır; diğer fotoğrafların lisansı ve atfı her fotoğrafın altında yazar.')}</li>
          <li>
            {t('Kullandığımız açık kaynak yazılımların lisansları:')}{' '}
            <a href="/acik-kaynak-lisanslari.txt">{t('açık kaynak lisansları')}</a>
          </li>
        </ul>
        <Link to="/giris" className="vk-btn vk-btn--ghost">← {t('Geri dön')}</Link>
      </section>
    </main>
  )
}
