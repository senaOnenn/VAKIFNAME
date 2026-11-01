import { Link } from 'react-router-dom'
import { GuideChat } from '../components/Narrator'
import { GoldRule } from '../components/Ornament'
import { useLang } from '../i18n'
import './discover.css'
import './guide-page.css'

/**
 * Rehber: eser seçmeden yazışma. Rehber hattı aynıdır (`POST /guide/ask`, eser kimliği olmadan); cevaplar yalnızca onaylı
 * kayıtlardan gelir ve dayandığı kayıt gösterilir. Bir eserin sesli anlatımı eser sayfasındadır.
 */
export default function GuidePage() {
  const { t } = useLang()
  return (
    <main className="vk-page vk-guidepage">
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">{t('Yapay zekâ rehber')}</p>
        <h1>{t('Rehbere sor')}</h1>
        <GoldRule className="vk-page__rule" />
        <p>{t('Vakıf eserleri hakkında merak ettiğini yaz. Rehber yalnızca onaylı kaynaklardan cevaplar; her cevabın dayandığı kayıt altında yazar. Kaynakta yoksa bunu söyler.')}</p>
      </header>
      <div className="vk-guidepage__chat">
        <GuideChat monumentId={null} placeholder="Örn. Bir külliyede hangi yapılar bulunur?" />
      </div>
      <p className="vk-guidepage__hint">
        {t('Bir eserin sesli anlatımını dinlemek için')} <Link to="/eserler">{t('eserlerden birini aç')}</Link>.
      </p>
    </main>
  )
}
