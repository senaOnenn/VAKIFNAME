# Görsel RAG: insan onayı, referans indeksi ve değerlendirme (Görev 29)

Durum: **hazırlık**. Canlı 8765'e alınmadı; otomatik eser eşleşmesi kapalı; 8110 hiçbir görsel model yüklemez.

## 1. Karar mimarisi (mevcut sistemin genişletilmesi)

Görseller için üç bağımsız karar vardır; hepsi aynı bilet, gerekçe, en kısa inceleme süresi, konu özeti (SHA-256),
yalnızca-eklenebilir `decisions` tablosu ve hash zincirli `audit_log` kurallarından geçer. Toplu ekranda her satır ayrı
karar ve ayrı denetim kaydıdır.

| | Karar türü | Rol | Ön koşul | Ne verir |
|---|---|---|---|---|
| A | `image_rights` | rights | — | Hak sahibi, tam lisans, atıf, kaynak ve **açıkça işaretlenen** eser eşleşmesi |
| B | `image_publication` | rights | A + eser kimliği (`catalog_identity`) | Ziyaretçi galerisinde yayın |
| C | `image_reference_index` (yeni) | rights | A; Commons koleksiyonu; test kümesi dışı | Yerel görsel tanıma referans indeksinde kullanım |

- B ile C birbirini gerektirmez: referans olarak uygun bir fotoğraf yayımlanmak zorunda değildir; yayımlanan bir
  fotoğraf da kendiliğinden referans olmaz.
- A yoksa, reddedilmişse veya eskimişse (konu özeti/veri sürümü değişmiş) B ve C kapılarda geçersizdir
  (`image_publishable`, `image_reference_index_usable`).
- C'nin ayrıntısı (`ImageReferenceIndexPayload`): `monument_match: "confirmed"` (A'dan ayrı, yeniden işaretlenir),
  `angle_classes` (en az biri), `people`, `visible_text`, isteğe bağlı `note`. İçerik sınıfları ölçümde katman ayırmak
  için tutulur.
- Kitap/arşiv görselleri (`v20_archive`) C alamaz; test kümesindeki fotoğraflar envantere hiç giremez
  (`HoldoutSet`, yükleme anında hata).

## 2. 59 adayın kuyruğa alınması

- Kaynak: `visual_index/reference_collection_commons_v1/collection.json` (yalnızca `onaya_hazir`).
- Dönüştürücü: `backend/scripts/import_commons_candidates.py` — varsayılan kuru çalıştırma; kimlik/yol çakışması,
  test kümesi sızıntısı, SHA-256 ve boyut, JPEG geçerliliği, lisans kodu ↔ sürüm bağlantısı, ek kısıtlama, fotoğrafçı ve
  atıf metni denetlenir. Çıktı belirlenimcidir (aynı girdi → aynı bayt); `--copy-media` var olan aynı dosyayı atlar,
  farklı içerikte durur, hiçbir şeyi silmez veya üzerine yazmaz. Veritabanına hiçbir şey yazmaz.
- Çıktı: `data/real_catalog/commons_images_candidates.json` (`batch_id: g28-commons-candidates-v1`). Eser eşleşmesi
  ön doldurmada **bilerek boştur**.
- Kuyruğa giriş yalnızca `VAKIFNAME_COMMONS_CANDIDATES_FILE` tanımlıysa olur (varsayılan yok); sunucunun başka bir
  nedenle yeniden başlatılması kuyruğu değiştirmez. Mevcut 60 kaydın konu özeti değişmez; eski kararlar eskimez.
- Önizleme: `GET /internal/review/media/{card|detail}/{image_id}` — yalnızca loopback, yalnızca yetkili oturum,
  yol manifestten, her istekte SHA-256 doğrulaması. Genel 8110/4173 bu dosyalara erişemez; genel yayın yalnızca B
  onaylı fotoğrafları `public_catalog/media/` altına kopyalar.

## 3. Test kümesi

`visual_index/test_sets/commons_holdout_v1/` — 31 fotoğraf, ayrı `media/`, `manifest.json` (özet
`1349aabd06c3030a…`), `usage_log.json`. Kurallar: referansla birleştirilmez, indekse alınmaz, referans seçiminde ve
eşik/model ayarında kullanılmaz, yalnızca son ölçümde bir kez kullanılır ve her kullanım kaydedilir. Değişiklik → yeni
sürüm (`commons_holdout_v2`).

## 4. Sürümlü ve geri alınabilir referans indeksi

`backend/scripts/build_reference_index.py`

