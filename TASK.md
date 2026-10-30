# VAKIFNAME — Görev listesi

> Kurallar ve kararlar: `CLAUDE.md`. Bu dosya **yaşayan listedir**: bitenleri işaretle, yeni bulguyu ekle.
> Güncelleme: 29 Ekim 2026. Takvim: özellik dondurma **3 Kasım** (ekip kararı), geliştirme biter **7 Kasım**, final **7–8 Kasım**. 28 Ekim yarım gün, 29 Ekim tatil.
> İlke: kapsamı kısarız, **kaliteyi ve veri doğruluğunu kısmayız**. Sıkışırsak önce "güzel olsun" maddeleri düşer (⬇ ile işaretli).

## Durum özeti
- ✅ Backend sağlam: onaylı katalog (10 eser), kaynaklı olgular, sunucuda doğrulanan sorular, SQLite ilerleme, test süiti.
- ✅ Rehber hattı: sağlayıcı seçimi (`claude-cli` / `openrouter`), gerçek giriş kontrolü. **`feat/game`'e birleşti (2c16b4f).** Ana dal: `feat/game`.
- ✅ Yeni arayüz (Faz 1–5) ve istatistik (Faz 6) **`feat/game`'e birleşti (29 Ekim, f7f4f6f).**
- ✅ Konum koordinatları onaylı (katalog). ✅ Ziyaret mührü (yarıçap, sunum modu).
- ✅ Hesap sistemi (e-posta+parola, Google; Google yerelde 29 Ekim'de doğrulandı), e-posta doğrulama, parola sıfırlama.
- ✅ İçerik yönetimi (şartname 5.1.1), tanıtım sayfası, çok şehir, erişilebilirlik taraması — hepsi `feat/game`'de.
- ❌ Canlı yayın (`calismalar.tikirsoft.com`): DNS ve sunucu bekleniyor. ❌ Tanıtım videosu, sunum, sahada (telefon + GPS) deneme.

## Gözden geçirme gündemi (29 Ekim; teker teker karar verilir, karar çıkınca ilgili faz/madde güncellenir)
1. [x] **Konuşan karakter:** panel içinde video değil, sayfada beliren karakter; ağız hareketi sesle senkron. **Karar (29 Ekim): A — katmanlı 2D çizim karakter** (gövde, baş, göz kırpma, ~8 ağız şekli; sesin zaman bilgisine göre anlık ağız senkronu; hazır anlatımda ve sohbet cevabında çalışır). Yapay zekâ "konuşan kafa" videosu ve 3D avatar seçilmedi. **Çizim (29 Ekim): C — karakteri Claude sade vektörle (SVG) baştan çizer**; ekibin Çırak Kâşif karakter sayfası (`game/1. level-Çırak kaşif/`) kimlik referansıdır (kıvırcık saç ve kırmızı kurdele, krem gömlek, kırmızı kuşak, deri çanta, pusula). Varsayılan: yelek yeşil yerine palet A laciverdi + altın işleme (CLAUDE.md §5: yeşil yok); görünce değiştirilebilir.
2. [x] **Ses (29 Ekim): A — Google Cloud "Chirp 3 HD" hazır Türkçe sesi** (VAKIFNAME Google Cloud projesi). Ses sağlayıcısı rehberdeki gibi env ile seçilir; **ileride değiştirilebilir** (ör. ElevenLabs ile ekipten birinin sesi — şu an ücret ödenemiyor; Google ile ses klonlama satış onayı istiyor). Not: karakter genç bir kız; klonlanacak ses buna uygun seçilmeli.
3. [~] **Tanıtım videosu (29 Ekim): HyperFrames ile Claude üretir** (Faz 9). Web sitesi ekran görüntüsü yok; açılış ekranına gömülecek, harita üzerinde eserden esere yolculuk anlatan çizim üslubunda film (konuşan karakterle aynı vektör üslup, palet A, ~75 sn). Bilgiler yalnızca onaylı kayıtlardan, kaynağı ekranda. **Yerleşim: A** — açılış ekranında filmden 10–15 sn yazısız, sessiz döngü (bugünkü `hero.mp4` yerine) + "Tanıtım filmini izle" düğmesi tam filmi sesli ve altyazılı, ekranı kaplayan oynatıcıda açar; hareket azaltılmışsa oynamaz; mobil için küçük sürüm. **Tarihî kişiler: A** — uygulamadaki gibi portre madalyonuyla belirir, konuşmaz; rehber anlatır (K4 korunur).
4. [x] **Sunum içeriği (29 Ekim, onaylandı):** iskelet Faz 10'da. Telif bölümü "kaynak ve lisanslar" olur: envanter yayınları projenin kendi yayını (telif sorunu yok); üçüncü taraf görsellerde atıf, açık kaynak lisansları.
5. [x] **Demo yedeği (29 Ekim): A — tam yedek** (Faz 7 maddesi ayrıntılandı).
6. [x] **Canlı yayın + sahada deneme (29 Ekim):** sunucu **89.167.32.115** (Tıkır sunucusu); `calismalar.tikirsoft.com` A kaydı açıldı. Plan Faz 7 "Canlı yayın" maddesinde; sahada deneme HTTPS gerektirdiği için canlıdan sonra.
7. [x] **Diğer açık kararlar (29 Ekim):** rehberin adı şimdilik "Rehber"; kitap fotoğrafları A; İngilizce C (Faz 11); eski check-in ucu kaldırıldı; görsel adı açığı kabul. **Gözden geçirme tamamlandı.**

## 29 Ekim kararları
1. **İçerik yönetimi:** tek rol yönetici; hat (kitap PDF + eser → aday kayıtlar → taslak) + elle ekleme/düzenleme; onaysız hiçbir şey görünmez (CLAUDE.md §2.13).
2. **Yöneticiler:** takımın 4 üyesi (`VAKIFNAME_ADMIN_EMAILS`). Biri `mtalhaaygen@gmail.com`; diğer 3 e-posta bekleniyor.
3. **Rehber hesabı:** `talha.aygen@konzek.com` (tüm Mac geçti; Pro plan).
4. **Google girişi (K6):** OAuth istemcisi oluşturuldu; yetkili adres `https://calismalar.tikirsoft.com`. Kimlik yalnızca `.env` dosyalarında.
5. **Birleştirme:** Claude test geçen dalı `feat/game`'e birleştirip push'lar.
6. **Eski arayüz kodu silinir.**
7. **Final demosu sunucuda canlı** (`calismalar.tikirsoft.com`); yerel kurulum yedek.
8. Özellik dondurma **3 Kasım** kalır.
9. **Ses (K3):** bir ses seçilecek; o zamana kadar tarayıcı sesi + altyazı.
10. **E-posta doğrulama ve parola sıfırlama zorunlu.**
11. **Ziyaret yarıçapı: 50 m** (varsayılan; eski 35 m büyük yapılarda kapıdaki ziyaretçiyi dışarıda bırakıyordu). Drive'da önceki sayısal karar yok; ekip planı "gerçek GPS pilot eserlerde test edilir" diyor → sahada denenip gerekirse eser bazında ayar.
12. **Sunum modu finalde açık**, ekranda açıkça etiketli.
13. Rehberin adı: şimdilik **"Rehber"** kalır (29 Ekim, gündem 7a); isim sonra verilebilir.
14. **Kitap fotoğrafları (gündem 7b): A — içerik yönetimine "kitaptan görsel" adımı** (karar kapandı). Bulgu: kitap PDF'lerindeki fotoğraflar ayrı ayrı çıkarılabiliyor (Cilt I s.19–30: 36 görsel, büyükleri 1300–1800 px); telif sorunu yok. Wikimedia fotoğrafları kalır; kitap fotoğrafları onaylandıkça eklenir. Wikimedia dosyaları: `backend/tests/ask_eval/media/` (repoda yok), eşleşme ve atıf `catalog_snapshot.json`.
15. **İngilizce (gündem 7c): C — tam İngilizce** (Faz 11): arayüz + içerik (kitabın İngilizce bölümünden, alıntı doğrulamalı, yönetici onaylı) + İngilizce ses. Risk: 3 Kasım dondurmasına sığmayabilir; faz sırası ayrıca konuşulacak.
16. Tanıtım videosu → Faz 9.
17. **Küçük teknik (gündem 7d):** eski `POST /monuments/{id}/check-in` ucu **kaldırıldı** (ziyaret yalnızca `/visit`); "Rozeti Al" görsellerinin dosya adından tahmin edilebilmesi **önemsiz açık, kabul**.

## Karar bekleyenler (bunlar çözülmeden ilgili iş başlamaz)
| # | Konu | Öneri |
|---|---|---|
| K1 | ✅ **KARARLI (27 Ekim).** Eser başına **5 kısa soru**, **≥4 doğru (%80)** = rozet. Yanlışta farklı soru havuzundan tekrar. | — |
| K2 | ✅ **KARARLI (Faz 5'te uygulandı):** dinleme + en az 1 soru (rehber kapalıysa soru aranmaz). **Karakterle "konuşulması" neyi kapsar?** (Akış 27 Ekim'de değişti: bu adım artık ilk kademe, ziyaret kilit değil.) | Anlatımı sonuna kadar dinlemek **+ en az 1 mesaj/soru**. (Sesi dinlemeyen/duyamayan için altyazıyı okumak da sayılır.) |
| K3 | ◐ **VARSAYILAN UYGULANDI (Faz 4): tarayıcı seslendirmesi + altyazı.** **Karakterin sesi.** Önceden kaydedilmiş anlatım mı, canlı TTS mi? | Anlatım **önceden üretilir** (kalite + kontrol + lisans). Sohbet cevapları metin + tarayıcı `speechSynthesis` (opsiyonel dinle). |
| K4 | ✅ **KARARLI (27 Ekim):** anlatıcı her yerde yerel rehber; tarihî kişi portre kartıyla (`data/real_catalog/people.json`, `GET /monuments/{id}/people`). **Karakter görseli.** Tarihî karakter için hangi eserlerde figür var? | Eser başına `narrator` alanı: tarihî şahsiyet (Yıldırım Bayezid, Osman Gazi, Orhan Gazi, Cem Sultan, II. Murad) **veya** yerel rehber. Çizim/illüstrasyon dili; fotogerçekçi yüz yok. |
| K5 | ✅ **KARARLI (27 Ekim).** Şimdilik **mevcut görsellerle** devam. Sponsorun kaynağı Bursa'nın 3 ciltlik PDF'i; görselleri ayrı bir süreçte ayıklayıp geçeceğiz. | — (29 Ekim: izin gerekmez; yayınlar projenin kendi yayınları, CLAUDE.md §3) (eski not: kullanım izni için organizatöre ayrıca sorulacak) |
| K6 | ✅ **GELDİ ve yerelde çalışıyor (29 Ekim; yetkili kaynaklar `http://localhost`, `http://localhost:5173`, canlı adres).** **Google ile giriş** için Google Cloud OAuth istemci kimliği. | Takım hesabından **bir OAuth Client ID** (Web) oluştur; `http://localhost:5173` ve canlı adres yetkili kaynak olarak eklenir. Anahtar repoya girmez. |
| K7 | ✅ **KARARLI (27 Ekim).** Koordinatlar **onaylıdır**, katalogdakiler kullanılır; kendi eklediğimiz konum verisi yok. Kayıtlar: noktalar `backend/tests/ask_eval/catalog_snapshot.json`, adaylar `data/real_catalog/monument_research.json`, onay kararları sunucuda `review.sqlite3`. | Ziyaret (Faz 5) için eser başına yarıçap yapılandırılabilir olur; yakın eserler (Muradiye'de 4 eser, Osman/Orhan Gazi) çakışmasın diye küçük başlanır. Sahada ince ayar sonra. |
| K8 | ✅ **KARARLI (Faz 2'de uygulandı).** **Misafir ilerlemesi.** Üye olmadan toplanan rozetler giriş yapınca birleşir mi? | Evet: cihazdaki ilerleme girişte hesaba **birleştirilir**. |
| K9 | ✅ **KARARLI (29 Ekim): tam İngilizce, Faz 11 (altyapı 30 Ekim'de bitti).** **Yeni dil:** EN metinler nereden? | Ciltli yayınlar iki dilli; onaylı olgulara `text_en` alanı. Çeviri uydurma değil, kaynaktan. |

## Faz 0 — Zemin (önce)
- [ ] Bu iki dosyayı ekiple paylaş; eleştiri notu (ekran görüntülü, tek sayfa) hazırla.
- [~] Kararları K1–K9 üzerinden kapat: K1, K2, K4–K8 ✅; açık: K3 (ses seçilecek), K9 (İngilizce).
- [x] `frontend/src/design/tokens.css`: renk (**Palet A: gece laciverdi + altın**, CLAUDE.md §5), yazı tipi, boşluk, hareket süreleri, gölge.
- [x] Marka SVG'leri: gerek kalmadı; düğmeler ve süsler palet A ile kodla çizildi (yeşil yok). Web ve mobil aynı token'ları kullanır.
- [x] Eski arayüzden tutulanlar (api istemcisi, katalog/rehber istemcisi, tipler) ayrıldı; kalanı silindi (Faz 7).
- [x] Bilgi mimarisi ve ekranlar: Açılış · Tanıtım · Giriş/Kayıt · Şehir · Rota/Harita · Eserler · Eser · Rozeti Al · Pasaport/Vakfiye · Hesap · Yönetim (istatistik + içerik).

## Faz 1 — Tasarım sistemi ve iskelet (web + mobil)
- [x] Yönlendirme (`react-router-dom`) ve ilk ekran iskeletleri (`/`, `/giris`, `/sehir`, `/bursa` yer tutucu). Mobil alt sekme çubuğu + web üst menü (Keşfet, Eserler, Pasaport, Hesap) ✅; sayfa geçişinde en üste dönüş.
- [x] **Açılış animasyonu:** "VAKIFNAME" yazısı, ardından tanıtım sayfası (29 Ekim; önce doğrudan girişe gidiyordu); atlanabilir, `prefers-reduced-motion`'da statik.
- [x] **Giriş/Kayıt ekranı** (arayüz; sunucu yok, geçici oturum): Google ile devam, e-posta+parola, "üye olmadan keşfet". Parşömen/yeşil marka SVG'leri yerine düğmeler palet A ile kodla çizildi.
- [x] **Şehir seçimi:** Türkiye haritası (Natural Earth sınırı, palet A; 3,2 MB'lık parşömen PNG yerine ~7 KB SVG yol) + erişilebilir şehir kartları; Bursa açık, diğerleri "yakında".
- [x] Ortak bileşenler: düğme, kart, süs (girih), ikonlar, mühür, kilit, ilerleme, altyazılı anlatıcı, karakter sahnesi, yapboz, grafikler.
- [x] Ekran okuyucu, klavye, kontrast, yazı boyutu: bileşen seviyesinde; axe taraması temiz (Faz 7).

## Faz 2 — Hesap sistemi (backend + frontend) ✅ (27 Ekim, dal `feat/auth`)
- [x] Kullanıcı tablosu, parola özeti (stdlib scrypt), oturum çerezi `vk_session` (HttpOnly, SameSite=Lax, 30 gün; sunucuda yalnızca özet), oran sınırı (`VAKIFNAME_AUTH_RATE`).
- [x] **Google ile giriş:** kimlik belirteci **sunucuda doğrulanır** (PyJWT + Google JWKS); arayüzde Google'ın resmî düğmesi (GIS). [x] İstemci kimliği `.env`'lerde; Google düğmesi yerelde hatasız (29 Ekim). [ ] Canlı adreste deneme.
- [x] Misafir ilerlemesi girişte hesaba taşınır (K8 ✅): mühürde hesabınki kalır; çözülmemiş soruyu misafir çözdüyse o alınır.
- [x] Hesap kimliğiyle (`u-<uuid>`) tutulan ilerleme yalnızca o hesabın oturumuyla okunur/yazılır.
- [x] Aydınlatma metni sayfası (`/gizlilik`, sistemin gerçekte sakladığı verilere göre; yayın öncesi kurumun KVKK metniyle değiştirilmeli) ve hesap silme (KVKK: kişisel alanlar boşaltılır, oturum ve ilerleme silinir).
- [x] **Karar (27 Ekim, varsayılan):** parolalı kayıtta e-posta doğrulaması yok; bu yüzden Google aynı e-postalı hesaba bağlanınca doğrulanmamış parola silinir ve açık oturumlar kapatılır (önceden hesap ele geçirme önlemi).
- [x] Testler: backend 56 auth testi (toplam 530), frontend sahte auth sunucusuyla 17 akış testi; gerçek sunucuyla tarayıcıda uçtan uca (kayıt → yenileme → çıkış → yanlış parola → giriş → hesap silme) denendi.
- Not: arayüz API'ye **`localhost:8000`** ile gitmeli (127.0.0.1 farklı site sayılır, çerez gitmez). Kapsam dışı: profil düzenleme.
- [x] **E-posta doğrulama + parola sıfırlama (29 Ekim kararı, zorunlu; dal `feat/email-verify`).** Tek kullanımlık, süreli bağlantılar (doğrulama 24 saat, yenileme 30 dk; sunucuda yalnızca özet; belirteç adresin `#t=` parçasında, açılınca adres çubuğundan silinir); parola sıfırlanınca bütün oturumlar kapanır; "bu e-posta kayıtlı mı" sızdırılmaz (aynı 204, hesap araması arka planda). Doğrulanmamış e-posta yönetici olamaz. Doğrulanmış parolalı hesaba Google bağlanınca parola artık silinmez. Gönderim `VAKIFNAME_MAIL_BACKEND`: geliştirmede `file` (`.eml`), canlıda `smtp`. [ ] **Canlı için SMTP bilgisi gerekli** (sunucu, kullanıcı, parola dosyası, gönderen).

## Faz 3 — Eserler ve keşif ✅ (27 Ekim, dal `feat/discover`)
- [x] **Eserler sayfası** (`/eserler`): kart ızgarası (kapak + atıf satırı), şehir ve tür filtresi, liste/harita görünümü, oyun durumu rozetleri (kilitli, açık, bilgi mührü, altın mühür).
- [x] **Rota motoru (backend, `GET /route`):** başlangıç önceliği kullanıcı konumu (şehir merkezine 30 km içindeyse) → son tamamlanan eser → şehir merkezi; açık sınır her zaman `min(3, kalan)`, kilitler kalıcı (`unlocks` tablosu, yeniden kilitlenmez); yürüyüş sırası açgözlü en yakın komşu, eşitlikte kimlik sırası. 53 backend testi; misafir→hesap birleştirme ve hesap silme kilitleri de kapsar.
- [x] **Rota ekranı** (`/rota/:city`): Kayıp Vakfiye ilerlemesi (10 parça), sıradaki durak, sıralı duraklar ve kilitler, bulunan parçalar, "Konumumu kullan"; koyu tonlu OSM haritası ve rota çizgisi.
- [x] **Eser sayfası** (`/eser/:id`): görsel, ziyaret uyarısı, kaynaklı bilgiler (kesinlik etiketiyle: belgelenmiş / rivayet / kesin değil; kaynak sayfası) ve galeri (her görselde atıf + lisans).
- [x] Her görselde atıf/lisans satırı (mevcut görsellerle; PDF'ten ayıklama ayrı süreç, K5).
- Not (kapandı, Faz 5): kilitli eserin soru-cevap ucu artık kilide uyuyor.
- [x] Ölçek (29 Ekim, dal `feat/multi-city`): eser/kayıt kimliği her şehir koduna açık (`[A-Z]{3}-0000`, backend + istemci doğrulayıcısı); eser ve eserler sayfası kilidi eserin kendi şehrinin rotasından alır; şehir sayfası açık şehirleri ve eser sayısını katalogdan hesaplar.

## Faz 4 — Eser sayfası: karakter anlatımı ✅ (27 Ekim, dal `feat/narrator`)
- [x] Anlatıcı: **her eserde yerel rehber** = ekibin "Çırak Kâşif" karakter videosu (sessiz döngü, konuşurken oynar; `~/vakifname-video-assets/narrator-guide.mp4`, repoya girmez, Vite eklentisiyle sunulur). [x] Tarihî kişiler **portre kartıyla** (K4): 9 eserde kart (Muradiye Medresesi'nde ilgili kayıt yok); her kart yayımlanmış bir kayda bağlı, eşleşmeyen kart gösterilmez.
- [x] **Anlatım:** onaylı kayıtlardan derlenen metin (en fazla 6 bilgi, hikâye sırası, belgelenmişler önce); her tarihî cümle `fact_id`'ye bağlı ve kayıttan aynen; rivayet/kesin olmayan bilgi seste de belirtilir. Ses + altyazı, önceki/sonraki, hız, sessiz mod, "canlandırma" etiketi.
- [x] **Sohbet:** "Rehbere sor" mevcut `guide` hattına bağlı (kaynaklı cümleler, dayandığı kayıtlar); rehber kapalıysa dürüst bilgi. "Esere Sor" yeni arayüzde yok.
- [x] İkinci katman: tarihçe, kaynak sayfası, kesinlik etiketi, galeri (Faz 3).
- [x] Erişilebilirlik: tam metin (transkript), büyük altyazı, sessiz mod; ses otomatik başlamaz.
- **Karar (K3, varsayılan, 27 Ekim):** seslendirme tarayıcının Türkçe sesiyle (Web Speech API; lisans/anahtar gerektirmez). Türkçe ses yoksa altyazı kendiliğinden ilerler. Önceden üretilmiş stüdyo kaydı sonra eklenebilir.
- Not (kapandı, Faz 5): "dinledi" ve "sordu" olayları sunucuya kaydediliyor (`engagement`).

## Faz 5 — Gerçek oyun: dinle → soru → ziyaretle altın ✅ (27 Ekim, dal `feat/game-loop`)
- [x] **Kademe 1 — Dinle ve sor:** anlatımın sonuna kadar dinlenmesi ve rehbere en az 1 soru sunucuya kaydedilir (`engagement`). Rehber kapalıysa (veya yalnızca test kullanıcılarına açıksa) soru şartı aranmaz (K2 ✅).
- [x] **Kademe 2 — "Rozeti Al":** 5 soru (çoktan seçmeli, görsel seçme, "bu bilgi bu eserle mi ilgili" doğru/yanlış), **≥4 doğru = bilgi mührü** (K1). Sorular yalnızca onaylı `game_use` kayıtlardan; yanlış ifade uydurulmaz (doğru/yanlış, başka türdeki bir eserin kaydından gelir; eser adı geçen kayıt kullanılmaz). Cevaplar sunucuda; tek gönderim, süre aşımı, başkasının sınavı 403. Kilitli eserde sınav 403; eski soru-cevap ucu da kilide uyar.
- [x] **Kademe 3 — Ziyaret:** bilgi mühründen sonra; onaylı koordinata yarıçap içinde konum → **altın mühür**. Konum saklanmaz. **Sunum modu** (simülasyon) yalnızca `VAKIFNAME_VISIT_SIMULATION=on` iken ve açıkça etiketli.
- [x] Mühür animasyonları (basılma, altın parıltı), sonuçta soru soru açıklama + kaynak + kesinlik etiketi, yeniden deneme.
- [x] **Pasaport:** 10 parçalık Kayıp Vakfiye yapbozu (bilgi mührü = parça, ziyaret = altın) ve eser eser mühürler.
- [x] Testler: backend 93 oyun testi (sınır 4/5–3/5, kilit atlatma, sızıntı, süre, birleştirme/silme); frontend 9 akış testi; tarayıcıda gerçek sunucuyla uçtan uca (misafir → rota → dinle → sor → 5/5 → mühür → sunum modunda altın → pasaport → rota 3/10).
- Not (29 Ekim: varsayılan 50 m yapıldı): yarıçap bina merkezinden ölçülüyor (doğruluk 13–46 m); büyük yapılarda (Ulu Cami 55×69 m) kapıdaki ziyaretçi dışarıda kalabilir → **sahada ince ayar** gerek.
- Not (kapandı, 29 Ekim): eski `POST /monuments/{id}/check-in` ucu kaldırıldı; katalogdaki onaylı `checkin` noktası ve yarıçapı `/visit`te kullanılmaya devam eder.
- Not: sınavdaki görsel dosya adları genel katalogdaki görsellerle eşleştirilebilir (katalog açık olduğu sürece kaçınılmaz); gerekirse sınava özel geçici görsel adresleri.

## Faz 6 — Yönetim, istatistik, ölçek
- [x] **İçerik ekleme/düzenleme** (şartname 5.1.1; karar 29 Ekim, CLAUDE.md §2.13; tasarım + API: `docs/ICERIK_YONETIMI.md`; dal `feat/content-admin`).
  - [x] Backend: içerik deposu (SQLite; kaynak, eser, kayıt, görsel; yalnızca eklenen karar kaydı), PDF sayfa metni (pypdf), elle kayıt, onay/ret/geri çekme, yeni eser (`<ŞEHİR>-5001`…), görsel yükleme (yeniden kodlanır, EXIF atılır), yayın katmanı (`published.json`) → genel katalog yeniden başlatmadan yükler; rehber dizini kendiliğinden yenilenir. 17 test.
  - [x] Hat: kaynak + eser + ≤6 sayfa → model (`claude -p`) adayları → alıntı sayfada yoksa düşer → taslak. Gerçek deneme (29 Ekim, Cilt I s.20–23, Ulu Cami): 11,6 sn, 8 aday, hepsinin alıntısı kitapta doğrulandı; "mimarı kesin bilinmiyor" adayı `uncertain` etiketlendi.
  - [x] Yönetim ekranı (`/yonetim/icerik`): taslak kuyruğu, eserler (katalog + yeni; haritada konum), kaynak kitap yükleme (kullanım izni açık seçim), hat paneli (kitapta ara → sayfa aralığı → aday çıkar), kayıt düzenleyici (kaynak sayfa yanında, alıntı vurgulu ve görünür alana kaydırılmış), görseller. Yönetim formlarında doğrulama mesajları Türkçe.
  - [x] Tarayıcıda uçtan uca (29 Ekim, gerçek Cilt I, 245 sayfa): kitap 8 sn'de yüklendi → Ulu Cami s.20–23 → 8 taslak (15 sn, 0 düşen) → taslak genel uçta yok → onay → eser sayfasında "Kaynak: Bursa Vakıf Eserleri, Cilt I, s. 20" ve anlatım metninde.
  - Not: onaylı katalog (V20) eserlerinin kendisi salt okunur; yönetici bunlara kayıt/görsel ekler. V20 kaydını düzeltmek ekibin dahili aracıyla.
- [x] **İstatistik** (dal `feat/admin-stats`): çerezsiz/anonim günlük sayaçlar (tekil ziyaretçi, sayfa ve eser görüntüleme; IP/tarayıcı diske yazılmaz, günlük tuz yalnızca bellekte; Do Not Track/GPC'ye uyulur). Yönetici panosu `/yonetim` (yöneticiler `VAKIFNAME_ADMIN_EMAILS`): tarih aralığı, KPI, günlük ziyaretçi grafiği, en çok ilgi gören eserler, sayfalar, oyun hunisi (dinleyen → soran → bilgi mührü → ziyaret; sunum modu ayrı sayılır).
- [x] **Kitaptan görsel** (karar 14 = A; 29 Ekim, gerçek Cilt I ile tarayıcıda denendi: s.20'nin 2 fotoğrafı önizlendi → seçildi → yayımlandı → eser galerisinde "Görsel: Bursa Vakıf Eserleri, Cilt I, s. 20"; CMYK görseller doğru renkte): kaynak sayfadaki gömülü fotoğraflar önizlemeyle listelenir (küçük süs görselleri elenir) → yönetici esere ekler → atıf kendiliğinden "Vakıf Eserleri Envanteri, Cilt N, s. X" → taslak → onay → yayın. [ ] İlk seçim: Claude 10 eser için taslak hazırlar (kitaplar canlıya yüklenince).
- [~] Yeni şehir: kimlik şeması, rota ve şehir sayfası genel (29 Ekim). [ ] Yeni şehrin eserleri içerik yönetiminden girer. ⬇ 60–80 eserlik sponsor paketi gelince içe aktarma.
- [ ] İngilizce → Faz 11 (karar 15 = C).

## Faz 8 — Konuşan rehber (gündem 1–2, 29 Ekim kararları)
- [x] Yerleşim: dikdörtgen video paneli kalktı; karakter kartın üst kenarından taşarak sayfada belirir (masaüstünde balonun solunda, mobilde ortada), altyazı ona bakan konuşma balonu; konuşurken baş hafifçe sallanır, arkasında altın ışık; göz kırpar, nefes alır.
- [x] Karakter (29 Ekim, `GuideCharacter.tsx`): Çırak Kâşif'in sade vektör (SVG) çizimi — palet A, karakter sayfası kimlik referansı; katmanlar: gövde, baş, gözler (kırpma), 9 ağız şekli (Rhubarb A–H + X), nefes/duruş; sayfaya çerçevesiz girer (eser sayfasında anlatıcının yerine).
- [x] Ses sağlayıcısı (`app/tts.py`, `VAKIFNAME_TTS_PROVIDER` = `off` | `google`; seçenekler `.env.example`'da): Google Chirp 3 HD Türkçe (REST, API anahtarı dosyadan; ses `auto` = Türkçe Chirp 3 HD'lerden ilki). Yalnızca eserin onaylı anlatım cümlesi seslendirilir (karşılama/kapanış kalıbı ya da yayımlanmış kayıt metni); her cümle bir kez üretilir, önbellekten çalar; yeni üretim oran sınırlı. Kapalı/hata → tarayıcı sesi + altyazı. Kalıplar arayüzle birebir (test).
- [x] Ağız senkronu (29 Ekim teknik karar; `lipsync.ts`, tarayıcı sesiyle çalışıyor): **Türkçe yazıldığı gibi okunduğu için ağız şekilleri metinden** çıkarılır (harf → ağız şekli); zamanlama sesin ilerleyişinden (ses dosyasında oynatma anı + ses şiddeti, tarayıcı sesinde kelime sınırı olayları). Ek araç (Rhubarb) gerekmez; tarayıcı sesiyle de, Google sesiyle de, internetsiz de çalışır.
- [~] Anlatım sesi ilk dinlemede bir kez üretilir ve saklanır (metin değişince adı değişir, yeniden üretilir); bir sonraki cümle önceden istenir; ağız, sesin oynatma anından senkron. [ ] Rehber sohbet cevabının sesi (sonra). [ ] Anahtar gelince: sesi kulakla seçme, canlıda açma.
- [x] Erişilebilirlik (axe temiz): altyazı ve tam metin kalır; hareket azaltılmışsa karakter durağan, ses yine çalışır; ses otomatik başlamaz.
- [~] **Karar (30 Ekim): rehber sesi ekipten gerçek bir insan sesinin klonu, tamamen ücretsiz.** Araç Chatterbox Multilingual (MIT, Türkçe + İngilizce, bu Mac'te; `~/vakifname-voice/`, repo dışı). Deneme (Mac'in Yelda sesiyle): Türkçe telaffuz iyi ("Ulu" → "Olu" gibi), İngilizcede sona uydurma ek → her cümle Whisper ile yazıya dökülüp denetlenir, tutmazsa yeniden üretilir; cümle başına ~1 dk (M1). Google anahtarı gerekmez; Google sağlayıcısı yedek olarak kalır.
  - [x] Kayıt rehberi: `docs/SES_KAYDI.md` (model kaydın ilk 10 sn'sini kullanır → 2–3 dk kayıt, en iyi 10 sn seçilir; izin cümlesi; WhatsApp yok).
  - [ ] Sizden: Talha'nın ve arkadaşının kaydı (Drive, `ses-<isim>.m4a`).
  - [ ] Aday klipler → kör dinleme → seçim; sunucuda yalnızca önceden üretilmiş sesleri çalan sağlayıcı (`files`); toplu üretim + Whisper denetimi; sunucuya yükleme.

## Faz 9 — Tanıtım filmi (gündem 3)
- [ ] Senaryo + sahne listesi + metin (kurgu taslağı: Türkiye haritası → Bursa → Ulu Cami (rehber anlatır, kaynak ekranda, banisi portre madalyonuyla) → soru → bilgi mührü → Koza Han → Osman Gazi Türbesi → altın mühür → Kayıp Vakfiye → şehirlerin ışıkları → kapanış). Müzik ve metin onaya sunulur.
- [ ] Çizimler: Faz 8 karakteri + eser silüetleri (vektör, palet A); bilgiler yalnızca onaylı kayıtlardan.
- [ ] HyperFrames ile üretim (Node 22+, FFmpeg); seslendirme Faz 8 Google sesi; Türkçe altyazı (dosya ve gömülü sürüm).
- [ ] Çıktılar: tam film (16:9, sesli), açılış için 10–15 sn yazısız sessiz döngü (masaüstü + mobil küçük sürüm), kapak karesi.
- [ ] Tanıtım sayfası: arka plan döngüsü + "Tanıtım filmini izle" (ekranı kaplayan oynatıcı, altyazı, klavye ile kapatma).

## Faz 10 — Sunum (gündem 4; şartname 5.4)
- [ ] İskelet (onaylandı 29 Ekim): 1 açılış (film kesiti) · 2 problem ve hedef kullanıcı (5.2.1) · 3 çözüm (5.1.1) · 4 canlı demo ~5 dk: ziyaretçi akışı + yönetici kitaptan aday → onay → eser sayfasında canlı (5.4) · 5 veri kullanımı ve doğruluk (5.1.3, 5.2.2) · 6 mimari ve veri modeli (5.1.2) · 7 erişilebilirlik (5.1.4) · 8 güvenlik, test, kişisel veri (5.1.5) · 9 kaynak ve lisanslar · 10 yenilikçilik · 11 ölçek ve yol haritası · 12 takım (5.2.3) · 13 kapanış + soru.
- [ ] Konuşma metni + konuşmacı notları (4 üye; kim neyi anlatır).
- [~] Dakika dakika demo senaryosu + aksilik B planı — taslak `docs/SUNUM.md` (30 Ekim; konuşmacılar ekipçe).
- [~] Jüri soru-cevap kartları (~15): yapay zekâ uydurursa, konum taklidi, internet giderse, yeni şehir süresi, maliyet, KVKK … — 15 kart taslağı `docs/SUNUM.md`; ekip okuyup düzeltecek.
- [ ] Slaytlar: organizasyonun şablonu paylaşılınca.

## Faz 11 — İngilizce (karar 15 = C, tam)
- [x] Backend (30 Ekim, dal `feat/english-content`): kayıt/soru/eser için İngilizce alanlar ve yayın katmanı; çeviri kayıtları (kitabın İngilizce bölümünden alıntı doğrulamalı, onaylı); hattın İngilizce kipi; İngilizce "Rozeti Al" turu (yalnızca İngilizcesi onaylı kayıtlar, en az 2 metin sorusu; yetmezse Türkçeye düşer ve söyler); iki dilli seslendirme (İngilizce kalıplar + `VAKIFNAME_TTS_VOICE_EN`); İngilizce rehber (yalnızca onaylı İngilizce kayıtlar, her cümle kayıt kimliğiyle, kayıtta olmayan sayı atılır).
- [x] Arayüz (30 Ekim, `feat/english`): dil seçici (TR/EN, tarayıcı diline göre ilk seçim, kalıcı; erişilebilir ad görünen kısaltmayı içerir), ziyaretçi ekranlarının tüm metinleri sözlükten (~300 kayıt); tarih/sayı biçimi dile göre. Yönetim ekranları Türkçe kalır.
- [x] İçerik modeli: kayıt, soru ve eser için isteğe bağlı İngilizce alanlar (`title_en`, `text_en`, `en_page`, soru EN, `name_en`, `site_notice_en`, `lead_en`); rota ucunda `name_en`.
- [x] Hat ve yönetim: kitabın İngilizce bölümünden aday (alıntı doğrulamalı) → taslak → yönetici onayı; çeviri düzenleyicisi `/yonetim/icerik/ceviri/:factId` (İngilizce alıntı kaynak sayfada vurgulu), eser kartında İngilizce ad/uyarı, ana sayfada çeviri kuyruğu.
- [x] Kural: tarihî içerikte makine çevirisi yok; İngilizcesi onaylanmamış kayıt İngilizce arayüzde Türkçe metniyle ve "onaylı İngilizcesi henüz yok" notuyla (`lang="tr"`) gösterilir. Görsel atfında yalnızca etiketler çevrilir ("Photo:", "p.").
- [x] Anlatım ve rehber: İngilizce anlatım yalnızca onaylı İngilizce kayıtlardan; eserde hiç yoksa Türkçe anlatım çalar ve bu söylenir. Tarayıcıda İngilizce ses (en-US/en-GB), sunucu sesinde `lang`. Rehber İngilizce sorulur (`lang: en`).
- [x] "Rozeti Al" İngilizce istenir; yeterli onaylı İngilizce kayıt yoksa sorular Türkçe gelir ve ekranda söylenir.
- [ ] Gerçek içerik: kitapların İngilizce bölümlerinden 10 eser için çeviri adayları (kitaplar canlıya yüklenince; dondurmadan sonra içerik işi).

## Faz 7 — Cila, final hazırlığı
- [x] **Tanıtım sayfası** (29 Ekim, dal `feat/landing`): açılıştan sonra doğrudan giriş yerine ürünü tanıtan sayfa — sessiz arka plan videosu (`hero.mp4`, yoksa geçişli zemin), üç adım (rehber karakter videosu, bilgi ve altın mühür), Kayıp Vakfiye örneği, katalogdan 3 eser, kaynak/dürüstlük/vakar, iki çağrı. Hareket azaltılmışsa video oynamaz, bölümler hemen görünür. axe: ihlal yok.
- [~] Gerçek telefonda ve yavaş ağda tüm akış. Yavaş ağ ölçümü (30 Ekim, canlı, telefon görünümü, "Slow 4G" 1,6 Mbps/150 ms + işlemci ×4, soğuk önbellek): ilk içerik her sayfada ~2 sn (tanıtım, eserler, eser, rota); tanıtım sayfası 2,97 MB → 390 KB (dikey küçük video, veri tasarrufunda video yok, eski rehber videosu yerine çizim karakter), ağ 16,3 → 3,6 sn. [ ] Gerçek iPhone/Android'de deneme (saha testiyle).
- [x] axe taraması (29 Ekim; axe-core 4.14, WCAG 2.0/2.1/2.2 A+AA + iyi uygulama; web 1366 ve mobil 390; misafir, oturumlu kullanıcı ve yönetici sayfaları, 16 sayfa): giriş sekmesi rolü, Türkiye haritası rolü, eserler başlık sırası, rozet sayfasında h1, grafik gezgini (kaydırıcı rolü) düzeltildi. Kalan tek bulgu: rota haritasında Muradiye kümesindeki üst üste binen işaretler (hedef boyutu); WCAG 2.5.8 "eşdeğer kontrol" istisnası — aynı sayfadaki sıralı durak listesi aynı işi görür.
- [x] **Canlı yayın (test) — 29 Ekim:** `https://calismalar.tikirsoft.com` → 89.167.32.115, `/root/calismalar` (ayrıntı ve güncelleme komutları: `docs/CANLI_YAYIN.md`). Çalışan hiçbir servis durdurulmadı; nginx kesintisiz yeniden yüklendi. Duman testi: tanıtım, Google düğmesi, misafir → şehir → rota → eser, rehber cevabı (~10 sn, kaynaklı), pasaport. Alan adı değişebilir (yalnızca test).
  - [x] Salt okunur keşif: çalışan servisler, 80/443'ü kim kullanıyor, disk, Python/Node sürümleri.
  - [x] Arayüz Mac'te derlenir → rsync (sunucuda derleme yok); backend servis (systemd) yalnızca 127.0.0.1'de.
  - [x] Ters vekil: aynı adreste site + `/api` (çerez aynı site), HTTPS sertifikası.
  - [x] `api.env` (Google, yönetici, içerik dizini, sunum modu açık, güvenli çerez), `claude` (sunucuda zaten açık). [ ] SMTP, Google ses anahtarı (Faz 8), [ ] Google ile girişi canlıda yöneticinin denemesi.
  - [ ] Duman testi; ardından sahada deneme (Bursa: Ulu Cami, Muradiye kümesi, Koza Han; iPhone Safari + Android Chrome; konum, ses, yavaş ağ; yarıçap notları).
- [x] **Eski arayüz kodu silindi** (29 Ekim, dal `feat/remove-legacy-ui`): eski katalog sayfası, "Esere Sor", kurgusal demo oyunu ve bileşenleri, eski tarayıcı senaryoları (~8000 satır, 147 eski test). Dahili envanter (`?mod=envanter`, yalnızca geliştirme) kaldı. Backend demo uçları (`/places`, eski check-in) karar 17 beklediği için duruyor.
- [~] **Demo yedeği (karar A, tam):** salonda internet/sunucu/servis giderse demo sürer. (30 Ekim, dal `feat/voice-files`)
  - [x] Dizüstünde canlıyla aynı sürüm, tek komutla açılır: `deploy/yedek/calistir.sh` (derlenmiş arayüz :5173 + API :8000; `--hizli` internetsiz). README baştan yazıldı (ekibin V20 notları `docs/DAHILI_VERI.md`).
  - [x] Harita: karolar art arda yüklenemezse OSM verisinden önceden çıkarılmış ana yollar + nehir çizilir (12 KB, yalnızca gerekince iner, ODbL atfı), "Bağlantı yok" notu. Görsel yerine vektör: palete uyar, ölçekte bozulmaz.
  - [~] Rehber internetsiz: kaynaklı aramaya düşer (var); anlatım sesleri ses klonuyla önceden üretilir (`files` sağlayıcısı, eşitlemeyle dizüstüne gelir) — kayıtlar bekleniyor. Sohbet sesi yok (metin).
  - [x] Hazır e-posta+parola hesabı: `python -m app.account_cli` (doğrulanmış; parola gizli sorulur; `--reset`). [ ] Jüri hesabının e-postası/parolası ekipçe belirlenip hem canlıda hem dizüstünde açılacak.
  - [x] Eşitleme: `deploy/yedek/esitle.sh` canlıdan katalog + görseller, içerik deposu (çevrim içi SQLite yedeği, servis durmaz), sesler; kişisel veri gelmez. Denendi: internet kesik tarayıcıda giriş → rota (çevrimdışı harita) → eser → rehber çalıştı.
  - [ ] Telefon paylaşımı (hotspot) ilk yedek; akışın ekran kaydı yalnızca son çare (şartname: kayıt demo yerine geçmez).
  - [ ] Prova: Wi-Fi kapalı, uçtan uca (ekip ile).
- [ ] **Tanıtım videosu** (ürünün çalışma mantığı). Not: **HyperFrames** aracı videoyu kodla üretmek için araştırılabilir (şimdilik yalnızca not, araştırılmadı).
- [ ] Sunum: problem, hedef kullanıcı, mimari ve veri modeli, veri kullanımı, yenilik, ölçeklenebilirlik. Jüri soruları: veri doğruluğu, telif, kişisel veri.
- [ ] Özellik dondurma sonrası yalnızca hata düzeltme.

## Sorgulanacak (sonraya bırakılan)
- [ ] Katalogun kaynağı: yayın verisi `backend/tests/ask_eval/catalog_snapshot.json` (test dizini) — canlı katalog yolu ve editör onay zinciri doğrulanacak.
- [x] Sunucudaki `catalog.json` ile snapshot farkı (30 Ekim): aynı veri sürümü (V20:92dc…), 10 eser ve tüm kayıt metinleri birebir aynı; tek fark Yıldırım Bayezid Bedesteni'nin ilk görseli (canlıda başka bir Commons görseli). Yedek dizüstü canlıdan eşitlendiği için canlıyla aynıdır; yerel geliştirme snapshot'la kalabilir.
- [ ] RAG doğruluk/atıf testleri ve "kaynak yok" davranışı.
- [ ] Fotoğraflı rehber (yüz tarama bileşeni kurulu değil) — yeni tasarımda gerekiyor mu?
- [ ] Codex (ChatGPT hesabı) ve Anthropic API sağlayıcıları: `registry.py`'de planlı, yazılmadı.
