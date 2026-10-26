# Esere Sor — değerlendirme sonuçları (2026-10-24)

Katalog: `catalog_snapshot.json` (10 eser, 76 yayımlanmış olgu). Model: intfloat/multilingual-e5-small, revizyon
614241f622f53c4eeff9890bdc4f31cfecc418b3 (yerel). Cevap yöntemi: `approved_text_retrieval` (LLM yok).

## Sonuç: kabul ölçütleri karşılanmadı

En son yazılan ve yalnızca bir kez çalıştırılan kör set (**heldout5**) üzerinde ilk sonuç doğruluğu %82, cevaplanabilir
sorularda yanlış cevap %4, cevabı olmayan sorularda yanlış cevap %6,7 (15 sorudan 1). Hedefler %90 / %2 / %2 idi.
Sızıntı ve kaynak uyumsuzluğu tüm setlerde sıfır. Sistem **hazır ilan edilmedi**; arayüzde “Deneme sürümü” olarak etiketli.

## Yöntem ve dürüstlük notu

- `eval_set.json` (150 cevaplanabilir, 24 cevapsız, 26 durum testi) motor ayarlanırken kullanıldı; sonuçları iyimserdir.
- Kör setler sırayla yazıldı: her biri o anki motor değişikliklerinden **önce** yazıldı ve ilk çalıştırma sonucu aşağıda
  değiştirilmeden verildi. Hataları görüldükten sonra genel kurallarla düzeltme yapıldı; bu yüzden heldout–heldout4'ün
  güncel sonuçları artık kör değildir. Yalnızca **heldout5** kör kaldı.
- İki sorunun altın cevabı (`Cem Sultan nereye gömüldü?`) ölçümden sonra genişletildi (F003 de doğru cevaptır); kayıtta
  not olarak duruyor.

## Kör setlerin ilk çalıştırma sonuçları

| Set | Arama | İlk sonuç doğru | Yanlış cevap | Cevapsızda yanlış cevap |
|---|---|---|---|---|
| heldout (27+4) | karma | %70,4 | %0 | %0 |
| heldout2 (40+8) | karma | %80,0 | %7,5 | %62,5 |
| heldout3 (42+10+4) | karma | %90,5 | %0 | %0 |
| heldout4 (40+10) | karma | %80,0 | %2,5 | %20,0 |
| heldout5 (50+15+5) | karma | %82,0 | %4,0 | %6,7 |

## Son motorla tüm setler

| Set | Arama | Cevaplanabilir | İlk sonuç doğru | Yanlış cevap | Geri çekilme | Cevapsız soru | Cevapsızda yanlış cevap | Durum testleri | Kaynak uyumsuzluğu | Sızıntı |
|---|---|---|---|---|---|---|---|---|---|---|
| eval_set | kelime | 150 | %99,3 | %0,0 | %0,7 | 24 | %0,0 | %100,0 | 0 | 0 |
| eval_set | karma | 150 | %100,0 | %0,0 | %0,0 | 24 | %0,0 | %100,0 | 0 | 0 |
| heldout | kelime | 27 | %92,6 | %0,0 | %7,4 | 4 | %0,0 | – | 0 | 0 |
| heldout | karma | 27 | %92,6 | %0,0 | %7,4 | 4 | %0,0 | – | 0 | 0 |
| heldout2 | kelime | 40 | %95,0 | %0,0 | %5,0 | 8 | %0,0 | – | 0 | 0 |
| heldout2 | karma | 40 | %97,5 | %0,0 | %2,5 | 8 | %0,0 | – | 0 | 0 |
| heldout3 | kelime | 42 | %95,2 | %0,0 | %4,8 | 10 | %0,0 | %100,0 | 0 | 0 |
| heldout3 | karma | 42 | %95,2 | %0,0 | %4,8 | 10 | %0,0 | %100,0 | 0 | 0 |
| heldout4 | kelime | 40 | %92,5 | %0,0 | %7,5 | 10 | %0,0 | – | 0 | 0 |
| heldout4 | karma | 40 | %92,5 | %0,0 | %7,5 | 10 | %0,0 | – | 0 | 0 |
| heldout5 | kelime | 50 | %82,0 | %4,0 | %14,0 | 15 | %6,7 | %100,0 | 0 | 0 |
| heldout5 | karma | 50 | %82,0 | %4,0 | %14,0 | 15 | %6,7 | %100,0 | 0 | 0 |