- Seçim: yalnızca `image_reference_index_usable` (C geçerli) fotoğraflar. Görev 26'nın 60 fotoğraflık yayın onaylı
  galerisi yalnızca `--include-legacy-gallery` ile ve `selection_basis: legacy_g26_published_gallery` etiketiyle
  eklenir (önerilen: bu 60 için de C kararı verilip bayrağın bırakılması).
- İnceleme veritabanı geçici kopyaya alınarak okunur; çıktı `visual_index/reference_index/<sürüm>/`
  (`gallery.npy`, `manifest.json`: her fotoğraf için atıf, lisans, hak ve C karar kimlikleri, açı/içerik sınıfları,
  test kümesi özeti, `auto_match_enabled: false`). Sürüm klasörleri değiştirilmez.
- Etkinleştirme/geri alma: `--activate <sürüm>` yalnızca `active` işaretçisini atomik değiştirir ve
  `history.json`'a yazar. Bugün bu işaretçiyi okuyan bir servis yoktur.
- Kaynak sınırı: `systemd-run --scope -p MemoryMax=1G -p CPUQuota=100% nice -n 10`; 16'lık parçalar.
- Staging doğrulaması: eski 60 ile üretilen sürüm mevcut deney galerisiyle birebir aynı (en düşük kosinüs 1,0).

## 5. "İlk 3 aday + kullanıcı doğrulaması" (tasarım; uygulanmadı)

Amaç: ziyaretçiye "bu fotoğraf şu eserdir" demek değil, **benzer görünen en çok üç katalog eserini** önerip seçimi
kullanıcıya bırakmak.

1. **Ayrı süreç:** `vakifname-visual` (loopback, systemd `MemoryMax≈600M`, `CPUQuota=100%`). Model ilk istekte yüklenir,
   boşta kalınca bellekten atılır. 8110 yalnızca küçük bir vekil uç (`POST /visual/suggest`) sunar; model yüklemez.
   Özellik bayrağı varsayılan kapalı; testers modunda bile ayrıca açılır.
2. **İstemci:** fotoğraf tarayıcıda en fazla 512 px'e küçültülür, EXIF (GPS dahil) silinir; dosya en fazla 1 MB.
   Sunucu fotoğrafı saklamaz; dış API yoktur.
3. **Eşleme:** etkin indeks sürümü üzerinde eser başına en yüksek kosinüs → ilk 3 eser. Yanıtta yalnızca eser kimliği,
   adı, benzerlik bandı (yüksek/orta/düşük; ham skor değil) ve o eserin **yayın onaylı** (B) kart fotoğrafı + atfı
   döner. B onayı olmayan referans fotoğrafı ziyaretçiye hiçbir zaman gösterilmez.
4. **Katalog dışı:** en yüksek benzerlik alt eşiğin altındaysa "Katalogda benzer eser bulunamadı" denir; aday listesi
   gösterilmez. Alt eşik kalibrasyon setinde katalog dışı yanlış kabulü sınırlayacak şekilde seçilir.
5. **Kullanıcı kararı:** "Bu eser" / "Hiçbiri". Seçim yalnızca eser sayfasını açar; check-in, rozet veya puan vermez
   (bunlar GPS check-in kurallarına bağlı kalır). Dil her zaman "benzer görünen eserler"dir.
6. **Kayıt:** isteğe bağlı ve anonim: indeks sürümü, ilk 3 eser, bant, kullanıcının seçimi. Fotoğraf saklanmaz;
   kayıtlar indekse veya test kümesine kendiliğinden eklenmez.
7. **Sınırlar:** IP başına hız sınırı, 3 sn zaman aşımı, eşzamanlı istek sınırı; model belleği aşılırsa özellik kapanır.

## 6. İnsan onayından sonra değerlendirme planı (v3)

Ön koşul: C onaylı fotoğraflarla yeni indeks sürümü; eşikler **test kümesi açılmadan önce** kalibrasyon setinde sabitlenir.

