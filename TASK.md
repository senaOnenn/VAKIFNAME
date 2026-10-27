# VAKIFNAME — Görev listesi

> Kurallar ve kararlar: `CLAUDE.md`. Bu dosya **yaşayan listedir**: bitenleri işaretle, yeni bulguyu ekle.
> Güncelleme: 27 Ekim 2026. Takvim: özellik dondurma **3 Kasım** (ekip kararı), geliştirme biter **7 Kasım**, final **7–8 Kasım**. 28 Ekim yarım gün, 29 Ekim tatil.
> İlke: kapsamı kısarız, **kaliteyi ve veri doğruluğunu kısmayız**. Sıkışırsak önce "güzel olsun" maddeleri düşer (⬇ ile işaretli).

## Durum özeti
- ✅ Backend sağlam: onaylı katalog (10 eser), kaynaklı olgular, sunucuda doğrulanan sorular, SQLite ilerleme, test süiti.
- ✅ Rehber hattı: sağlayıcı seçimi (`claude-cli` / `openrouter`), gerçek giriş kontrolü. **`feat/game`'e birleşti (2c16b4f).** Ana dal: `feat/game`.
- ❌ Arayüz: tek uzun sayfa, funnel yok, oyun yok, eser sayfası kitabi, giriş yok. **Baştan yapılacak.**
- ✅ Konum koordinatları onaylı (katalog). ❌ Check-in: yarıçap ve `gps_checkin` kararı yok (`checkin_available: false`); Faz 5'te.
- ❌ Hesap sistemi yok (tarayıcıda üretilen takma kimlik var).

