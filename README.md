# VAKIFNAME

Vakıf Eserleri Envanter Projesi yayınlarındaki eserleri herkes için ulaşılabilir kılan ve insanları eserleri **yerinde
ziyarete** teşvik eden oyunlaştırılmış rehber (KÖK&KOD Hackathon, takım HisGuard). Bursa pilot şehirdir; ürün yeni
şehirlere büyüyecek şekilde kuruludur.

- **Canlı (test adresi):** https://calismalar.tikirsoft.com
- **Çalışma kuralları ve kararlar:** [`CLAUDE.md`](CLAUDE.md) · **görev listesi:** [`TASK.md`](TASK.md)

## Ne yapar

Açılış → tanıtım → giriş (e-posta+parola, Google ya da üye olmadan) → şehir seçimi → **rota** (en yakın eser önerilir,
kilitler mühür kazandıkça açılır) → **eser sayfası**: rehber karakter eseri sesli ve altyazılı anlatır, kullanıcı ona
soru sorar → **Rozeti Al**: 5 kısa soru, 4 doğru = bilgi mührü → **ziyaret**: konum doğrulanınca mühür altın olur →
**Kayıp Vakfiye** pasaportu (10 eser = 10 yapboz parçası).

- Her tarihî bilgi **onaylı bir kayıttan** gelir ve kaynağı (kitap + sayfa) gösterilir; kesin olmayan bilgi öyle etiketlenir.
  Rehberin her cümlesi bir kayda bağlıdır; bağlanamayan cümle gösterilmez.
- **Yönetim paneli** (`/yonetim`): kitap PDF'inden aday kayıt çıkarma (alıntısı kitapta doğrulanır), elle ekleme ve
  düzenleme, kaynak sayfayla yan yana onay, kitaptan görsel, İngilizce çeviri onayı, anonim istatistik.
- **Türkçe ve İngilizce:** arayüz, içerik (kitabın İngilizce bölümünden, onaylı) ve anlatım. Tarihî içerikte makine
  çevirisi yoktur.
- Erişilebilirlik: altyazı ve tam metin, klavye, ekran okuyucu, büyük altyazı, hareket azaltma (axe taraması temiz).

## Hızlı başlangıç (geliştirme)

```bash
git clone git@github.com:senaOnenn/VAKIFNAME.git && cd VAKIFNAME
git switch feat/game                       # ana dal (main geride kaldı)

# Backend (Python 3.10+)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                      # seçenekler dosyada açıklamalı; gerçek anahtar yazılmaz
set -a && . ./.env && set +a && .venv/bin/uvicorn app.main:app --port 8000

# Frontend (ayrı terminal; Node 20.19+ veya 22.12+)
cd frontend
cp .env.example .env                      # VITE_API_BASE_URL=http://localhost:8000
npm ci && npm run dev                     # http://localhost:5173
```

> Arayüz API'ye **`localhost`** ile gitmeli: `127.0.0.1` tarayıcı için farklı sitedir ve oturum çerezi gönderilmez.

Örnek veri: `backend/tests/ask_eval/catalog_snapshot.json` (10 eser, onaylı kayıtlar). Fotoğraflar depoda yoktur
(`backend/tests/ask_eval/media/`); yoksa sayfalar görselsiz açılır.

### Testler

```bash
cd backend && .venv/bin/python -m pytest -q     # özel veri yoksa ilgili testler atlanır
cd frontend && npm test && npx tsc -b && npm run build   # build sonunda genel paket denetimi
```

Commit öncesi hepsi geçer. Commit mesajları İngilizce; `.env`, anahtar, veritabanı, PDF ve görsel eklenmez.

## Demo yedeği (finalde internet ya da sunucu giderse)

Dizüstünde canlıyla **aynı sürüm ve aynı içerik**, internetsiz açılır (karar 29 Ekim, A).

1. **İçeriği eşitle** (finalden önce ve içerik her değiştiğinde): `deploy/yedek/esitle.sh`
   Canlıdan temel katalog + görseller, içerik deposu (onaylı kayıtlar, kitaplar, kitap görselleri) ve anlatım sesleri
   `~/vakifname-yedek/` altına gelir. Kişisel veri (hesap, ilerleme, istatistik) gelmez. Çalışan servis durmaz.
2. **Hazır hesap** (Google girişi internetsiz çalışmaz):
   ```bash
   cd backend && set -a && . ~/vakifname-yedek/yedek.env && set +a
   .venv/bin/python -m app.account_cli --email <eposta> --name "Jüri"   # parola gizli sorulur; --reset ile yenilenir
   ```
