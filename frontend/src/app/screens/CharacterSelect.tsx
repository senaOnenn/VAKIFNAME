import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { chooseCharacter, useLoad, type CharacterId } from '../api'
import { CHARACTERS, characterOf } from '../characters'
import { KasifPortrait } from '../components/KasifPortrait'
import { useLang } from '../i18n'
import { loadPlayerProfile, PlayerLoadError, PROFILE_FAIL_TEXT, profileFailure } from '../player'
import { NEXT_PARAM, safeNext } from '../RequireAccount'
import { refreshAuth } from '../session'
import './character-select.css'

const BASE = import.meta.env.BASE_URL
const ROOM = `${BASE}media/sahne/scene-7-1920.webp?v=${__MEDIA_VERSION__}`

/** Seçimden sonra gidilecek oyun adresi: yalnızca oyunun içi (karakter ekranının kendisi değil). */
function nextOf(raw: string | null): string {
  const to = safeNext(raw, '/oyun')
  return to.startsWith('/oyun') && !to.startsWith('/oyun/karakter') ? to : '/oyun'
}

/**
 * Karakter seçimi (R6.3, R6.5): vakfiye odasında kâşiflerin takdimi. Arka planda arşiv odası; üç kemerli nişte üç kâşifin
 * katmanlı portresi, rolü, gözü (temasi) ve eşyası. Seçilen niş ışıkla dolar. Seçim yerel radyo düğmeleriyle yapılır
 * (Tab, boşluk, oklar); karakter yalnızca görünüştür. Kâşifler profil yüklenmeden de çizilir (profil yalnızca mevcut
 * seçimi işaretler); sunucu varsayılan atamaz, seçilmeden kayıt düğmesi kapalıdır.
 */
export default function CharacterSelect() {
  const { t } = useLang()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = nextOf(params.get(NEXT_PARAM))
  const uid = useId()
  const loaded = useLoad((s) => loadPlayerProfile(s), [])
  const data = loaded.data?.profile ?? null
  const fail = loaded.data?.fail ?? (loaded.error ? 'error' : null)
  // Eski kimlikler (8 Kasım öncesi) güncel kâşife eşlenir; seçili kart doğru görünsün.
  const current = characterOf(data?.character?.id)?.id ?? null
  const [picked, setPicked] = useState<CharacterId | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (current) setPicked((p) => p ?? current)
  }, [current])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!picked) return
    setBusy(true)
    setError('')
    try {
      await chooseCharacter(picked)
      navigate(next, { replace: true })
    } catch (err) {
      // Türüne göre kısa mesaj (bağlantı, oturum, eski sunucu); sunucunun teknik ayrıntısı gösterilmez.
      const kind = await profileFailure(err)
      setError(kind === 'error' ? t('Seçim kaydedilemedi. Lütfen tekrar dene.') : t(PROFILE_FAIL_TEXT[kind]))
      if (kind === 'session') void refreshAuth()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="vk-cs" style={{ ['--room' as string]: `url("${ROOM}")` }}>
      <div className="vk-cs__inner">
        <header className="vk-cs__head">
          <p className="vk-cs__eyebrow">{t('Kayıp Vakfiye')}</p>
          <h1 id={`${uid}-h`} className="vk-cs__title">{current ? t('Kâşifini değiştir') : t('Kâşifini seç')}</h1>
          <p className="vk-cs__lead">
            {t('Osmanlı Bursa’sında tarihî eserlerin izini süreceksin. Yolculuğa kimin gözünden başlayacağını seç.')}
          </p>
        </header>

        {loaded.loading && !loaded.data && <p className="vk-cs__state" role="status">{t('Oyuncu profili yükleniyor…')}</p>}
        {fail && <PlayerLoadError fail={fail} onRetry={loaded.reload} className="vk-cs__state vk-cs__state--error" />}

        <form className="vk-cs__form" onSubmit={submit} aria-labelledby={`${uid}-h`}>
          <fieldset className="vk-cs__set">
            <legend className="vk-sr-only">{t('Kâşifler')}</legend>
            {CHARACTERS.map((c) => {
              const on = picked === c.id
              return (
                <label key={c.id} className={`vk-cs__niche${on ? ' is-picked' : ''}`}>
                  <input type="radio" name={`${uid}-c`} value={c.id} checked={on}
                    onChange={() => setPicked(c.id)} className="vk-cs__radio"
                    aria-labelledby={`${uid}-${c.id}-n`} aria-describedby={`${uid}-${c.id}`} />
                  <span className="vk-cs__arch" aria-hidden="true">
                    <span className="vk-cs__glow" />
                    {/* Seçim ekranında her zaman en üst seviye (Başkâşif) görünür; diğer ekranlarda oyuncunun seviyesi. */}
                    <KasifPortrait id={c.id} stage="muhafiz" className="vk-cs__portrait" />
                    {on && <span className="vk-cs__mark">{t('Seçildi')}</span>}
                  </span>
                  <span id={`${uid}-${c.id}-n`} className="vk-cs__name">{t(c.name)}</span>
                  <span className="vk-cs__theme">{t(c.theme)}</span>
                  <span id={`${uid}-${c.id}`} className="vk-cs__desc">
                    {t(c.description)} <span className="vk-cs__tool">{t('Elinde: {tool}', { tool: t(c.tool) })}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>

          <p className="vk-cs__note">
            {t('Kâşifler yalnızca görünüştür; oyunda ikisi de aynı kurallarla ilerler. Seviyen yükseldikçe kâşifinin kıyafeti ve eşyaları gelişir: Çırak Kâşif, Gezgin Seyyah, Vakıf Muhafızı, Başkâşif.')}
          </p>
          {error && <p className="vk-cs__state vk-cs__state--error" role="alert">{error}</p>}
          <div className="vk-cs__actions">
            <button type="submit" className="vk-btn vk-cs__go" disabled={!picked || busy || (!data && !fail)}>
              {busy ? t('Kaydediliyor…') : current ? t('Kaydet ve devam et') : t('Seç ve maceraya başla')}
            </button>
            {current ? (
              <Link to={next} className="vk-cs__back">{t('Vazgeç')}</Link>
            ) : (
              <Link to="/eserler" className="vk-cs__back">{t('Şimdilik keşfe dön')}</Link>
            )}
          </div>
        </form>
      </div>
    </main>
  )
}
