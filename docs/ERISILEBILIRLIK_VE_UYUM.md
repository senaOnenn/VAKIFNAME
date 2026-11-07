# Erişilebilirlik ve uyum (şartname maddeleri 10, 14–17)

> 7 Kasım 2026. Her satır çalışan üründeki karşılığıyla yazıldı; "kanıt" sütunu nereye bakılacağını gösterir.
> Canlı: https://calismalar.tikirsoft.com

## Madde 14 — Cihaza uygun okunabilirlik, gezinme ve etkileşim ✅

| Konu | Üründe | Kanıt |
|---|---|---|
| Duyarlı tasarım | Aynı bileşenler masaüstünde üst menü, telefonda alt sekme çubuğuyla çalışır | 360, 390 ve 1280 px'te 16 ekran tarandı; hiçbirinde yana kaydırma yok (7 Kasım) |
| Okunabilirlik | Yazılar en az 12 px; satır uzunluğu sınırlı; kitap metni ayrı "Tarih Defteri" yüzeyinde | Mobil denetimde 12 px altı yazılar düzeltildi |
| Dokunma | Düğmeler en az 24 px (çoğu 44 px) | Eser yolu, "Şifremi unuttum", Mühür Defteri adları büyütüldü |
| Telefonda akış | Cevaptan sonra açıklama ve "Sonraki soru" ekrana kayar; alt menünün arkasında kalmaz | `QuizPage.tsx` |
| Uygulama paketi | Android APK / iOS: madde 3'te ele alınacak | — |

## Madde 15 — Erişilebilirlik yaklaşımları ✅

Otomatik denetim: **axe-core 4.14, WCAG 2.0/2.1/2.2 A+AA kuralları**, 16 ekran × (TR masaüstü, TR telefon, EN masaüstü),
açılır pencereler (fotoğraf arşivi, Tarih Defteri, rehber, erişilebilirlik menüsü) dahil → **harita dışında 0 ihlal**.
Haritada tek bulgu kalır: aynı külliyedeki (Muradiye) işaretler üst üste biner (dokunma alanı, WCAG 2.5.8); WCAG 2.5.8'in "eşdeğer denetim" istisnası kapsamındadır, çünkü aynı sayfada her eser
liste olarak da seçilebilir.

| Yaklaşım | Üründe | Nerede |
|---|---|---|
| Ekran okuyucu | Anlamlı başlık sırası, "İçeriğe geç" bağlantısı, düğme/bağlantı adları, canlı bölgeler (doğru/yanlış sayacı, sonuçlar), açılır pencerelerde odak yönetimi | Tüm ekranlar |
| Alternatif metin | Her fotoğrafta alt metin; atıf ayrı satırda | Eser sayfası, fotoğraf arşivi, sorulardaki görseller |
| Yüksek kontrast | **Erişilebilirlik menüsü → Yüksek kontrast**: soluk metin tam fildişi, bağlantıların altı çizili, kalın odak halkası, görsel üstündeki metnin arkası koyu | Başlıktaki ♿ düğmesi |
| Yazı boyutu | **Normal / Büyük (%112,5) / Çok büyük (%125)**; düzen bozulmaz, dar ekranda başlık iki satıra iner | Aynı menü |
| Renk körlüğü | Anlam hiçbir yerde yalnız renkle verilmez: sorularda ✓/✗ ve "Doğru/Yanlış cevap" yazısı, mühürlerde durum yazısı, haritada farklı biçimler. Kırmızı-yeşil (döteranopi) ve mavi-sarı (tritanopi) taklidiyle kontrol edildi | Sorular, Mühür Defteri, harita |
| Sesli anlatım | Eser anlatımı ekip üyesi Zülal'in izinli ses klonuyla (TR); ses dosyası yoksa tarayıcı sesi | Eser sayfası → Rehber → Anlatım |
| Altyazı | Anlatım metni ekranda; tanıtım filminde TR/EN altyazı varsayılan açık | Rehber paneli, tanıtım filmi |
| Klavye | Bütün denetimler klavyeyle kullanılır; görünür odak halkası; Esc pencereleri kapatır ve odağı geri verir | Tüm ekranlar |
| Hareket | İşletim sisteminin "hareketi azalt" ayarı ve menüdeki **Hareketi azalt** seçeneği animasyonları kapatır | `design/a11y.css` |
| Süre sınırı (WCAG 2.2.1) | Sorularda 30 sn sınır var; menüdeki **Sorularda süre sınırı olmasın** ile kapatılabilir (sunucu da süre uygulamaz) | `a11y.ts`, `game_routes.py` |
| Dil | Arayüz ve onaylı içerik Türkçe/İngilizce; `lang` öznitelikleri doğru | TR/EN düğmesi |

Ayarlar yalnızca tarayıcıda saklanır (`localStorage`), sunucuya gitmez.

**Yapılmadı (dürüst not):** VoiceOver/TalkBack ile elle ekran okuyucu turu ve gerçek iPhone/Android cihaz denemesi.

## Madde 16 — Kişisel verilerin korunması (KVKK) ✅ (prototip düzeyinde)

