# VAKIFNAME — Claude çalışma kuralları

> Bu dosya her oturumun başında okunur. Görev listesi için `TASK.md`. Kararlar değişirse önce burası güncellenir.

## 1. Proje nedir
**VAKIFNAME**, Vakıf Katılım'ın **Vakıf Eserleri Envanter Projesi** için yapılan bir **tanıtım ve keşif platformudur** (KÖK&KOD Hackathon, takım HisGuard).
Envanter projesi: Hatay (117 eser, 2022), Konya (289, 2024), Bursa (385) ve Kütahya (141) (2025), İzmir ve Manisa (2026 başladı). İki yıl süren, Türkçe/İngilizce, ciltli yayınlar.
**Amaç:** Bu yayınlardaki eserleri herkes için ulaşılabilir kılmak ve insanları eserleri **yerinde ziyarete** teşvik etmek. Oyunlaştırma bunun **aracıdır**, amaç değildir.
**Kapsam:** Bursa yalnızca pilot. Ürün, başarılı olursa tüm Türkiye ve turistler için büyüyecek şekilde kurulur. Arayüzde, logoda ve metinlerde "Bursa'ya özel" ifade **kullanılmaz** (örn. "Gerçek Bursa Eserleri" yasak). Şehir bir veri alanıdır.

## 2. Ürün vizyonu (ekibin kararları; klasördeki eski kararları ezer)
1. **Funnel önce gelir.** Siteyi açan kişi ilk 5 saniyede ne olduğunu anlamalı ve içine çekilmeli. Uzun metinli tek sayfa yasak.
2. **Akış:** Açılış animasyonu (VAKIFNAME yazısı, atlanabilir) → **Tanıtım** (29 Ekim: ürün ne, üç adımda nasıl oynanır, Kayıp Vakfiye, örnek eserler, güvenilir bilgi; "Keşfe başla" / "Üye olmadan göz at"; uzun metin yok) → Giriş/Kayıt (+ Google, + "üye olmadan keşfet") → Şehir seçimi (Türkiye haritası, Bursa açık, diğerleri "yakında") → Rota → Eser → Rozet.
3. **Eserler ayrı sayfada** (Keşfet/Eserler: liste, harita, şehir ve tür filtresi). Ana sayfa eser kataloğu değildir.
4. **Eser sayfası kitabi bilgiyle açılmaz.** Eseri **animasyonlu bir karakter** anlatır. **Karar (K4, 27 Ekim):** anlatıcı her eserde **yerel rehberdir** (ekibin Çırak Kâşif karakteri); tarihî kişi adına konuşulmaz, yalnızca **portre kartıyla** görünür ("Eserin banisi", "Burada yatıyor", "Yeniden yaptıran"; baş harf madalyonu, kartta onaylı kaydın metni ve kaynağı). **Sesli ve altyazılı.** **Karar (29 Ekim, Faz 8):** karakter çerçevesiz, sayfada beliren katmanlı vektör çizimdir; ağzı sesle senkron oynar. **Ses (30 Ekim kararı):** ekipten gerçek bir insan sesinin klonu, ücretsiz (Chatterbox Multilingual, yerelde önceden üretilir; kayıt rehberi `docs/SES_KAYDI.md`; sesi kullanılan kişinin açık izni şart). Google Chirp 3 HD yedek sağlayıcıdır (env). Ses yoksa tarayıcı sesi + altyazı. **8 Kasım (Talha):** Zülal'in klon sesi kaldırıldı (anlatım dosyaları silindi, `VAKIFNAME_TTS_PROVIDER=off`; tanıtım filmi sessiz ve altyazılı). Anlatım tarayıcı sesi + altyazıyla sürer; yeni izinli ses gelirse aynı hat kullanılır. Ayrıntılı, kaynaklı bilgi ikinci katmandır ("Daha fazla / Kaynaklar"), gizlenmez (bkz. §4).
5. **"Esere Sor" kaldırılır.** Yerine kullanıcı karakterle **konuşur/mesajlaşır** (mevcut rehber hattı: `guide`).
6. **Oyun akışı (27 Ekim kararı): kademeli ödül, ziyaret en üst kademe.** Ziyaret en zor adım olduğu için ilk kapı **değildir**; herkes online döngüye girer, ziyaret "daha değerli olanı al" hedefidir:
   (a) **Dinle ve konuş:** karakter anlatımı + en az 1 mesaj → küçük ödül (XP, yapboz parçası belirir).
   (b) **Rozeti Al → kısa sorular** (çoktan seçmeli, eşleştirme görsel↔eser, doğru/yanlış): eser başına **5 soru, ≥4 doğru (%80)** → **Bilgi mührü** (indigo/gümüş). **7 Kasım:** her cevap anında değerlendirilir (doğru şık cevaptan sonra açıklanır), doğru/yanlış sayısı görünür; her sorunun süresi **30 sn**'dir (sunucu da sayar), süre dolarsa soru yanlış sayılır.
   (c) **Eseri ziyaret et** (konum doğrulaması) → mühür **altın yaldızlı, parlak** hâle gelir: **Ziyaret mührü**.
   Backend zaten iki mührü ayırır (`knowledge` ve `visit`, `backend/app/progress.py`).
