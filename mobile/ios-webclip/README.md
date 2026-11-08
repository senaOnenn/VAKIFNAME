# iOS: VAKIFNAME ana ekran uygulaması (8 Kasım)

Bu Mac'te Xcode yok; yerel bir iOS uygulaması derlenemedi (ücretsiz Apple hesabıyla da 7 günde süresi dolar; Google ile
giriş uygulama içi tarayıcıda engellenir). Bunun yerine site iPhone'da **uygulama gibi** açılır: ana ekranda lale
ikonu, Safari arayüzü olmadan tam ekran.

- Site: `frontend/public/manifest.webmanifest`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`;
  `index.html`'de `apple-mobile-web-app-capable`, durum çubuğu `black`, başlık VAKIFNAME. İkon Android uygulamasındaki
  lale amblemi (`mobile/android-twa/.../ic_launcher_foreground.xml` → `vakifname-ikon.svg`).
- **Kurulum 1 (herkes):** iPhone'da Safari → calismalar.tikirsoft.com → Paylaş → Ana Ekrana Ekle.
- **Kurulum 2 (kabloyla):** `VAKIFNAME.mobileconfig` (Web Clip profili, tam ekran; başka ayar değiştirmez, imzasız →
  "Doğrulanmamış" uyarısı beklenir). iPhone Mac'e bağlı, kilit açık, "Güven" + parola:
  `pymobiledevice3 profile install VAKIFNAME.mobileconfig` (araç: `python3 -m venv ~/vakifname-ios/.venv` +
  `pip install pymobiledevice3`) → telefonda Ayarlar → "Profil İndirildi" → Yükle. AirDrop ile de gönderilebilir.
- 8 Kasım: Talha'nın iPhone'unda (iOS 26.4.1) kuruldu ve açıldı.