## Karar bekleyenler (bunlar çözülmeden ilgili iş başlamaz)
| # | Konu | Öneri |
|---|---|---|
| K1 | ✅ **KARARLI (27 Ekim).** Eser başına **5 kısa soru**, **≥4 doğru (%80)** = rozet. Yanlışta farklı soru havuzundan tekrar. | — |
| K2 | **Karakterle "konuşulması" neyi kapsar?** (Akış 27 Ekim'de değişti: bu adım artık ilk kademe, ziyaret kilit değil.) | Anlatımı sonuna kadar dinlemek **+ en az 1 mesaj/soru**. (Sesi dinlemeyen/duyamayan için altyazıyı okumak da sayılır.) |
| K3 | **Karakterin sesi.** Önceden kaydedilmiş anlatım mı, canlı TTS mi? | Anlatım **önceden üretilir** (kalite + kontrol + lisans). Sohbet cevapları metin + tarayıcı `speechSynthesis` (opsiyonel dinle). |
| K4 | **Karakter görseli.** Tarihî karakter için hangi eserlerde figür var? | Eser başına `narrator` alanı: tarihî şahsiyet (Yıldırım Bayezid, Osman Gazi, Orhan Gazi, Cem Sultan, II. Murad) **veya** yerel rehber. Çizim/illüstrasyon dili; fotogerçekçi yüz yok. |
| K5 | ✅ **KARARLI (27 Ekim).** Şimdilik **mevcut görsellerle** devam. Sponsorun kaynağı Bursa'nın 3 ciltlik PDF'i; görselleri ayrı bir süreçte ayıklayıp geçeceğiz. | — (kullanım izni için organizatöre ayrıca sorulacak) |
| K6 | **Google ile giriş** için Google Cloud OAuth istemci kimliği. | Takım hesabından **bir OAuth Client ID** (Web) oluştur; `http://localhost:5173` ve canlı adres yetkili kaynak olarak eklenir. Anahtar repoya girmez. |
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
- Not: arayüz API'ye **`localhost:8000`** ile gitmeli (127.0.0.1 farklı site sayılır, çerez gitmez). Kapsam dışı: parola sıfırlama, e-posta doğrulama, profil düzenleme.

## Faz 3 — Eserler ve keşif ✅ (27 Ekim, dal `feat/discover`)
- [x] **Eserler sayfası** (`/eserler`): kart ızgarası (kapak + atıf satırı), şehir ve tür filtresi, liste/harita görünümü, oyun durumu rozetleri (kilitli, açık, bilgi mührü, altın mühür).
- [x] **Rota motoru (backend, `GET /route`):** başlangıç önceliği kullanıcı konumu (şehir merkezine 30 km içindeyse) → son tamamlanan eser → şehir merkezi; açık sınır her zaman `min(3, kalan)`, kilitler kalıcı (`unlocks` tablosu, yeniden kilitlenmez); yürüyüş sırası açgözlü en yakın komşu, eşitlikte kimlik sırası. 53 backend testi; misafir→hesap birleştirme ve hesap silme kilitleri de kapsar.
- [x] **Rota ekranı** (`/rota/:city`): Kayıp Vakfiye ilerlemesi (10 parça), sıradaki durak, sıralı duraklar ve kilitler, bulunan parçalar, "Konumumu kullan"; koyu tonlu OSM haritası ve rota çizgisi.
- [x] **Eser sayfası** (`/eser/:id`): görsel, ziyaret uyarısı, kaynaklı bilgiler (kesinlik etiketiyle: belgelenmiş / rivayet / kesin değil; kaynak sayfası) ve galeri (her görselde atıf + lisans).
- [x] Her görselde atıf/lisans satırı (mevcut görsellerle; PDF'ten ayıklama ayrı süreç, K5).
- Not (Faz 5): soru-cevap ucu kilide bakmıyor; kilitli eserin soruları API'den cevaplanabiliyor → Faz 5 "kilit atlatma" testinde kapatılacak.
- Not (ölçek): eski istemci doğrulayıcısı eser kimliğini `BUR-0000` biçimine kilitliyor (`catalog/catalogClient.ts`); yeni şehir eklenirken genelleştirilmeli. Bursa'ya özel başka sabitler: `getRoute('bursa', …)` çağrıları (eser ve eserler sayfası).

## Faz 4 — Eser sayfası: karakter anlatımı
- [ ] `narrator` alanı (tarihî karakter | yerel rehber) ve karakter varlıkları (illüstrasyon + konuşma animasyonu).
- [ ] **Anlatım:** onaylı `fact_id`'lerden derlenen kısa senaryo, ses + altyazı, ilerleme çubuğu, duraklat/hız, "canlandırma" etiketi.
- [ ] **Sohbet:** karakter ile mesajlaşma (mevcut `guide`), kaynaklı cümleler, kaynak yoksa dürüst cevap. "Esere Sor" arayüzden kaldırılır.
- [ ] İkinci katman: "Daha fazla" — tarihçe, mimari, kaynak sayfası, galeri.
- [ ] Erişilebilirlik: transkript, altyazı boyutu/kontrastı, sessiz mod.

## Faz 5 — Gerçek oyun: dinle → soru → ziyaretle altın
- [ ] **Kademe 1 — Dinle ve konuş:** anlatım bitince + en az 1 mesaj ⇒ küçük ödül (XP, yapboz parçası belirir). Sunucuda kayıtlı.
- [ ] **Kademe 2 — "Rozeti Al" → quiz:** çoktan seçmeli, görsel↔eser eşleştirme, doğru/yanlış. Sorular onaylı olgulardan (`game_use`). **5 soru, ≥4 doğru (%80)** ⇒ **Bilgi mührü**. Yanlışta farklı havuzdan tekrar. Doğru cevap istemciye gitmez.
- [ ] **Kademe 3 — Ziyaret:** konum doğrulaması (K7) ⇒ mühür **altın yaldızlı ve parlak** olur (**Ziyaret mührü**). "Demo modu" anahtarı açıkça etiketli (jüri evde de görebilsin).
- [ ] Ziyaret ve oyun adımından önce eserin `site_notice` uyarısı gösterilir (sessizlik, ibadet, ziyaret saatleri).
- [ ] **Rozet/mühür animasyonları:** bilgi mührü basılır, ziyaretle altına dönüşür (parlama), yapboz parçası yerine oturur.
- [ ] **Pasaport/yapboz:** 10 parça (bilgi mührüyle dolar); tamamlanınca "Kayıp Vakfiye bulundu". **Altın vakfiye** yalnızca tüm parçalar ziyaretle altınlaşınca.
- [ ] Testler: ziyaret olmadan altın mühür verilmez, kilit atlatma denemesi, tekrar rozet, %80 sınırı (4/5 geçer, 3/5 kalır).

## Faz 6 — Yönetim, istatistik, ölçek
- [ ] **İçerik ekleme/düzenleme** (şartname 5.1.1): yeni eser eklenince harita, rota ve karakter hattına düşer. Mevcut dahili inceleme araçları (`internal/`) tekrar kullanılır.
- [ ] **İstatistik:** ziyaretçi, eser görüntülenme, en çok ilgi gören; çerezsiz/anonim sayaç.
- [ ] Yeni şehir ekleme şeması (il alanı, eser, narrator). ⬇ 60–80 eserlik sponsor paketi gelince içe aktarma.
- [ ] ⬇ İngilizce katmanı (K9).

## Faz 7 — Cila, final hazırlığı
- [ ] Gerçek telefonda ve yavaş ağda tüm akış. Lighthouse/axe taraması.
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