7. **Rota:** kullanıcıya **en yakın, rozeti alınmamış** eser **önerilir**; rozet alınınca sıradaki en yakın gelir. Başlangıçta en yakın **3 eser açık**, kalanlar kilitli; her bilgi mührü sonrası bir kilit açılır. Rota yönlendirmedir, ziyaret kilidi değildir.
8. **Kayıp Vakfiye:** pilotta 10 eser = 10 yapboz parçası. Parça bilgi mührüyle (online) kazanılır; 10 parça = vakfiye tamamlanır. **Altın vakfiye** (tüm parçalar altın) yalnızca ziyaretle gelir, böylece ziyaret için sebep kalır.
9. **Login:** kendi mekanizmamız (e-posta+parola) **ve Google ile giriş**. Üye olmadan keşfetmek de mümkün (misafir).
10. **İki tasarım:** web (responsive) ve mobil. Aynı bileşenler ve veri; farklı yerleşim.
11. **İstatistik:** ziyaretçi sayısı, eser görüntülenme, en çok ilgi gören eserler (sponsor istedi). Kişisel veri tutmadan.
12. **Dil:** Türkçe ve İngilizce (sponsor yayınları iki dilli). **Karar (29 Ekim): tam İngilizce** — arayüz, içerik (kitabın İngilizce bölümünden, alıntı doğrulamalı ve yönetici onaylı) ve ses. Tarihî içerikte makine çevirisi kullanılmaz.
13. **İçerik yönetimi (29 Ekim kararı).** Tek rol vardır: **yönetici** (ayrı bir editör yok; onayı yönetici verir). İçerik iki yoldan girer:
   (a) **Hat (pipeline):** yönetici kitabı (PDF) ve eseri ekler → hat sayfa metnini çıkarır, eser için kayıt adayları üretir (her aday kitaptaki alıntısı ve sayfasıyla; alıntı o sayfada yoksa aday düşer) → adaylar **taslak** olur.
   (b) **Elle:** yönetici eser ve kayıt ekler/düzenler; kaynak (kitap + sayfa) zorunludur.
   Her iki yolda da taslak, yönetici kaynak sayfayla yan yana görüp **onaylayana kadar** hiçbir yerde (eser sayfası, anlatım, rehber, sınav) görünmez. Düzenlenen kayıt yeniden onaylanır; kimin ne zaman onayladığı kayıtlıdır.
   Yöneticiler `VAKIFNAME_ADMIN_EMAILS` listesindeki **doğrulanmış** e-postalardır (takımın 4 üyesi).

## 3. Sponsor ve jüri beklentileri (şartname + 23 Ekim toplantısı)
- **Çalışan MVP şart.** Statik tasarım, mock-up, ekran görüntüsü ana ürün sayılmaz; temel akışlar final sırasında **uçtan uca canlı** gösterilir.
- **Zorunlu işlevler (şartname 5.1.1):** birden fazla eser keşfi, tarihçe/görsel/kaynak bilgisi, **içerik ekleme ve düzenleme** (yönetim), yeni eser eklemeye uygun mimari.
- **Veri doğruluğu (5.1.3):** her tarihî iddiada **kaynak gösterilir**; **doğrulanmamış içerik kesin bilgi gibi sunulmaz**.
- **Erişilebilirlik (5.1.4):** sesli anlatım, altyazı, alternatif metin, kontrast, yazı boyutu, klavye, ekran okuyucu — **tasarımda değil çalışan üründe**.
- **Telif (29 Ekim, kullanıcı):** envanter yayınlarını (ciltler, metin ve görseller) dahil olduğumuz Vakıf Eserleri Envanter Projesi hazırlıyor; biz bu kaynakları çevrim içi ortama taşıyoruz. **Kitapların telifi sorun değildir.** Üçüncü taraf görsellerde (ör. Wikimedia Commons) lisans ve atıf kuralı aynen sürer.
- **Görseller:** sponsorun ilettiği kaynaklar Bursa'nın 3 ciltlik envanter PDF'leridir (`veriler/`); toplantıda bu görsellerin kullanılması vurgulandı. **Karar (27 Ekim):** PDF'lerden görsel ayıklama ayrı bir süreçte yapılır; **şimdilik mevcut görsellerle** (Wikimedia Commons) devam edilir. Her görselde atıf/lisans satırı kalır.
- **Oyun:** kullanıcıdan fotoğraf çekmesini istemek **istenmedi**. Doğru görseli seçme/eşleştirme istendi. Görsele tıklanınca eser bilgisi açılır.
- **Fiziksel ziyaret teşviki** yaratıcılığımıza bırakıldı: bu yüzden ziyaret doğrulaması oyunun kilididir.
- **Tanıtım videosu** sunumda zorunlu beklenti.
- **Takvim:** özellik dondurma 3 Kasım (ekip kararı), geliştirme 7 Kasım'da biter, final 7–8 Kasım (fiziki, 7 kişilik jüri). 28 Ekim yarım gün, 29 Ekim tatil. Sunumu yalnızca takım üyeleri yapar.

