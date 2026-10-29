# VAKIFNAME — Görev listesi

> Kurallar ve kararlar: `CLAUDE.md`. Bu dosya **yaşayan listedir**: bitenleri işaretle, yeni bulguyu ekle.
> Güncelleme: 29 Ekim 2026. Takvim: özellik dondurma **3 Kasım** (ekip kararı), geliştirme biter **7 Kasım**, final **7–8 Kasım**. 28 Ekim yarım gün, 29 Ekim tatil.
> İlke: kapsamı kısarız, **kaliteyi ve veri doğruluğunu kısmayız**. Sıkışırsak önce "güzel olsun" maddeleri düşer (⬇ ile işaretli).

## Durum özeti
- ✅ Backend sağlam: onaylı katalog (10 eser), kaynaklı olgular, sunucuda doğrulanan sorular, SQLite ilerleme, test süiti.
- ✅ Rehber hattı: sağlayıcı seçimi (`claude-cli` / `openrouter`), gerçek giriş kontrolü. **`feat/game`'e birleşti (2c16b4f).** Ana dal: `feat/game`.
- ✅ Yeni arayüz (Faz 1–5) ve istatistik (Faz 6) **`feat/game`'e birleşti (29 Ekim, f7f4f6f).**
- ✅ Konum koordinatları onaylı (katalog). ✅ Ziyaret mührü (yarıçap, sunum modu).
- ✅ Hesap sistemi (e-posta+parola, Google). ❌ E-posta doğrulama, parola sıfırlama (29 Ekim kararı: zorunlu).
- ❌ İçerik yönetimi (şartname 5.1.1): karar verildi (29 Ekim, CLAUDE.md §2.13), yapılacak.

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
11. **Ziyaret yarıçapı:** konuşulacak (35 m duruyor).
12. **Sunum modu finalde açık**, ekranda açıkça etiketli.
13. Rehberin adı: açık.
14–17: beklemede (görsel ayıklama, İngilizce, tanıtım videosu, küçük teknik kararlar).

