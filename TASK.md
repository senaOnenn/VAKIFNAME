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
| K8 | **Misafir ilerlemesi.** Üye olmadan toplanan rozetler giriş yapınca birleşir mi? | Evet: cihazdaki ilerleme girişte hesaba **birleştirilir**. |
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

## Faz 2 — Hesap sistemi (backend + frontend)
- [ ] Kullanıcı tablosu, parola özeti (argon2/bcrypt), oturum çerezi (HttpOnly, SameSite), oran sınırı.
- [ ] **Google ile giriş:** kimlik belirtecini **sunucuda doğrula** (istemciye güvenme); hesapları e-posta ile eşleştir.
- [ ] Misafir ilerlemesinin girişte birleştirilmesi (K8).
- [ ] KVKK/aydınlatma metni ve veri silme isteği (hesap silme).
- [ ] Testler: kayıt, giriş, Google belirteci (sahte doğrulayıcıyla), oturum süresi, yetkisiz erişim.

## Faz 3 — Eserler ve keşif
- [ ] **Eserler sayfası:** kart ızgarası, şehir ve tür filtresi, harita görünümü, kilit durumu.
- [ ] **Rota motoru (backend):** kullanıcı konumu → rozetsiz eserleri uzaklığa göre sırala; ilk 3 açık, her rozetten sonra bir kilit açılır. Konum yoksa şehir merkezinden sırala. Birim testli.
- [ ] Görsele tıklayınca eser bilgisi (toplantı önerisi).
- [ ] Her görselde atıf/lisans satırı (mevcut görsellerle; PDF'ten ayıklama ayrı süreç, K5).

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