## 4. Veri ve güven kuralları (pazarlık konusu değil)
- Tarihî bilgi **yalnızca onaylı katalogdan** gelir (`public_catalog`, her kayıtta kaynak sayfası ve karar kimliği). Modelin kendi "bilgisi" cevap olarak sunulmaz.
- Karakterin ağzından çıkan her tarihî cümle onaylı bir `fact_id`'ye bağlanır. Bağlanamayan cümle gösterilmez.
- **Karakter bir canlandırmadır.** Tarihî kişilerin "sözleri" gerçek alıntı gibi sunulmaz; arayüzde "canlandırma / kurgu" etiketi bulunur. Kurgu ile tarihî iddia karışmaz.
- Kaynak bulunamıyorsa dürüst cevap: "Bunu kaynaklarımda bulamadım." Uydurma yok.
- Ziyaret mührü, onaylı katalog koordinatına yarıçap içinde (varsayılan **50 m**, 29 Ekim kararı; `VAKIFNAME_VISIT_RADIUS_M`; sahada denenince eser bazında ayarlanabilir) bildirilen konumla verilir; konum saklanmaz. Jüri için **sunum modu** (`VAKIFNAME_VISIT_SIMULATION=on`) ziyareti simüle eder ve **ekranda açıkça** "sunum modu / simülasyon" yazar. (Yayın paketinde "demo" kelimesi yasaktır: `frontend/scripts/check-public-build.mjs`.)
- Quiz cevapları **sunucuda** doğrulanır; doğru şık istemciye gönderilmez.
- Kitap PDF'leri, ham metin, görsel arşivleri ve `.env` **asla** commit'lenmez/public repoya konmaz. Görsel izni/lisansı her görsel için kayıtlıdır; üçüncü taraf (envanter yayınları dışındaki) lisans sorumluluğu bizdedir. PDF ve arşivlerin repoya girmemesi telif değil boyut ve iç veri nedeniyledir.

## 5. Manevi değerler ve ton
- **Terim (29 Ekim):** bu bir **oyundur, sınav değil.** Kullanıcıya görünen metinde (ve sunumda) "sınav" denmez; "Rozeti Al", "sorular", "oyun" denir. (Kodda `quiz` adı kalabilir.)
- Eserlerin çoğu **ibadet mekânı veya türbe**. Saygılı, sade, sakin bir dil. Şakacı/oyuncak bir üslup yok; oyunlaştırma **vakarlı** kalır.
- Ses ve müzik **otomatik başlamaz**; kullanıcı başlatır, kapatma her zaman görünür. İbadet mekânı/türbe uyarıları (katalogdaki `site_notice` metni: sessiz olun, sandukalara dokunmayın vb.) ziyaret ve oyun adımından önce görünür tutulur. Namaz vakti hesaplama özelliği **yoktur**.
- Dinî figür, ayet, hat veya levha **uydurulmaz**; ayet/hadis/kitabe yalnızca onaylı kaynaktan.
- Gerçek tarihî şahsiyetlerin görsel temsili saygılı, çizim/illüstrasyon dilinde olur; fotogerçekçi yüz üretimi yok.
- **Renk paleti (27 Ekim kararı, "A · Gece Laciverdi + Altın"):** yeşil/zümrüt **yok**. Zemin gece laciverdi `#0F1330`, yüzey `#1A2050`, metin fildişi `#F3EAD3`, altın `#C9A24B`, parlak altın `#E9C874` (altın mühür/vurgu), teknoloji ışımaları indigo `#4A5BFF` (açık ton `#8FA2FF`), mühür kırmızısı `#8E2A3A` (balmumu). Tarih = altın/fildişi/çini kobaltı; teknoloji = ince indigo ışıma ve geometrik (girih) desen. Kırmızı `#8E2A3A` koyu zeminde düşük kontrastlıdır: yalnızca dekor/büyük ögede, metin için açık tonu kullan. **İstisna (7 Kasım, Talha):** oyundaki soru geri bildiriminde doğru = yeşil, yanlış = kırmızı (yalnızca durum rengi, yalnızca bu ekranda); renk tek başına anlam taşımaz, yanında ✓/✗ ve "Doğru/Yanlış" yazısı bulunur. Animasyon `prefers-reduced-motion`'a saygı duyar.

