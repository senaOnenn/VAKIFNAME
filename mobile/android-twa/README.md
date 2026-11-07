# VAKIFNAME Android (Trusted Web Activity)

Uygulama canlı siteyi (`https://calismalar.tikirsoft.com`) telefondaki Chrome ile tam ekran açar. Google girişi, konum
(ziyaret mührü; konum izni uygulama üzerinden istenir), kamera/fotoğraf ve ses sitedekiyle aynı çalışır; site
güncellemesi uygulamaya kendiliğinden gelir. Chrome yoksa uygulama içi WebView'a düşer.

- Paket: `com.tikirsoft.vakifname` · minSdk 26 · targetSdk 36 · AGP 9.5 · Gradle 9.8.2
- **Konum izni:** ilk açılışta `LauncherActivity` (bizim) izni uygulama ön plandayken bir kez sorar. Android 14+ arka
  plandaki uygulamanın pencere açmasını engellediği için (BAL_BLOCK) kütüphanenin site açıkken açtığı izin penceresi
  çıkmıyordu (Android 16'da görüldü, 7 Kasım). Reddedilirse bir daha sorulmaz; site şehir merkeziyle çalışır.
- Cihazda denendi (Samsung Galaxy A07, Android 16, Chrome 156, 7 Kasım): tam ekran açılış (adres çubuğu yok),
  Google ile giriş, konum izni ve rota konumu çalışıyor.
- İkon ve açılış ekranı şimdilik takım logosundaki lale amblemi (`res/drawable/ic_launcher_*`, `splash.xml`); tasarım
  gelince bu dosyalar değişir.
- Adres çubuğunun gizlenmesi için sitede `/.well-known/assetlinks.json` (kaynak: `frontend/public/.well-known/`) imza
  anahtarının SHA-256 parmak iziyle yayında olmalı. Anahtar değişirse iki yerde birlikte değişir.

## İmza anahtarı (repoda değil)

`~/vakifname-android/vakifname-upload.jks` (alias `vakifname`); parola macOS Anahtar Zinciri'nde
`vakifname/android-upload-key`. Parmak izi: `67:22:7C:FB:6F:CB:17:E1:1B:88:CA:58:7C:3F:E2:94:60:15:09:FF:1B:E0:51:05:D6:FB:D2:E3:F1:14:09:41`.
Anahtar kaybolursa aynı paket adıyla güncelleme yayımlanamaz: yedeği güvenli yerde tutulmalı.

## Derleme

```bash
cd mobile/android-twa
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" \
  VAKIFNAME_KEYSTORE="$HOME/vakifname-android/vakifname-upload.jks"
export VAKIFNAME_KEYSTORE_PASSWORD="$(security find-generic-password -s vakifname/android-upload-key -w)"
./gradlew --no-daemon assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

Yeni sürümde `app/build.gradle.kts` içindeki `versionCode` artırılır.
