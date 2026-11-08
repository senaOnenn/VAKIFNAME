/**
 * Anlatıcı ses profilleri (R3.3). Her rehber çizimi bir ses profiline bağlıdır (`components/GuideFigure.tsx`).
 *
 * Ses iki yoldan gelir:
 * 1. **Sunucu sesi** (`/speech/status`, `files` sağlayıcısı): izinli bir insan sesinin klonuyla ÖNCEDEN üretilmiş MP3'ler.
 *    Hangi sesin çalınacağını backend ortamı seçer (`VAKIFNAME_TTS_VOICE` / `_EN`); dosya adı ses adını da içerdiğinden
 *    (`sha256("files|<dil>|<ses>|<hız>|<metin>").mp3`, `backend/app/tts.py`) farklı seslerin dosyaları aynı klasörde
 *    birbirine dokunmadan durur. `serverVoice` yalnızca beklenen ses adını belgeler; arayüz sunucu sesini seçmez.
 * 2. **Tarayıcı sesi** (yedek; sunucu sesi kapalıysa ya da cümlenin dosyası yoksa): işletim sisteminin sentetik sesi.
 *    `browserPrefer` o profile uygun sistem seslerini öne alır; uygun ses yoksa o dildeki herhangi bir ses kullanılır
 *    (anlatım yine çalışır), ses hiç yoksa altyazı okuma modunda ilerler.
 *
 * Kural: yalnızca izinli kayıttan üretilmiş ses kullanılır; gerçek tarihî kişilerin sesi taklit edilmez.
 * 8 Kasım (Talha): ekip üyesinin klon sesi (`zulal-1`) kaldırıldı; hiçbir profilde sunucu sesi yok, anlatım tarayıcı
 * sesi ve altyazıyla sürer.
 */
export type VoiceProfile = {
  id: 'kadin' | 'erkek'
  gender: 'female' | 'male'
  /** Sunucuda beklenen ses adı (`VAKIFNAME_TTS_VOICE` / `_EN`); `null`: izinli kayıt henüz yok. */
  serverVoice: { tr: string | null; en: string | null }
  /** Tarayıcı yedeğinde öne alınacak sistem sesleri (ad kalıbı). */
  browserPrefer: { tr: RegExp; en: RegExp }
}

/** Önceki rehber (SVG karakter): kadın anlatıcı. Sunucu sesi yok (8 Kasım); tarayıcı yedeğinde kadın sistem sesleri. */
export const VOICE_KADIN: VoiceProfile = {
  id: 'kadin',
  gender: 'female',
  serverVoice: { tr: null, en: null },
  browserPrefer: { tr: /yelda|emel|filiz|female|kadın/i, en: /^$/ },
}

/**
 * R3.3 Osmanlı rehberi (erkek). İzinli erkek kaydı henüz yok: sunucu sesi `null`. Kayıt gelince ses adı (öneri `erkek-1`)
 * buraya ve backend ortamına yazılır. Tarayıcı yedeğinde erkek sistem sesleri öne alınır (ör. Windows Tolga/Ahmet,
 * David/Guy; macOS Daniel). "\bmale\b" "female" ile eşleşmez.
 */
export const VOICE_ERKEK: VoiceProfile = {
  id: 'erkek',
  gender: 'male',
  serverVoice: { tr: null, en: null },
  browserPrefer: {
    tr: /\b(tolga|ahmet|cem|erkek)\b|\bmale\b/i,
    en: /\b(david|guy|mark|ryan|daniel|alex|fred|christopher|eric|andrew|brian|male)\b/i,
  },
}