- **Setler:** kalibrasyon = indeks içi yazar-ayrık LOO + kalibrasyon negatif grupları (Yeşil Cami, Yıldırım Bayezid
  Camii, Emir Han, Saat Kulesi, Orhan Gazi Camii, İvaz Paşa); test = `commons_holdout_v1` (ana ölçüt: indeks
  yazarlarıyla aynı eserde kesişmeyen sorgular) + test negatif grupları (Yeşil Türbe, Emir Sultan, Hüdavendigâr, Fidan
  Han, Muradiye'nin diğer türbeleri, Saraybosna Brusa Bezistan, Söğüt). Kitap görselleri kullanılmaz.
- **Sızıntı denetimi:** SHA-256, dHash (Hamming ≤ 10), DINOv2 kosinüs ≥ 0,92 ve aynı yazar/oturum çiftleri indeks ile
  test arasında sıfır olmalı; her çalıştırma `usage_log.json`'a yazılır.
- **Ayrı raporlanan ölçütler** (her biri n ve %95 Wilson aralığıyla; eser başına ve katman başına —
  tabelasız/insansız, tabelalı, insanlı, gece, iç/dış):
  1. İlk sırada doğru eser; ilk 3 içinde doğru eser.
  2. **Yanlış eser eşleşmesi:** katalog eserinin ilk sırada başka katalog eseri gösterilmesi (eşik bağımsız) ve öneri
     eşiğinin üstünde gösterilmesi; karışma matrisi (özellikle Muradiye türbeleri ↔ cami/medrese, Osman ↔ Orhan Gazi).
  3. **Katalog dışı yanlış kabul:** negatifin alt eşiği geçip aday listesi üretmesi; zor negatif grubu başına ayrı.
  4. Gereksiz ret: katalog eserinin "benzer eser yok" sonucuna düşmesi.
  5. Önceki sürümle eşleşmiş karşılaştırma (McNemar).
- **Yetersiz örneklem:** 19 yazar-ayrık pozitifle aralıklar ±%20 civarındadır. Öneri: insan onaylı ayrı bir
  `commons_holdout_v2` (eser başına ≥ 10 yazar-ayrık pozitif, ≥ 100 katalog dışı negatif) referans havuzundan bağımsız
  toplanır.
- **Öneri modu için önerilen kabul ölçütü** (karar sizindir): ilk-3 ≥ %90 (alt sınır ≥ %80), katalog dışı yanlış
  kabul üst sınırı ≤ %5, ilk sıradaki yanlış eser ≤ %10. Otomatik kimlik belirleme bu ölçütler sağlansa bile kapalı kalır.

## 7. Canlıya alma adımları (her biri ayrı onay gerektirir)

1. `import_commons_candidates.py --write --copy-media --data-dir /var/lib/vakifname-internal` (118 dosya
   `images/commons/` altına eklenir; mevcut 120 dosyaya dokunulmaz).
2. 8765 sürecini `VAKIFNAME_COMMONS_CANDIDATES_FILE=/root/vakifname/data/real_catalog/commons_images_candidates.json`
   eklenerek yeniden başlatmak (kod değişiklikleri de bu adımda devreye girer).
3. Yeniden başlatma sonrası kontrol: 427 karar / 477 denetim kaydı, `stale = 0`, denetim zinciri geçerli, yayın
   önizlemesi 10 eser / 76 olgu / 60 fotoğraf.
4. İncelemeciler A, B, C kararlarını verir (rights rolü).
5. C onaylarından sonra `build_reference_index.py --build vN-<tarih>`; değerlendirme planı v3; ayrı onayla `--activate`.

## 8. Hackathon ZIP arşivi (Görev 30)

- Kaynak: `/root/images-20261025T172633Z-1-001.zip` (121 JPEG, 10 eser klasörü). Karantinadaki kopyalar ZIP ile bayt bayt
  aynı; ayrıca V20 arşivindeki (`manifests/image_manifest.json`) aynı ad ve özetli 121 kayıtla örtüşür. Yeni kayıt
  açılmaz: `manifests/hackathon_zip_overlay_v1.json` bu kayıtlara ZIP yolu, özgün klasör/dosya adı, kaynak, belgelenmiş
  kimlik durumu, kalite ve sRGB görüntüleme kopyalarını (`images/hackathon_zip_display/`, özgün boyut) ekler.
  Üretici: `backend/scripts/build_hackathon_zip_overlay.py` (kuru çalıştırma varsayılan; tekrar çalıştırmada değişmez).
- Yükleme yalnızca `VAKIFNAME_HACKATHON_ZIP_OVERLAY_FILE` tanımlıysa olur. Ek alanlar boşken kayıt özeti değişmez.
- Kurallar: hak kararı (A) için lisans `written_permission` + izin referansı zorunlu; belgelenmiş kimlik çelişkisi olan
  fotoğrafa A ve C verilemez. Yayında özgün CMYK değil görüntüleme kopyası yayımlanır; kaynak adı "Vakıf Katılım —
  Bursa Vakıf Eserleri Envanteri".
- Dahili önizleme: `GET /internal/review/gallery/{BUR}` ve envanter ekranındaki "Galeri önizlemesi (dahili)" paneli.
- Görsel RAG: `visual_index/reference_collection_hackathon_zip_v1/collection.json` (hepsi etkin değil; engeller kayıtlı).