## Karar bekleyenler (bunlar çözülmeden ilgili iş başlamaz)
| # | Konu | Öneri |
|---|---|---|
| K1 | ✅ **KARARLI (27 Ekim).** Eser başına **5 kısa soru**, **≥4 doğru (%80)** = rozet. Yanlışta farklı soru havuzundan tekrar. | — |
| K2 | **Karakterle "konuşulması" neyi kapsar?** (Akış 27 Ekim'de değişti: bu adım artık ilk kademe, ziyaret kilit değil.) | Anlatımı sonuna kadar dinlemek **+ en az 1 mesaj/soru**. (Sesi dinlemeyen/duyamayan için altyazıyı okumak da sayılır.) |
| K3 | ◐ **VARSAYILAN UYGULANDI (Faz 4): tarayıcı seslendirmesi + altyazı.** **Karakterin sesi.** Önceden kaydedilmiş anlatım mı, canlı TTS mi? | Anlatım **önceden üretilir** (kalite + kontrol + lisans). Sohbet cevapları metin + tarayıcı `speechSynthesis` (opsiyonel dinle). |
| K4 | ✅ **KARARLI (27 Ekim):** anlatıcı her yerde yerel rehber; tarihî kişi portre kartıyla (`data/real_catalog/people.json`, `GET /monuments/{id}/people`). **Karakter görseli.** Tarihî karakter için hangi eserlerde figür var? | Eser başına `narrator` alanı: tarihî şahsiyet (Yıldırım Bayezid, Osman Gazi, Orhan Gazi, Cem Sultan, II. Murad) **veya** yerel rehber. Çizim/illüstrasyon dili; fotogerçekçi yüz yok. |
| K5 | ✅ **KARARLI (27 Ekim).** Şimdilik **mevcut görsellerle** devam. Sponsorun kaynağı Bursa'nın 3 ciltlik PDF'i; görselleri ayrı bir süreçte ayıklayıp geçeceğiz. | — (kullanım izni için organizatöre ayrıca sorulacak) |
| K6 | ✅ **GELDİ (29 Ekim).** **Google ile giriş** için Google Cloud OAuth istemci kimliği. | Takım hesabından **bir OAuth Client ID** (Web) oluştur; `http://localhost:5173` ve canlı adres yetkili kaynak olarak eklenir. Anahtar repoya girmez. |
| K7 | ✅ **KARARLI (27 Ekim).** Koordinatlar **onaylıdır**, katalogdakiler kullanılır; kendi eklediğimiz konum verisi yok. Kayıtlar: noktalar `backend/tests/ask_eval/catalog_snapshot.json`, adaylar `data/real_catalog/monument_research.json`, onay kararları sunucuda `review.sqlite3`. | Ziyaret (Faz 5) için eser başına yarıçap yapılandırılabilir olur; yakın eserler (Muradiye'de 4 eser, Osman/Orhan Gazi) çakışmasın diye küçük başlanır. Sahada ince ayar sonra. |
| K8 | ✅ **KARARLI (Faz 2'de uygulandı).** **Misafir ilerlemesi.** Üye olmadan toplanan rozetler giriş yapınca birleşir mi? | Evet: cihazdaki ilerleme girişte hesaba **birleştirilir**. |
| K9 | **Yeni dil:** EN metinler nereden? | Ciltli yayınlar iki dilli; onaylı olgulara `text_en` alanı. Çeviri uydurma değil, kaynaktan. |

## Faz 0 — Zemin (önce)
- [ ] Bu iki dosyayı ekiple paylaş; eleştiri notu (ekran görüntülü, tek sayfa) hazırla.
- [ ] Kararları K1–K9 üzerinden kapat (hepsi gerekmez; K1, K2, K5, K6 önce).
- [x] `frontend/src/design/tokens.css`: renk (**Palet A: gece laciverdi + altın**, CLAUDE.md §5), yazı tipi, boşluk, hareket süreleri, gölge.
- [ ] Marka SVG'leri (`game/vakifname_brand_assets`) çoğunlukla altın/krem, uyumlu; `uye_olmadan_kesfet.svg` içindeki yeşil (`#28584a`) yeni palete uyarlanır. Web ve mobil aynı token'ları kullanır.
- [ ] Eski arayüzden **tutulacaklar** (api client, tipler, harita bileşeni) ve **atılacaklar** (Hero, HowItWorks, PlaceCard vb. sayfalar) listesi.
- [ ] Bilgi mimarisi ve ekran listesi: Açılış · Giriş/Kayıt · Şehir · Rota/Harita · Eserler · Eser · Rozeti Al · Pasaport/Vakfiye · Hesap · (yönetim).

## Faz 1 — Tasarım sistemi ve iskelet (web + mobil)
- [x] Yönlendirme (`react-router-dom`) ve ilk ekran iskeletleri (`/`, `/giris`, `/sehir`, `/bursa` yer tutucu). Mobil alt sekme çubuğu + web üst menü (Keşfet, Eserler, Pasaport, Hesap) ✅; sayfa geçişinde en üste dönüş.
- [x] **Açılış animasyonu:** "VAKIFNAME" yazısı, ardından Giriş sayfasına geçiş; atlanabilir, `prefers-reduced-motion`'da statik.
- [x] **Giriş/Kayıt ekranı** (arayüz; sunucu yok, geçici oturum): Google ile devam, e-posta+parola, "üye olmadan keşfet". Parşömen/yeşil marka SVG'leri yerine düğmeler palet A ile kodla çizildi.
- [x] **Şehir seçimi:** Türkiye haritası (Natural Earth sınırı, palet A; 3,2 MB'lık parşömen PNG yerine ~7 KB SVG yol) + erişilebilir şehir kartları; Bursa açık, diğerleri "yakında".
- [~] Ortak bileşenler: düğme, kart, süs (girih), ikonlar ✅. [ ] rozet/mühür, kilit, ilerleme, altyazılı oynatıcı, karakter sahnesi (ilgili fazlarda).
- [ ] Ekran okuyucu, klavye gezinmesi, kontrast, yazı boyutu: **bileşen seviyesinde** başlangıçtan itibaren.

## Faz 2 — Hesap sistemi (backend + frontend) ✅ (27 Ekim, dal `feat/auth`)
- [x] Kullanıcı tablosu, parola özeti (stdlib scrypt), oturum çerezi `vk_session` (HttpOnly, SameSite=Lax, 30 gün; sunucuda yalnızca özet), oran sınırı (`VAKIFNAME_AUTH_RATE`).
- [x] **Google ile giriş:** kimlik belirteci **sunucuda doğrulanır** (PyJWT + Google JWKS); arayüzde Google'ın resmî düğmesi (GIS). [ ] **Canlı deneme için `VITE_GOOGLE_CLIENT_ID` + `VAKIFNAME_GOOGLE_CLIENT_ID` gerekli (K6).**
- [x] Misafir ilerlemesi girişte hesaba taşınır (K8 ✅): mühürde hesabınki kalır; çözülmemiş soruyu misafir çözdüyse o alınır.
- [x] Hesap kimliğiyle (`u-<uuid>`) tutulan ilerleme yalnızca o hesabın oturumuyla okunur/yazılır.
- [x] Aydınlatma metni sayfası (`/gizlilik`, sistemin gerçekte sakladığı verilere göre; yayın öncesi kurumun KVKK metniyle değiştirilmeli) ve hesap silme (KVKK: kişisel alanlar boşaltılır, oturum ve ilerleme silinir).
- [x] **Karar (27 Ekim, varsayılan):** parolalı kayıtta e-posta doğrulaması yok; bu yüzden Google aynı e-postalı hesaba bağlanınca doğrulanmamış parola silinir ve açık oturumlar kapatılır (önceden hesap ele geçirme önlemi).
- [x] Testler: backend 56 auth testi (toplam 530), frontend sahte auth sunucusuyla 17 akış testi; gerçek sunucuyla tarayıcıda uçtan uca (kayıt → yenileme → çıkış → yanlış parola → giriş → hesap silme) denendi.
- Not: arayüz API'ye **`localhost:8000`** ile gitmeli (127.0.0.1 farklı site sayılır, çerez gitmez). Kapsam dışı: profil düzenleme.
- [ ] **E-posta doğrulama + parola sıfırlama (29 Ekim kararı, zorunlu).** Tek kullanımlık, süreli bağlantılar (sunucuda yalnızca özet); parola sıfırlanınca bütün oturumlar kapanır; "bu e-posta kayıtlı mı" sızdırılmaz. Doğrulanmamış e-posta yönetici olamaz. Doğrulanmış parolalı hesaba Google bağlanınca parola artık silinmez. Gönderim: geliştirmede dosyaya, canlıda SMTP (sunucu bilgisi gerekecek).

## Faz 3 — Eserler ve keşif ✅ (27 Ekim, dal `feat/discover`)
- [x] **Eserler sayfası** (`/eserler`): kart ızgarası (kapak + atıf satırı), şehir ve tür filtresi, liste/harita görünümü, oyun durumu rozetleri (kilitli, açık, bilgi mührü, altın mühür).
- [x] **Rota motoru (backend, `GET /route`):** başlangıç önceliği kullanıcı konumu (şehir merkezine 30 km içindeyse) → son tamamlanan eser → şehir merkezi; açık sınır her zaman `min(3, kalan)`, kilitler kalıcı (`unlocks` tablosu, yeniden kilitlenmez); yürüyüş sırası açgözlü en yakın komşu, eşitlikte kimlik sırası. 53 backend testi; misafir→hesap birleştirme ve hesap silme kilitleri de kapsar.
- [x] **Rota ekranı** (`/rota/:city`): Kayıp Vakfiye ilerlemesi (10 parça), sıradaki durak, sıralı duraklar ve kilitler, bulunan parçalar, "Konumumu kullan"; koyu tonlu OSM haritası ve rota çizgisi.
- [x] **Eser sayfası** (`/eser/:id`): görsel, ziyaret uyarısı, kaynaklı bilgiler (kesinlik etiketiyle: belgelenmiş / rivayet / kesin değil; kaynak sayfası) ve galeri (her görselde atıf + lisans).
- [x] Her görselde atıf/lisans satırı (mevcut görsellerle; PDF'ten ayıklama ayrı süreç, K5).
- Not (Faz 5): soru-cevap ucu kilide bakmıyor; kilitli eserin soruları API'den cevaplanabiliyor → Faz 5 "kilit atlatma" testinde kapatılacak.
- [x] Ölçek (29 Ekim, dal `feat/multi-city`): eser/kayıt kimliği her şehir koduna açık (`[A-Z]{3}-0000`, backend + istemci doğrulayıcısı); eser ve eserler sayfası kilidi eserin kendi şehrinin rotasından alır; şehir sayfası açık şehirleri ve eser sayısını katalogdan hesaplar.

## Faz 4 — Eser sayfası: karakter anlatımı ✅ (27 Ekim, dal `feat/narrator`)
- [x] Anlatıcı: **her eserde yerel rehber** = ekibin "Çırak Kâşif" karakter videosu (sessiz döngü, konuşurken oynar; `~/vakifname-video-assets/narrator-guide.mp4`, repoya girmez, Vite eklentisiyle sunulur). [x] Tarihî kişiler **portre kartıyla** (K4): 9 eserde kart (Muradiye Medresesi'nde ilgili kayıt yok); her kart yayımlanmış bir kayda bağlı, eşleşmeyen kart gösterilmez.
- [x] **Anlatım:** onaylı kayıtlardan derlenen metin (en fazla 6 bilgi, hikâye sırası, belgelenmişler önce); her tarihî cümle `fact_id`'ye bağlı ve kayıttan aynen; rivayet/kesin olmayan bilgi seste de belirtilir. Ses + altyazı, önceki/sonraki, hız, sessiz mod, "canlandırma" etiketi.
- [x] **Sohbet:** "Rehbere sor" mevcut `guide` hattına bağlı (kaynaklı cümleler, dayandığı kayıtlar); rehber kapalıysa dürüst bilgi. "Esere Sor" yeni arayüzde yok.
- [x] İkinci katman: tarihçe, kaynak sayfası, kesinlik etiketi, galeri (Faz 3).
- [x] Erişilebilirlik: tam metin (transkript), büyük altyazı, sessiz mod; ses otomatik başlamaz.
- **Karar (K3, varsayılan, 27 Ekim):** seslendirme tarayıcının Türkçe sesiyle (Web Speech API; lisans/anahtar gerektirmez). Türkçe ses yoksa altyazı kendiliğinden ilerler. Önceden üretilmiş stüdyo kaydı sonra eklenebilir.
- Not (Faz 5): "dinledi" ve "sordu" olayları şimdilik yalnızca arayüzde; Kademe 1 için sunucuya kaydedilecek.

## Faz 5 — Gerçek oyun: dinle → soru → ziyaretle altın ✅ (27 Ekim, dal `feat/game-loop`)
- [x] **Kademe 1 — Dinle ve sor:** anlatımın sonuna kadar dinlenmesi ve rehbere en az 1 soru sunucuya kaydedilir (`engagement`). Rehber kapalıysa (veya yalnızca test kullanıcılarına açıksa) soru şartı aranmaz (K2 ✅).
- [x] **Kademe 2 — "Rozeti Al":** 5 soru (çoktan seçmeli, görsel seçme, "bu bilgi bu eserle mi ilgili" doğru/yanlış), **≥4 doğru = bilgi mührü** (K1). Sorular yalnızca onaylı `game_use` kayıtlardan; yanlış ifade uydurulmaz (doğru/yanlış, başka türdeki bir eserin kaydından gelir; eser adı geçen kayıt kullanılmaz). Cevaplar sunucuda; tek gönderim, süre aşımı, başkasının sınavı 403. Kilitli eserde sınav 403; eski soru-cevap ucu da kilide uyar.
- [x] **Kademe 3 — Ziyaret:** bilgi mühründen sonra; onaylı koordinata yarıçap içinde konum → **altın mühür**. Konum saklanmaz. **Sunum modu** (simülasyon) yalnızca `VAKIFNAME_VISIT_SIMULATION=on` iken ve açıkça etiketli.
- [x] Mühür animasyonları (basılma, altın parıltı), sonuçta soru soru açıklama + kaynak + kesinlik etiketi, yeniden deneme.
- [x] **Pasaport:** 10 parçalık Kayıp Vakfiye yapbozu (bilgi mührü = parça, ziyaret = altın) ve eser eser mühürler.
- [x] Testler: backend 93 oyun testi (sınır 4/5–3/5, kilit atlatma, sızıntı, süre, birleştirme/silme); frontend 9 akış testi; tarayıcıda gerçek sunucuyla uçtan uca (misafir → rota → dinle → sor → 5/5 → mühür → sunum modunda altın → pasaport → rota 3/10).
- Not: varsayılan 35 m yarıçap bina merkezinden ölçülüyor (doğruluk 13–46 m); büyük yapılarda (Ulu Cami 55×69 m) kapıdaki ziyaretçi dışarıda kalabilir → **sahada ince ayar** gerek.
- Not: eski `POST /monuments/{id}/check-in` (katalog `checkin` noktası olan eserlerde; şu an hiç yok) bilgi mührü aramıyor → yeni arayüz `/visit` kullanıyor; eski uç kaldırılabilir.
- Not: sınavdaki görsel dosya adları genel katalogdaki görsellerle eşleştirilebilir (katalog açık olduğu sürece kaçınılmaz); gerekirse sınava özel geçici görsel adresleri.

## Faz 6 — Yönetim, istatistik, ölçek
- [ ] **İçerik ekleme/düzenleme** (şartname 5.1.1) — **karar verildi (29 Ekim, CLAUDE.md §2.13).** Bulgu: ekibin dahili aracı yalnızca mevcut taslakları onaylayıp yayımlıyor; yeni eser ekleme/düzenleme ucu yok. Yapılacaklar:
  - [ ] İçerik deposu (SQLite): kaynak kitap, eser, kayıt (alıntı + sayfa + kesinlik), sınav sorusu; durum taslak/yayında; onay kaydı (kim, ne zaman). Mevcut onaylı katalog (V20) salt okunur temel olarak kalır; yayımlanan içerik onun üstüne eklenir.
  - [ ] Hat: PDF yükle → sayfa metni → eser + sayfa aralığı seç → rehber modeli (`claude -p`) aday kayıt önerir → alıntı sayfada birebir yoksa aday düşer → taslak.
  - [ ] Yönetim ekranı: kitaplar, eserler (haritada konum seçimi), taslak kuyruğu (kaynak sayfa metniyle yan yana), elle ekle/düzenle, onayla/yayımla, geri çek.
  - [ ] Yayımlanan içerik eser sayfası, anlatım, rota, sınav ve rehbere düşer.
- [x] **İstatistik** (dal `feat/admin-stats`): çerezsiz/anonim günlük sayaçlar (tekil ziyaretçi, sayfa ve eser görüntüleme; IP/tarayıcı diske yazılmaz, günlük tuz yalnızca bellekte; Do Not Track/GPC'ye uyulur). Yönetici panosu `/yonetim` (yöneticiler `VAKIFNAME_ADMIN_EMAILS`): tarih aralığı, KPI, günlük ziyaretçi grafiği, en çok ilgi gören eserler, sayfalar, oyun hunisi (dinleyen → soran → bilgi mührü → ziyaret; sunum modu ayrı sayılır).
- [~] Yeni şehir: kimlik şeması, rota ve şehir sayfası genel (29 Ekim). [ ] Yeni şehrin eserleri içerik yönetiminden girer. ⬇ 60–80 eserlik sponsor paketi gelince içe aktarma.
- [ ] ⬇ İngilizce katmanı (K9).

## Faz 7 — Cila, final hazırlığı
- [ ] Gerçek telefonda ve yavaş ağda tüm akış. Lighthouse/axe taraması.
- [ ] **Canlı yayın** (29 Ekim kararı): `https://calismalar.tikirsoft.com` sunucusunda; sunucuda `claude` girişi, SMTP, `.env`. Sunucuya dokunmadan önce plan + onay.
- [ ] **Eski arayüz kodunu sil** (29 Ekim kararı): yönlendirilmeyen eski katalog sayfası, "Esere Sor" bileşenleri.
- [ ] Demo yedeği: internet yoksa yerel çalışsın. Tek komutla kurulum (README).
- [ ] **Tanıtım videosu** (ürünün çalışma mantığı). Not: **HyperFrames** aracı videoyu kodla üretmek için araştırılabilir (şimdilik yalnızca not, araştırılmadı).
- [ ] Sunum: problem, hedef kullanıcı, mimari ve veri modeli, veri kullanımı, yenilik, ölçeklenebilirlik. Jüri soruları: veri doğruluğu, telif, kişisel veri.
- [ ] Özellik dondurma sonrası yalnızca hata düzeltme.

## Sorgulanacak (sonraya bırakılan)
- [ ] Katalogun kaynağı: yayın verisi `backend/tests/ask_eval/catalog_snapshot.json` (test dizini) — canlı katalog yolu ve editör onay zinciri doğrulanacak.
- [ ] Sunucudaki `catalog.json` (daha yeni) ile snapshot farkı.
- [ ] RAG doğruluk/atıf testleri ve "kaynak yok" davranışı.
- [ ] Fotoğraflı rehber (yüz tarama bileşeni kurulu değil) — yeni tasarımda gerekiyor mu?
- [ ] Codex (ChatGPT hesabı) ve Anthropic API sağlayıcıları: `registry.py`'de planlı, yazılmadı.