## İkame stres testi

Her cevaplanabilir soru için doğru olgu katalogdan çıkarılıp soru yeniden soruldu (doğru cevap yokken başka bir olgunun
cevap gibi sunulması). İlk sürümde %20,8 (259 sorudan 54); son motorla geliştirme setlerinde %4,0 (299 sorudan 12),
kör heldout5'te %12,0 (50 sorudan 6). Kalan vakaların çoğu ilgili ama soruyu tam karşılamayan kayıtlardır.

## Bilinen zayıflıklar

- Kural tabanlı Türkçe soru çözümleme yeni soru kalıplarına sınırlı genellenir (ör. “Orhan Gazi kimdir?” → türbenin
  yeniden yapımı; “kaç kişi alır?” → plan bilgisi).
- Embedding şu anda yalnızca eşitlik bozucudur; karma arama kelime aramasıyla neredeyse aynı sonucu verir.
- Kesinlik etiketi V20 kaydından gelir; düzeltilmiş metnin kesinliğini her zaman yansıtmayabilir.

---

# Görev 12 — yanıt uygunluğu denetleyicisi (2026-10-24)

## Yöntem

- Yerelde yalnızca `multilingual-e5-small` (iki kodlayıcılı arama modeli) var; cross-encoder/yeniden sıralayıcı veya
  yerel LLM yok. Sunucu 2 çekirdek / 3,7 GB RAM (takas kullanımda) olduğu için yerel LLM uygun değil. Harici API ve yeni
  indirme kullanılmadı.
- Doğrulayıcı: arama motorunun cevap türü koşullarını (sayı, tarih, süre, kişi, yapının mimarı, sorudaki yıl, zorunlu
  kavramlar, soru sözcüğünün sorduğu fiil, malzeme, parçanın yapanı) geçen ilk 5 adayı için 20 özellik; numpy lojistik
  regresyon (`app/ask/verifier_model.json`). Çıktı: `answerable`, `selected_fact_id`, `confidence`, `reason`, `method`.
  Metin üretmez. Model dosyası yoksa/bozuksa katı kural kapısına geri çekilir.
- Eğitim ve eşik: yalnızca geliştirme setleri (eval_set, heldout–heldout5, dev_unanswerable) + doğru olgusu çıkarılmış
  sorular (yapay “yakın ama yanlış” örnekler). Eşik 5 katlı çapraz doğrulamayla: doğal cevapsızda ≤ %1, yapayda ≤ %4.
  Çapraz doğrulama: doğruluk %92,6, doğal cevapsızda yanlış %0,8, yapayda %3,7, cevaplanabilirde yanlış %0,3.

## Kör değerlendirme v2 (110 cevaplanabilir + 109 cevapsız; doğrulayıcıdan önce yazıldı, bir kez çalıştırıldı)

Dosya özetleri: answerable.json `e77b6dcc…9641`, unanswerable.json `38e53161…b994` (testte denetlenir).

| Sistem | İlk sonuç doğru | Cevaplanabilirde yanlış | Geri çekilme | Cevapsızda yanlış | Sızıntı / uyumsuzluk |
|---|---|---|---|---|---|
| Önceki üretim (canlı 8110) | %85,5 | %2,7 | %11,8 | %8,3 (9/109) | 0 / 0 |
| Katı kural kapısı | %83,6 | %2,7 | %13,6 | %5,5 (6/109) | 0 / 0 |
| Doğrulayıcı — kelime | %83,6 | %2,7 | %13,6 | %5,5 | 0 / 0 |
| **Doğrulayıcı — karma (yayında)** | **%84,5** | **%0,9** | %14,5 | **%5,5 (6/109)** | 0 / 0 |
| Hedef | ≥ %90 | – | – | ≤ %2 | 0 |

**Kabul ölçütleri karşılanmadı.** Yanlış/ilgisiz cevap azaldı (cevaplanabilirde %2,7 → %0,9; cevapsızda %8,3 → %5,5), doğruluk
artmadı. Geliştirme setindeki kazanç (%92,6 / %0,8) yeni sorulara tam genellenmedi.