## 6. Teknik yapı
- **Backend:** FastAPI (`backend/app`), onaylı katalog + quest/ilerleme (SQLite) + rehber (`guide`) + Esere Sor altyapısı (`ask`, arayüzden kalkar ama arama motoru rehberin kaynağıdır).
- **Frontend:** React + TypeScript + Vite (`frontend/src`). Harita: Leaflet.
- **Rehber sağlayıcısı** tek yerden seçilir: `VAKIFNAME_GUIDE_PROVIDER` (`openrouter` | `claude-cli`), bkz. `backend/.env.example`. Giriş/anahtar yoksa **sessiz geçiş yok**; rehber kapanır, kaynaklı arama sürer. Hesap açılış logunda yazar.
- **Tasarım kodla yapılır.** Figma yalnızca renk/yazı tipi karar belgesi ve sunum içindir. Tasarım token'ları tek dosyada: `frontend/src/design/tokens.css` (oluşturulacak).
- Yeni env eklenince `backend/.env.example`'a **seçenekleriyle birlikte yorum satırı** yazılır.
- **Canlı ortam (29 Ekim kararı):** final demosu sunucuda canlı çalışır: `https://calismalar.tikirsoft.com`. Yerel kurulum internet kesintisine karşı yedektir. Google girişi bu adres için tanımlı OAuth istemcisiyle çalışır (kimlik `.env` dosyalarında, repoda değil).
- **Hesap güvenliği (29 Ekim kararı):** e-posta doğrulaması ve parola sıfırlama zorunludur. Doğrulanmamış e-posta yönetici yetkisi almaz.

### Çalıştırma
```bash
# backend
cd backend && set -a && . ./.env && set +a && .venv/bin/uvicorn app.main:app --port 8000
# frontend
cd frontend && npm run dev          # http://localhost:5173
# testler
cd backend && .venv/bin/python -m pytest
cd frontend && npm test && npx tsc -b && npm run build
```
Medya (görsel) ve giriş videosu repoda yoktur: görseller `backend/tests/ask_eval/media/` (git'e girmez), video `~/vakifname-video-assets/hero.mp4` (+ telefonlar için dikey küçük sürüm `hero-mobil.mp4`, 30 Ekim).

## 7. Çalışma biçimi
- **Önce anla, sonra yaz.** Büyük değişiklikte plan → onay → uygulama. Ekip kodu sorgulamadan ilerlemişti; biz **gerekçeli** ilerleriz.
- **İnce çalışırız, sıkıştırmayız.** Takvim baskısı kalite ve doğruluk kuralını (§4) gevşetmez. Kapsamı kısarız, kaliteyi değil.
- Değişiklik küçük ve test edilebilir olur. Commit öncesi: backend + frontend testleri ve `npx tsc -b` geçer.
- Commit mesajına **Claude ortak yazar (Co-Authored-By) satırı eklenmez**. **Ana dal `feat/game`** (`main` değil; `main` geride kaldı). Yeni işler `feat/game`'den dal alır; dal commit + push'lanır. **Karar (29 Ekim):** backend + frontend testleri, `tsc` ve derleme geçen dalı Claude `feat/game`'e birleştirip push'lar (PR açılmaz).
- Kullanıcı arayüz metinleri Türkçe; ayrıca İngilizce katmanı. Kod/komut olduğu gibi kalır; commit mesajları İngilizce.
- Kullanıcının makinesine zarar verebilecek işlem (sudo, silme, başka hesaba harcama) önce sorulur.
- LLM çağrıları API'den değil, **abonelik oturumu** (`claude -p`) üzerinden. **Karar (29 Ekim):** bu Mac'te `claude` oturumu `talha.aygen@konzek.com` hesabıdır (tüm bilgisayar geçti). Canlı sunucuda ayrıca `claude` girişi gerekir.

## 8. Kaynaklar (proje sahibinin Mac'inde)
- `~/hackathon-drive/` — şartname, bilgi notu, toplantı notları, oyun senaryosu, marka varlıkları (`game/vakifname_brand_assets`), giriş videoları, ciltli yayın PDF'leri (`veriler/`), eser görselleri (`images/`, `Eserler_ve_görseller_ayrıştırılmış/`).
- Eski senaryo (`game/VAKIFNAME-oyun senaryosu.docx`) **kısmen geçersiz**: bu dosyadaki §2 kararları önceliklidir.
