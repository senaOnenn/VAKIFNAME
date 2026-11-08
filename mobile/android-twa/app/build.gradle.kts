// VAKIFNAME Android uygulaması (7 Kasım): Trusted Web Activity. Canlı siteyi (SITE_HOST) Chrome ile tam ekran açar;
// Google girişi, konum, kamera ve ses sitedekiyle aynı çalışır, site güncellemesi uygulamaya kendiliğinden gelir.
// İmza anahtarı repoda değildir: VAKIFNAME_KEYSTORE (dosya) ve VAKIFNAME_KEYSTORE_PASSWORD ortam değişkenleri (bkz. README).
plugins {
    id("com.android.application")
}

val siteHost = "calismalar.tikirsoft.com"
val keystore: String? = System.getenv("VAKIFNAME_KEYSTORE")

android {
    namespace = "com.tikirsoft.vakifname"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.tikirsoft.vakifname"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "1.0.2"
        manifestPlaceholders["hostName"] = siteHost
        manifestPlaceholders["defaultUrl"] = "https://$siteHost/"
    }

    signingConfigs {
        create("release") {
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = System.getenv("VAKIFNAME_KEYSTORE_PASSWORD")
                keyAlias = "vakifname"
                keyPassword = System.getenv("VAKIFNAME_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("release") else null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
    implementation("com.google.androidbrowserhelper:locationdelegation:1.1.2")
}