Aydınlatma metni üründe: **/gizlilik** (7 Kasım'da rehber, istatistik ve cihazdaki ayarlar eklendi). İşlenen veriler:

| Veri | Neden | Koruma |
|---|---|---|
| E-posta, isteğe bağlı ad | Hesap, e-posta doğrulama, parola sıfırlama | Doğrulanmamış e-posta yönetici yetkisi almaz |
| Parola | Giriş | Yalnızca **scrypt** özeti (n=2^14, r=8, p=1, rastgele tuz); düz parola hiçbir yerde tutulmaz |
| Google hesap kimliği | Google ile giriş | Yalnızca kimlik ve doğrulanmış e-posta |
| Oturum | Girişin sürmesi | `vk_session` çerezi: HttpOnly, SameSite=Lax, HTTPS'te Secure, 30 gün; sunucuda yalnızca özeti |
| Oyun ilerlemesi | Mühür, XP, vakfiye | Kullanıcı kimliğine bağlı; **hesap sayfasından tamamen silinebilir** (`DELETE /auth/me`) |
| Konum | Ziyaret mührü | Yalnızca istek anında mesafe hesabı; **saklanmaz, loglanmaz** |
| Rehbere soru | Cevap üretmek | Yapay zekâ hizmetine (Anthropic Claude) gider; **bizde saklanmaz, loglanmaz** |
| Rehbere fotoğraf (isteğe bağlı) | Eseri tanımak | Yükleyen onay verir; yerelde iki yüz algılayıcıdan geçer, **yüz varsa hiç gönderilmez**; bellekte işlenir, saklanmaz; görsel tanıma OpenRouter üzerinden ücretsiz model |
| İstatistik | Sponsorun istediği ilgi ölçümü | Çerezsiz; IP ve tarayıcı bilgisi diske yazılmaz; yalnızca günlük sayaçlar |

**Açık noktalar (hukuki görüş gerekir, prototip kapsamı dışında):**
- Kurumsal KVKK aydınlatma metni ve veri sorumlusunun iletişim bilgisi (metin "yayın öncesi kurumun metniyle değiştirilmelidir" notunu taşıyor).
- Yapay zekâ hizmetleri yurt dışında çalışır (KVKK m. 9, yurt dışına aktarım). Rehber isteğe bağlıdır ve metinde yazılıdır; ürünleşirken açık rıza ya da yurt içi sağlayıcı (ör. Evren LLM API, anahtarı sunucuda hazır) değerlendirilmeli.
- Ücretsiz görsel tanıma uç noktaları gönderilen içeriği saklayabilir; bu yüzden yüz denetimi zorunlu ve metinde yazılı.

## Madde 17 — Üçüncü taraf içerik ve bileşenlerin kullanım hakkı ✅

| Bileşen | Hak / lisans | Uygulama |
|---|---|---|
| Eser bilgileri, kitap metni ve kitap fotoğrafları | Vakıf Eserleri Envanter Projesi yayınları (Bursa Cilt I–II); ekip kararı 29 Ekim: kitapların telifi sorun değil (biz projenin parçasıyız) | Her kayıtta kitap ve sayfa; her kitap fotoğrafında "Fotoğraf: Bursa Vakıf Eserleri Envanteri, Cilt X, s. N" |
| Wikimedia Commons fotoğrafları | CC BY / CC BY-SA (fotoğraf başına) | Her fotoğrafın altında fotoğrafçı, lisans ve kaynak |
| Harita verisi | © OpenStreetMap katkıcıları, ODbL | Atıf haritanın köşesinde |
| Yazı tipi Cormorant Garamond | SIL Open Font License 1.1 | Lisans dosyası `public/fonts/` |
| Seslendirme | Ekip üyesinin (Zülal) sesi, **açık izniyle**; Chatterbox Multilingual (MIT) ile yerelde üretildi | Tanıtım filminde "ekip üyemizin sesinden izniyle yapay zekâ ile üretildi" notu |
| Yüz algılama modelleri | UltraFace RFB-320 ve YuNet, MIT | Dosya özetleri kodda sabit (`guide/privacy.py`) |
| Yapay zekâ hizmetleri | Anthropic Claude (abonelik oturumu), OpenRouter ücretsiz model (sağlayıcı koşulları) | Ücretli modele geçiş kapalı (`VAKIFNAME_GUIDE_ALLOW_PAID_MODEL`) |

## Madde 10 — Açık kaynak lisans koşulları ✅

Yayın paketine giren 10 npm paketinin adı, sürümü ve **tam lisans metni** üründe yayımlanır:
**/acik-kaynak-lisanslari.txt** (aydınlatma metninden bağlantılı). Dosya `node scripts/third-party-notices.mjs` ile
`package-lock.json`'dan üretilir; bağımlılık değişince yeniden çalıştırılır.

| Ön yüz (yayına giren) | Lisans |
|---|---|
| react, react-dom, scheduler, react-router, react-router-dom, cookie, set-cookie-parser | MIT |
| leaflet | BSD-2-Clause |
| react-leaflet, @react-leaflet/core | **Hippocratic License 2.1** |

> **Dikkat — react-leaflet:** Hippocratic 2.1, OSI onaylı bir açık kaynak lisansı değildir; kullanımı insan haklarına ve
> çalışma haklarına aykırı olmama gibi etik koşullara bağlar. Kültürel miras tanıtımı bu koşullara uyar. Kurum yalnızca
> OSI lisansı isterse harita doğrudan Leaflet (BSD-2) ile yazılabilir (yaklaşık yarım gün).

| Sunucu (dağıtılmaz, sunucuda çalışır) | Lisans |
|---|---|
| fastapi, pydantic, PyJWT, onnxruntime, zeyrek, pytest | MIT |
| uvicorn, httpx, pypdf, numpy, torch | BSD-3-Clause |
| pillow | MIT-CMU (HPND) |
| transformers, sentence-transformers, tokenizers, safetensors, huggingface_hub | Apache-2.0 |
| Arama modelleri: intfloat/multilingual-e5-small, cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 | Model kartındaki lisans (MIT / Apache-2.0) |

Hiçbir bileşen GPL/AGPL gibi kaynak açma yükümlülüğü getiren bir lisans taşımıyor.