3. **Aç:** `deploy/yedek/calistir.sh` → http://localhost:5173 (internet yokken `--hizli`: son derlemeyi kullanır).
4. **İnternetsiz ne olur:** eserler, görseller, anlatım (önceden üretilmiş sesler; yoksa tarayıcı sesi), sorular,
   ziyaret (sunum modu, ekranda "simülasyon" yazar) ve pasaport çalışır. Rota haritası karolar gelmezse önceden
   hazırlanmış ana yolları çizer. Rehber sohbeti kaynaklı aramaya düşer. Google girişi yerine hazır hesap kullanılır.
5. **Prova:** Wi-Fi kapalıyken uçtan uca bir tur (giriş → rota → eser → dinle → soru → Rozeti Al → ziyaret → pasaport).

## Canlı yayın

Sunucu, ters vekil ve güncelleme komutları: [`docs/CANLI_YAYIN.md`](docs/CANLI_YAYIN.md). Arayüz Mac'te derlenir ve
kopyalanır; sunucuda derleme yapılmaz. Çalışan diğer servislere dokunulmaz.

## Belgeler

| Belge | Konu |
|---|---|
| [`docs/ICERIK_YONETIMI.md`](docs/ICERIK_YONETIMI.md) | İçerik yönetimi API'si: kitap → aday → onay; elle ekleme; görseller; İngilizce |
| [`docs/SES_KAYDI.md`](docs/SES_KAYDI.md) | Rehber sesi: kayıt rehberi ve ses klonuyla üretim |
| [`docs/CANLI_YAYIN.md`](docs/CANLI_YAYIN.md) | Canlı ortam ve güncelleme |
| [`docs/DAHILI_VERI.md`](docs/DAHILI_VERI.md) | Ekibin dahili V20 veri katmanı ve editör onayı notları |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/NEMOTRON_REHBER.md`](docs/NEMOTRON_REHBER.md) | Ekibin mimari ve rehber notları |

## Rehber sesi

Anlatım, ekipten bir insan sesinin klonuyla **önceden üretilir** ve sunucuda yalnızca çalınır (ücretsiz; Chatterbox
Multilingual, MIT). Sesi kullanılan kişinin açık izni şarttır. Kayıt ve üretim adımları `docs/SES_KAYDI.md`;
sunucu ayarı `VAKIFNAME_TTS_PROVIDER=files` (`backend/.env.example`). Sesi olmayan cümlede tarayıcı sesi + altyazı.

## Klasör yapısı

```text
frontend/src/app/
  VakifnameApp.tsx                   Yönlendirme: açılış, tanıtım, giriş, şehir, rota, eserler, eser, rozet, pasaport, hesap, yönetim
  screens/, components/              Ekranlar ve bileşenler (palet: design/tokens.css)
  screens/admin/                     Yönetim: içerik, kitaptan aday, çeviri, istatistik
  i18n.tsx, i18n-en.ts, contentLang.ts   Dil seçimi, İngilizce sözlük, içeriğin dili
  narration.ts, speech.ts, lipsync.ts    Anlatım metni, ses, ağız senkronu
backend/app/
  public_catalog.py, monument_routes.py  Onaylı katalog (+ yöneticinin yayımladığı katman)
  route_engine.py, game.py, progress.py  Rota, oyun kademeleri, sorular, mühürler
  accounts.py, auth_routes.py            Hesaplar (e-posta+parola, Google, e-posta doğrulama)
  content/, content_routes.py            İçerik yönetimi ve kitap hattı
  guide/                                 Rehber (sağlayıcı: VAKIFNAME_GUIDE_PROVIDER)
  tts.py, speech_routes.py               Anlatım sesi
  stats.py, admin.py                     Anonim istatistik
backend/scripts/voice/                   Ses klonuyla toplu üretim (repo dışı ses ortamında çalışır)
deploy/                                  Canlı yayın şablonları, demo yedeği betikleri
```

## Giriş videosu (tanıtım sayfası)

Video depoda tutulmaz (`*.mp4`). Varsayılan dosya `../vakifname-video-assets/hero.mp4` (değiştirmek için
`VAKIFNAME_HERO_VIDEO=/yol/hero.mp4`); `npm run build` dosyayı `dist/media/hero.mp4`'e kopyalar, yoksa sayfa geçişli
zeminle açılır. CDN için `VITE_HERO_VIDEO_URL`. Mevcut video yapay zekâ ile üretilmiştir (dosyadaki C2PA manifesti);
gerçek bir eserin kaydı olarak sunulmaz.

## Ekip notları

### Zülal

Çalışma dalı: `feat/game` — oyun geliştirmeleri.

- Henüz güncelleme yok.