Kalan yanlış cevap türleri (kör set): bütün eserin ustası ↔ minber ustası; olmamış bir olayı varsayan soru
(“hangi depremde yıkıldı?”); kişi ilişkisi (“annesi kimdi?” → türbenin kimin için yapıldığı); kurşunla kaplanma ↔
kurşunun kaldırılması; “hangi kuyumcular” ↔ kuyumcular çarşısı; kubbe ölçüsü ↔ kenar uzunluğu; malzeme sorusunda
yanlış nesne (kalem işi ↔ kurşun). Kaçırılanlar çoğunlukla ifade/biçim farkı (“kaç bölümlü”, “belli mi”,
“ilk olarak kimin türbesiydi”, “1863'te kim yaptırdı”).

## Performans (2 çekirdek, 3,7 GB RAM)

| | Önceki sürüm | Yeni sürüm |
|---|---|---|
| Sıralı istek (25) | medyan 74 ms, p95 128 ms, ilk istek 1,4 s (takastan dönüş) | medyan 64 ms, p95 92 ms |
| 8 eşzamanlı istemci (80 istek) | – | 13,9 istek/s, medyan 554 ms, p95 646 ms |
| 8765 yanıt süresi (yük altında) | – | medyan 6,3 ms, p95 11 ms (boşta medyan 5 ms) |
| Bellek (RSS) | ~930 MB (ölçüm anında 240 MB; geri kalanı takasta) | ~990 MB |
| Model+dizin hazır olma | – | 37 s (bu sürede kelime araması çalışır) |

Doğrulayıcının kendisinin ek bellek/süre maliyeti ölçülemeyecek kadar küçük; maliyetin tamamı e5 modeli ve torch'tan gelir.
Torch tek iş parçacığına alındı (`VAKIFNAME_ASK_THREADS`, varsayılan 1): medyan 63 ms (2 iş parçacığında 59 ms), p95
86 ms (118 ms); 8765 ile CPU rekabeti azaldı.

# Görev 13 — cross-encoder denemesi ve ONNX/INT8 (2026-10-24)

## Sonuç: kabul ölçütleri karşılanmadı; canlı model değiştirilmedi

Cross-encoder, kör v3 setinde ilk cevap doğruluğunu artırmadı ve cevapsız sorulardaki yanlış cevap oranını hedefin
altına indirmedi. Canlı sistem (torch e5 + Görev 12 doğrulayıcısı) olduğu gibi kaldı; "Deneme sürümü" etiketi sürüyor.
Arayüzdeki "güven %" gösterimi kaldırıldı (kalibrasyon bölümüne bakınız).

## Modeller

- Cross-encoder: `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`, revizyon `1427fd6…`, lisans Apache-2.0 (model kartı).
  Eğitim verisi mMARCO (MS MARCO çevirisi); MS MARCO'nun kullanım koşulları ticari olmayan araştırma içindir. Ticari
  kullanımdan önce hukuki değerlendirme gerekir. `trust_remote_code` kapalı; `auto_map` yok; dosya özetleri
  `VAKIFNAME_PROVENANCE.json` içinde. Kullanılan dosya `onnx/model_quint8_avx2.onnx` (resmî depodaki INT8 dışa aktarım).
- e5: `intfloat/multilingual-e5-small` revizyon `614241f…` (MIT); ONNX fp32 ve yerelde `quantize_dynamic` ile üretilen
  INT8 (`onnx/model_int8_u8.onnx`). PyTorch sürümü ve `model.safetensors` geri dönüş için yerinde.
- Yeni bağımlılık: `onnxruntime` (+ `flatbuffers`, `protobuf`), yalnızca `backend/.venv` içinde.

## Aynı setlerde eski ve yeni (5 katlı çapraz doğrulama, geliştirme setleri; nihai ölçüt değildir)

| | Doğruluk | Yanlış | Cevapsızda yanlış (doğal) | Yapay olumsuzlarda yanlış |
|---|---|---|---|---|
| Görev 12 (canlı, hybrid) | %92,6 | %0,3 | %0,8 | %3,7 |
| Görev 13 hybrid_ce (CE'li) | %92,3 | %0,3 | %0,8 | %3,7 |
| Görev 13 hybrid (ONNX, CE'siz) | %91,4 | %0,3 | %0,8 | %3,7 |

Cross-encoder tek başına geliştirme setinde %84,6 ilk-1 verdi; cevapsız soruların 95. yüzdelik puanı (4,46) doğru
cevapların medyanıyla (4,42) aynı düzeyde. Yüksek CE puanı tek başına cevap kanıtı sayılmadı; yalnızca doğrulayıcıya
özellik olarak verildi ve çapraz doğrulamada kazanç sağlamadı.

## Kör setler (v2 Görev 12'de, v3 bu görevde CE denemesinden önce yazıldı; her biri bir kez çalıştırıldı)

Kör v3: 107 cevaplanabilir + 105 cevapsız (farklı soru kalıpları, yanlış önkabuller, yakın kavramlar — bânî/minber
ustası, hasar/yıkılma, inşa/onarım tarihi, aile ilişkileri, yükseklik/kenar, malzeme — ve aynı külliyedeki yapılar).

| Set | Yapılandırma | İlk-1 doğru | Cevaplanabilirde yanlış | Gereksiz geri çekilme | Cevapsızda yanlış | Sızıntı |
|---|---|---|---|---|---|---|
| v2 | A canlı (torch + Görev 12) | %84,6 | %0,9 | %14,5 | %5,5 | 0 |
| v2 | B ONNX INT8 + Görev 13 doğrulayıcı | %83,6 | %0,9 | %15,4 | %5,5 | 0 |
| v2 | C ONNX INT8 + CE | %82,7 | %0,9 | %16,4 | %5,5 | 0 |
| v2 | E ONNX fp32 | %83,6 | %0,9 | %15,4 | %5,5 | 0 |
| v3 | A canlı | %79,4 | %0,9 | %19,6 | %11,4 | 0 |
| v3 | B ONNX INT8 | %79,4 | %0,9 | %19,6 | %10,5 | 0 |
| v3 | C ONNX INT8 + CE | %79,4 | %1,9 | %18,7 | %10,5 | 0 |
| v3 | E ONNX fp32 | %79,4 | %0,9 | %19,6 | %11,4 | 0 |

Hedefler (≥%90, ≤%2, sızıntı 0) hiçbir yapılandırmada karşılanmadı. CE yanlış cevapları azaltmadı (v3'te cevaplanabilir
sorularda bir yanlış cevap ekledi). Kör setler ölçümden sonra değiştirilmedi (özetler `test_ask_verifier.py` içinde).

## Güven değerinin kalibrasyonu

Canlı doğrulayıcının olasılığı, kör setlerde cevap verilen 193 soruda: ECE 0,056. En yüksek dilimde (≥0,99, arayüzde
"%100" görünüyordu) 70 cevabın %92,9'u doğruydu; 0,44–0,70 diliminde ortalama 0,60'a karşı %80 doğru. Çapraz doğrulamada
ECE 0,018 olsa da kör setlerde kalibre değil. Arayüz artık yüzde göstermez: "Otomatik denetim bu kaydı soruyla
eşleştirdi · gerekçe. Denetim yanılabilir; lütfen kaynağı kontrol edin." API'deki `confidence` alanı kalibre edilmemiş
bir puandır.

## Performans (yalıtılmış örnekler, 2 çekirdek, 3,7 GB RAM, aynı ölçüm betiği)

| | Canlı yapılandırma (torch) | ONNX INT8 (CE'siz) | ONNX INT8 + CE |
|---|---|---|---|
| Hazır olma | 29 s | 12 s | 14 s |
| Bellek (en yüksek RSS) | 1022 MB | 560 MB | 768 MB |
| Sıralı istek | medyan 63 ms, p95 75 ms | medyan 23 ms, p95 28 ms | medyan 92 ms, p95 306 ms |
| 8 eşzamanlı istemci | 15,0 istek/s, p95 579 ms | 54,6 istek/s, p95 171 ms | 9,4 istek/s, p95 1152 ms |
| 8765 yük altında | medyan 6,4 ms, p95 12 ms | medyan 6,7 ms, p95 11 ms | medyan 6,7 ms, p95 20 ms |

Ölçümler sırasında takas artmadı (sistem ~2,1 GB takasta; 8765 ~750 MB takasta, değişmedi); çökme olmadı.
ONNX INT8 (CE'siz) kalite açısından canlıya eşdeğer, kaynak açısından belirgin biçimde daha iyi; ancak kalite kazancı
kanıtlanmadığı için canlıya alınmadı ve ayrı bir karar olarak bırakıldı.

## Yeniden üretim

- Canlı varsayılan: `verifier_model.json` = Görev 12 modeli (`verifier_model.task12.json` ile aynı). Diskteki kodun bu
  modelle kör v2/v3 sonuçları canlı 8110'un sonuçlarıyla madde madde aynı.
- Deneysel: `VAKIFNAME_ASK_RUNTIME=onnx`, `VAKIFNAME_ASK_CE_DIR=<cross-encoder klasörü>`,
  `VAKIFNAME_ASK_VERIFIER_FILE=app/ask/verifier_model.task13_experimental.json` (hepsi varsayılan olarak kapalı).

# Görev 14 — e5 kodlayıcı için PyTorch INT8 ve ONNX INT8 karşılaştırması (2026-10-24)

Her yapılandırma ayrı süreçte, canlı doğrulayıcıyla (Görev 12 modeli), cross-encoder kapalı olarak ölçüldü. PyTorch INT8:
`torch.ao.quantization.quantize_dynamic`, yalnızca `nn.Linear` katmanları, qint8; tensör başına ve kanal başına iki
çeşit. Kelime gömme tablosu (~96 MB) dinamik nicemlemenin kapsamı dışında kaldı. Canlı sistem değiştirilmedi.

| | Mevcut torch fp32 | Torch INT8 (tensör) | Torch INT8 (kanal) | ONNX INT8 |
|---|---|---|---|---|
| Model açılışı / hazır | 21,3 / 26,0 s | 19,0 / 23,3 s | 19,7 / 23,8 s | 3,0 / 10,1 s |
| Bellek (yükleme sonrası / tepe) | 946 / 979 MB | 981 / 993 MB | 993 / 1013 MB | 522 / 581 MB |
| Soru kodlama medyan / p95 | 52 / 62 ms | 38 / 45 ms | 32 / 41 ms | 13 / 22 ms |
| Tam yanıt medyan / p95 | 55 / 63 ms | 43 / 50 ms | 37 / 46 ms | 15 / 22 ms |
| 8 eşzamanlı istemci | 16,3 istek/s, p95 562 ms | 21,7, p95 396 ms | 22,7, p95 388 ms | 63,7, p95 144 ms |
| Gömme kosinüsü (fp32'ye göre, en düşük / ort.) | 1 / 1 | 0,959 / 0,973 | 0,975 / 0,985 | 0,988 / 0,992 |
| 924 soruda farklı cevap | – | 4 | 4 | 2 |
| Kör v2 doğru / cevaplanabilirde yanlış / geri çekilme / cevapsızda yanlış | %84,6 / %0,9 / %14,5 / %5,5 | %83,6 / %1,8 / %14,5 / %5,5 | %84,6 / %0,9 / %14,5 / %5,5 | %83,6 / %0,9 / %15,4 / %5,5 |
| Kör v3 doğru / cevaplanabilirde yanlış / geri çekilme / cevapsızda yanlış | %79,4 / %0,9 / %19,6 / %11,4 | %78,5 / %0,9 / %20,6 / %11,4 | %81,3 / %0,9 / %17,8 / %11,4 | %79,4 / %0,9 / %19,6 / %10,5 |
| Geliştirme setleri doğru | %93,4 | %93,4 | %92,8 | %93,4 |

Sızıntı ve kaynak uyumsuzluğu hiçbir yapılandırmada yok.

Farklı cevapların niteliği:
- Torch INT8, tensör başına: 1 yeni yanlış cevap, 2 doğru cevap geri çekilmeye dönüştü, 1 geri çekilme doğru oldu.
- Torch INT8, kanal başına: 1 yeni yanlış cevap, 1 doğru cevap geri çekilmeye dönüştü, kör v3'te 2 geri çekilme doğru
  oldu. Fark gürültü düzeyinde, geliştirme setinde ise kayıp var.
- ONNX INT8: hiç yeni yanlış cevap yok. 1 doğru cevap geri çekilmeye dönüştü, 1 yanlış cevap (yanlış önkabullü soru)
  geri çekilmeye dönüştü.

PyTorch dinamik INT8 bellek kazandırmadı. Süreç belleğinin büyük kısmı torch çalışma zamanı ile nicemlenmeyen gömme
tablosundan geliyor; bırakılan fp32 ağırlıklar da süreçten geri verilmiyor. Hız kazancı %25–30. ONNX INT8 bellekte
yaklaşık %45 tasarruf, yaklaşık 3,6 kat hız ve fp32'ye en yakın gömmeleri sağlıyor.

# Görev 25 — yazım hatalarına dayanıklı arama ve NVIDIA yedeği (2026-10-25)

## İlk sorudaki sağlayıcı hatasının nedeni

Canlı 8110 logunda (yalnızca durum satırları; soru metni loglanmaz) rehberin bütün geçmişinde 8 sağlayıcı çağrısı var.
İkisi (10:56:09 ve 13:00:49) `kind=unavailable http=502 code=502 upstream=Nvidia` ile 378 ve 555 ms içinde düştü:
OpenRouter isteği aldı, ücretsiz NVIDIA uç noktası 502 döndürdü. Rate limit, zaman aşımı, kota, devre kesici veya
model kapalı (404) değil; ikisinde de bir sonraki çağrı başarılı. Yani geçici bir upstream hatası.

Değişiklik: cevap çağrısında hızlı (< 5 sn) 502/503 bir kez, 1,5 sn sonra yeniden denenir. Yeniden deneme kotadan düşülür;
süre sınırı, dakikalık/günlük bütçe ve devre kesici aynen uygulanır. Fotoğraf gözlemi çağrısı yeniden denenmez (önceki
karar). Ücretli modele geçilmez. Ziyaretçi teknik ayrıntı görmez.

## Yöntem

- `app/ask/spelling.py`: katalog sözcükleri, eser adları ve soru kalıplarından kurulan sözlükle ağırlıklı
  Damerau-Levenshtein düzeltme (ünlü atlama, Türkçe Q klavye komşu tuşları, bitişik harf değişimi ucuz; Türkçe ek
  korunur; çok sözcüklü eser adları bulanık eşleşir; bitişik yazılan ad ayrılır). Türkçe karakter/büyük harf farkı
  `fold` ile zaten yok. Soru değiştirilmez; arama için alternatif üretilir.
- Genel Türkçe sözlük (zeyrek): katalogda geçmeyen ama doğru yazılmış sözcükler ("nereli", "şehirden") düzeltilmez.
  Kısaltma ve tahmin edilmiş özel ad çözümlemeleri sayılmaz ("hnin" = "H"+"nin"). Sözlükte geçerli olsa da bir eser
  adı veya soru sözcüğüne tek ucuz düzenlemeyle giden sözcük düzeltilir ("sutlan" → "sultan", "kin" → "kim").
- Esere Sor/yedek: önce ham soru; cevap yoksa okunur düzeltilmiş biçim ("Depremde yıkıldı mı": e5, katlanmış
  "yikildi" biçiminde yanlış olguyu seçiyordu). Güvenli düzeltme başka bir olguyla cevaplanıyorsa o tercih edilir.
  Düzeltme zayıfsa (ör. içerik sözcüklerinin tamamı tahmin) olgu cevap diye gösterilmez; "… mı demek istediniz?"
  sorulur, önerilen kaydın yalnızca adı/başlığı anılır, ziyaretçi onaylarsa düzeltilmiş soru sorulur.
- Rehber (NVIDIA): `gather` düzeltilmiş soruyla eseri tanır ve sıralar; istemde "yazımı düzeltilmiş olası okuma"
  ipucu vardır. Cevabı yine Nemotron yazar; kaynak denetimi değişmedi.

## Setler

- `typo_set.json` (geliştirme): 25 temel soru × 5 biçim (doğru, harf eksik, Türkçe karaktersiz, sıra değişik, klavye
  hatası), görevdeki 12 örnek, 7 eser sayfası bağlamlı soru, 30 cevapsız soru. Motordan önce yazıldı.
- `typo_blind.json` (kör): 47 yazım hatalı + 20 cevapsız; ayar bittikten sonra yazıldı, bir kez çalıştırıldı (SHA-256
  testte kilitli).

## Sonuçlar (yazım hatalı/alışılmadık yazımlı cevaplanabilir sorular)

| Set | Arama | | İlk 5'te doğru olgu | İlk cevap doğru | Yanlış cevap | Doğru öneriyle açıklama sorusu | Geri çekilme | Cevapsızda güvenli |
|---|---|---|---|---|---|---|---|---|
| geliştirme (119) | karma (canlı) | önce | %95,0 | %62,2 | %1,7 | – | %36,1 | %100 |
| | | sonra | %98,3 | %96,6 | %0 | %1,7 | %1,7 | %100 |
| | kelime | önce | %94,1 | %62,2 | %0,8 | – | %37,0 | %100 |
| | | sonra | %98,3 | %97,5 | %0 | %1,7 | %0,8 | %100 |
| kör (47) | karma (canlı) | önce | %95,7 | %55,3 | %0 | – | %44,7 | %85 |
| | | sonra | %100 | %91,5 | %0 | – | %8,5 | %85 |
| | kelime | önce | %95,7 | %57,5 | %2,1 | – | %40,4 | %85 |
| | | sonra | %100 | %91,5 | %2,1 | – | %6,4 | %85 |

Biçime göre (geliştirme, karma, önce → sonra ilk cevap doğru): doğru yazım 25 → 25, Türkçe karaktersiz 25 → 25,
sıra değişik 25 → 25, harf eksik 6 → 24, klavye hatası 10 → 25, görev örnekleri 8 → 11 (+1 doğru öneri), eser sayfası
bağlamı 0 → 5 (+1 doğru öneri).

"kza ahnn nmari ne": önce "onaylı bilgi bulunamadı"; sonra rehber kanıtında Koza Han ve BUR-0009-F004 ilk 5'te,
yedek aramada "“Koza Han mimarı ne” mı demek istediniz?" + BUR-0009-F004 önerisi; onaylanınca F004 gösterilir.
Üç içerik sözcüğünün üçü de tahmin olduğu için doğrudan cevap verilmez.

Yanlış eşleşme artmadı: kör setlerdeki yanlış cevap sayısı aynı (kelimede 1, karmada 0); geliştirme setinde azaldı.
Cevapsız sorulardaki 3 kör set hatası ("koza han kac katli", "ulu caminin kac minaresi var", "osman gazi ne zaman
oldu") görev öncesiyle aynı, düzeltmeden bağımsız. İkame stres testi (doğru olgu katalogdan çıkarılınca başka olgunun
cevap sayılması): geliştirme %4,2 → %4,2, kör %4,3 → %4,3.

## Mevcut setlerde regresyon (görev öncesi temel çizgiyle madde madde)

eval_set, heldout 1–5, dev_unanswerable, kör v2 ve kör v3, kelime ve karma: yeni hata yok. heldout5'te bir soru
düzeldi ("Ulu Cami'yi örten kubbe sayısı kaçtır?"). Türkçe sözlük olmadan kör v2'de 1, kör v3'te 1 yeni yanlış cevap
çıkıyordu ("nereli" → "neresi", "şehirden" → "denirden"); sözlük bu yüzden Esere Sor açıkken de yüklenir.

## Bilinen zayıflıklar

- Türkçe karaktersiz yazılmış ve katalogda geçmeyen gerçek sözcükler sözlükte bulunmayabilir ("sehirden" yalnızca özel
  ad olarak çözümlenir) ve düzeltilebilir.
- Sözlük yüklenirken (açılıştan sonra ~9 sn) düzeltme yalnızca katalog sözlüğüyle çalışır.
- Ünlüsüz kısaltmalarla yazılmış tamamen bozuk sorular doğrudan cevaplanmaz, açıklama sorusu sorulur.

Yeniden üretim: `python scripts/eval_typos.py --set tests/ask_eval/typo_set.json [--model-dir … --index-dir …]
[--no-spelling] [--no-lexicon] [--failures]`.
