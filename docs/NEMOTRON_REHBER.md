# Esere Sor — yapay zekâ rehberi (OpenRouter · NVIDIA Nemotron VL) işletim notları

## Akış

Soru (+ isteğe bağlı fotoğraf)
→ fotoğraf varsa ziyaretçi "yüz, kişisel bilgi veya gizli belge yok" onayını verir; sunucuda EXIF/GPS/XMP/IPTC silinir ve
  **yerel yüz taramasından** geçer (yüz bulunursa sağlayıcıya gönderilmeden reddedilir)
→ `nvidia/nemotron-3.5-super-vl:free` fotoğraftan yalnızca **görünen özellikleri** ve olası eserleri verir
→ yerel e5/hibrit aramayla yalnızca **yayın onaylı katalog olguları** ve eser kimlik kayıtları seçilir
→ aynı model, olgu kimlikleriyle JSON cevap yazar (cümle başına kaynak kimliği)
→ backend her cümleyi denetler: kimlik bu istekte verilen kanıtlar arasında mı; rakam, sayı, Roma rakamı ve özel adlar
  atıf yapılan kayıtta geçiyor mu; yalnızca fotoğrafa dayanan cümlede tarih/kişi/tarihî olay var mı
→ denetimi geçen cümleler ve kullanılan kayıtların bağımsız kaynakları gösterilir.

Sağlayıcı çalışmazsa, anahtar yoksa, kota/bütçe dolduysa mevcut kaynaklı arama (`/monuments/ask`) cevap verir. Dahili
V20 RAG ve kitap metinleri kullanılmaz.

### Fotoğraf: önce mimari analiz (Görev 32)

- Görsel çağrı fotoğrafın **mimari analizini** yazar: belirgin 3–6 özelliğe odaklanan doğal bir paragraf (≈70–140
  sözcük; zayıf görüntüde daha kısa) ve en çok 6 özellik etiketi. Backend tarih, kişi, üslup/dönem, yer adı ve
  çekincesiz malzeme içeren cümleleri; ayrıca etiketlerde olmayan bir mimari öğeyi (ör. görünmeyen mihrap) anan
  cümleleri çıkarır. Şerefe/kasnak, minare/kubbe görüldüyse serbesttir. Okunamayan ya da boş kalan analiz
  "Fotoğraf şu anda analiz edilemedi." olarak bildirilir; sahte analiz gösterilmez.
- Kimlik isteğe bağlıdır. Tek bir "yüksek" katalog eşleşmesi yoksa durum `photo_analyzed` olur: arayüz yalnızca
  "Fotoğrafın Mimari Analizi" alanını gösterir, altta "Fotoğraftan yapının kesin kimliği doğrulanamadı." notu yer alır.
  Seçenekler: mimariyi daha ayrıntılı açıkla, kayıtlı eserlerden birini seç (yalnızca tarihî sorunun bağlamıdır),
  başka fotoğraf yükle. Bu durumda ikinci (cevap) çağrısı yapılmaz.
- Güvenilir eşleşmede tarihî soru için ikinci çağrı yapılır ve yalnızca onaylı olgulardan cevap verilir. Yalnızca
  mimari bir soruda ("kubbeleri açıklar mısın?") ikinci çağrı yapılmaz.
- Takip soruları (`photo_context`): istemci, son tur bir fotoğraf analizi ya da onun takibiyse analiz metnini gönderir;
  fotoğrafın kendisi gönderilmez. Bu durumda:
  - Mimari soru tek metin çağrısıyla cevaplanır. Her cümle "fotoğraf" (önceki analizde geçen) ya da "genel bilgi"
    olarak etiketlenir. Analizde olmayan bir ayrıntı gerekiyorsa fotoğraf yeniden istenir (`photo_context_needed`).
  - "Burası neresi?" fotoğrafın yeniden yüklenmesini ister; çağrı yapılmaz.
  - Kimliği doğrulanmamış fotoğraf için sorulan tarihî soruya cevap verilmez (`identity_required`); ziyaretçi eseri
    kendisi seçebilir. Açık eser sayfası fotoğrafa kimlik atamaz.
- DINOv2 deney indeksi, Commons adayları ve ZIP arşiv görselleri bu akışta kullanılmaz.

## Hesap ve anahtar (yetkili proje sorumlusu)

OpenRouter hizmet şartları gereği hesap ve API anahtarı **yetkili, yetişkin proje sorumlusu** tarafından açılır ve
yönetilir. Hesap açma, şart kabulü, kredi yükleme veya gizlilik ayarı değiştirme otomatik yapılmaz.

Ücretsiz modelin çalışması için OpenRouter hesabının gizlilik ayarlarında ücretsiz uç noktalara izin verilmesi
gerekebilir. Ücretsiz uç noktalarda sağlayıcı istemleri kaydedebilir veya eğitimde kullanabilir; bu yüzden yüz, kişisel
fotoğraf veya gizli belge gönderilmez (bkz. Gizlilik).

- Anahtar yalnızca dosyadan okunur: `/etc/vakifname/secrets/openrouter_api_key`, sahibi `root` (veya servis hesabı),
  izin `600`. Grup/diğer okuyabiliyorsa veya sahibi başka bir hesapsa reddedilir. systemd ile
  `LoadCredential=openrouter_api_key:/etc/vakifname/secrets/openrouter_api_key` kullanılırsa `$CREDENTIALS_DIRECTORY`
  önceliklidir. Ortam değişkeni veya komut satırı kabul edilmez.
- Anahtarı yazmak: yetkili sorumlu, **kendi SSH oturumunda** (Claude sohbetinde değil, `!` önekiyle değil):

  ```bash
  sudo bash /root/vakifname/backend/scripts/install_openrouter_key.sh
  ```

  Betik etkileşimli terminal ister (aktarılan girdiyi reddeder), anahtarı görünmeden okur, biçimini denetler, dosyaya
  atomik olarak root/600 yazar ve yalnızca "Kaydedildi" der. Anahtar sohbete, e-postaya, komut satırına veya ortam
  değişkenine yazılmaz. Servis yeniden başlatılmadan da okunur (anahtar her çağrıda dosyadan okunur).

## Bağlantı denetimi

```bash
cd backend
.venv/bin/python scripts/openrouter_check.py status        # anahtar, kota, model, yüz taraması — token harcamaz
.venv/bin/python scripts/openrouter_check.py smoke --yes   # 8 senaryo, 10 gerçek çağrı (üst sınır 12); 429'da durur
```

## Ücretsiz kota

OpenRouter ücretsiz modellerde (openrouter.ai/docs/api-reference/limits, **2026-10-25'te doğrulandı**; canlıya almadan
önce yeniden bakın): **20 istek/dakika**; hesapta tüm zamanlarda 10 dolardan az kredi satın alınmışsa **50 istek/gün**,
en az 10 dolar alınmışsa 1000 istek/gün (UTC günü). `status` komutu `GET /key` yanıtındaki
`free_model_daily_requests` (kullanılan/sınır/kalan) değerini gösterir. Uygulama sınırları bunların altındadır:

- günlük en çok 40 çağrı (`VAKIFNAME_GUIDE_DAILY_CALLS`); fotoğraflı soru 1 çağrı harcar (güvenilir eşleşme ve tarihî
  soruda 2), fotoğraf sonrası mimari takip sorusu 1 çağrı harcar,
- dakikada en çok 15 çağrı (`VAKIFNAME_GUIDE_CALLS_PER_MINUTE`),
- 429'da yeniden deneme yapılmaz; devre `Retry-After` kadar açılır. Günlük kota hatasında devre UTC günü sıfırlanana
  dek açık kalır ve sağlayıcı yoklanmaz,
- yalnızca `:free` ile biten modeller çağrılır; istekte model yedekleme listesi gönderilmez. Yanıtta ücret (`usage.cost`
  > 0) veya başka bir model görülürse cevap kullanılmaz ve rehber 15 dk durur,
- kota bitince ziyaretçi kaynaklı aramaya yönlendirilir ve bunu cevapta görür,
- sayaçlar (günlük çağrı/token ve son 60 saniyenin çağrı zamanları) `/var/lib/vakifname/guide/budget.sqlite3` dosyasında
  kalıcıdır; yeniden başlatma kotayı sıfırlamaz. Dosya açılamazsa rehber hiç çağrı yapmaz (sayaçsız çalışmaz),
- `smoke` testinin çağrıları da aynı sayaca yazılır.

## Özellik bayrağı ve ayarlar (8110 ortamı)

| Değişken | Varsayılan | Anlam |
|---|---|---|
| `VAKIFNAME_GUIDE_MODE` | `off` | `off` / `testers` (yalnızca test anahtarı) / `on` |
| `VAKIFNAME_GUIDE_TESTER_KEY_FILE` | `/etc/vakifname/secrets/guide_tester_key` | Test erişim anahtarı; "Esere Sor" altındaki "deneme erişimi" formundan bir kez girilir (bkz. Test erişimi) |
| `VAKIFNAME_GUIDE_COOKIE_SECURE` | otomatik | Test oturumu çerezinin `Secure` bayrağı; HTTPS isteklerinde kendiliğinden, TLS vekilde sonlanıyorsa `1` |
| `VAKIFNAME_OPENROUTER_KEY_FILE` | `/etc/vakifname/secrets/openrouter_api_key` | API anahtarı dosyası |
| `VAKIFNAME_GUIDE_MODEL` | `nvidia/nemotron-3.5-super-vl:free` | Metin modeli |
| `VAKIFNAME_GUIDE_VISION_MODEL` | (metin modeli) | Görsel model; OpenRouter `/models` listesinde görsel girdi desteklemiyorsa fotoğraf analizi yapılmaz |
| `VAKIFNAME_GUIDE_REASONING` | `off` | `off` / `low` / `default` — Nemotron akıl yürütme modudur; kapalıyken token ve süre azalır |
| `VAKIFNAME_GUIDE_ALLOW_PAID_MODEL` | — | `1` verilmedikçe ücretli model çağrılmaz |
| `VAKIFNAME_GUIDE_DAILY_CALLS` | `40` | Günlük çağrı sınırı (UTC günü) |
| `VAKIFNAME_GUIDE_CALLS_PER_MINUTE` | `15` | Dakikalık çağrı sınırı |
| `VAKIFNAME_GUIDE_DAILY_TOKENS` | `400000` | Günlük token bütçesi |
| `VAKIFNAME_GUIDE_BUDGET_DB` | `/var/lib/vakifname/guide/budget.sqlite3` | Kalıcı sayaç dosyası (yalnızca gün, çağrı/token sayıları ve çağrı zamanları) |
| `VAKIFNAME_GUIDE_RATE` | `6/60/10` | İstemci başına dakika/saat ve genel dakika sınırı |
| `VAKIFNAME_GUIDE_FACE_MODEL_DIR` | `/var/lib/vakifname/models/face` | Yerel yüz algılayıcı modelleri |
| `VAKIFNAME_GUIDE_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI uyumlu taban adres |
| `VAKIFNAME_GUIDE_TIMEOUT_S` | `30` | Tek cevap çağrısının kesin üst sınırı (bağlantı canlı tutulsa bile) |
| `VAKIFNAME_GUIDE_VISION_TIMEOUT_S` | `25` | Fotoğraf gözlemi çağrısının üst sınırı |
| `VAKIFNAME_GUIDE_DEADLINE_S` | `50` | Bir sorunun (fotoğraflıda iki çağrı) toplam üst sınırı; dolunca kaynaklı arama cevabı döner |

## Sunucu (systemd)

8110 ve 4173, `vakifname-api.service` ve `vakifname-web.service` birimleriyle çalışır (açılışta başlar, çökünce yeniden
başlar). 8765 dahili inceleme servisi bu birimlerin dışındadır.

- Yapılandırma: `/etc/vakifname/vakifname-api.env` (root, 600; gizli değer yok, yalnızca dosya yolları).
- Site: `/root/vakifname-preview/current` → etkin `dist-<zaman>` derlemesi; önceki derlemeler aynı dizinde durur.
- Loglar: `/root/vakifname-preview/logs/api-8110.log`, `web-4173.log` (soru, fotoğraf, anahtar yazılmaz). Her sağlayıcı
  çağrısı zaman damgalı bir satır yazar:
  `guide call stage=vision|answer result=ok|error kind=… http=… code=… upstream=… ms=…` (başarıda `finish` ve token
  sayıları). `code` OpenRouter hata kodudur; bağlantı hatasında `transport:<sınıf>`, üretim hatasında
  `finish_reason:error`. Hata mesajı ve gövdeler yazılmaz. Teşhis: `grep "guide call" api-8110.log`.
- Rehberi kapatmak: env dosyasında `VAKIFNAME_GUIDE_MODE=off`, sonra `systemctl restart vakifname-api`.
- Önceki sürüme dönüş: `ln -sfn /root/vakifname-preview/<önceki dist> /root/vakifname-preview/current &&
  systemctl restart vakifname-web`; yedekler `/root/vakifname-preview/backups/` altında.

## Yanıt süresi

Gerçek testte bir çağrı 84 sn sürdü. Sağlayıcı yanıtı akış olarak okunur ve süre her parçada denetlenir; çağrı
`VAKIFNAME_GUIDE_TIMEOUT_S` dolunca kesilir, kalan süre `min_call_s`'den (8 sn) azsa çağrı hiç yapılmaz. Zaman aşımına
uğrayan çağrı kotadan düşülür ve günlük sayaçta `timeouts`, ortalama ve en uzun sağlayıcı süresi olarak görülür
(`GET /guide/status` test oturumunda `detail.budget`). Yeniden deneme yoktur; art arda 3 hata devreyi 60 sn açar. Aynı
oturumdan süren bir soru varken ikinci soru 409 alır. Arayüz geçen süreyi ve aşamayı gösterir, 70 sn sonra isteği
yeniden göndermeden durur ve ziyaretçiye isterse yapay zekâsız kaynaklı arama sunar.

## Test erişimi (`testers` modu)

Test anahtarı URL'de, başlıkta, tarayıcı deposunda veya logda taşınmaz. Test kullanıcısı "Esere Sor" bölümündeki
"Yapay zekâ rehberi deneme erişimi" formuna anahtarı bir kez girer (`POST /guide/session`); sunucu anahtarın kendisini
değil, rastgele bir oturum kimliğini `HttpOnly`, `SameSite=Strict`, `Path=/guide` çerezle verir (8 saat). Sunucu yalnızca
kimliğin SHA-256 özetini bellekte tutar; yeniden başlatmada oturumlar kapanır. Çerezli istekler `X-Vakifname-Guide: 1`
başlığı da taşımalıdır (CSRF koruması; CORS listesi dışındaki origin'ler gönderemez). Dakikada 5 hatalı denemeden sonra
giriş 429 ile kapanır. Eski `#rehber=…` yöntemi kaldırıldı. Çerez ile API aynı site olmalıdır: arayüz
`http://127.0.0.1:4173` adresinden açılır (`localhost:4173` ayrı site sayılır, çerez gönderilmez).

## Gizlilik

Soru, konuşma geçmişi ve fotoğraf loglanmaz ve saklanmaz; fotoğraf yalnızca istek süresince bellekte işlenir. Fotoğraf
tarayıcıda küçültülüp JPEG'e yeniden kodlanır; sunucuda EXIF/GPS/XMP/IPTC/yorum blokları ayrıca silinir.

Yüz taraması iki yerel ONNX algılayıcının (UltraFace RFB-320 ve YuNet 2023mar, ikisi de MIT; dosya özetleri
`app/guide/privacy.py` içinde sabit) birlikte yüz bulmasına dayanır. Yayımlanmış 120 katalog görselinde yanlış alarm
0; denenen yüzlü örneklerin hepsi yakalandı (örnek sayısı küçük). Arkadan, çok küçük veya kapalı yüzler kaçabilir;
kişisel belge ve gizli yazı algılanmaz, bu yüzden ziyaretçi onayı da zorunludur. Modeller yoksa fotoğraf analizi kapalıdır.

Modelleri kurmak:

```bash
sudo install -d -m 755 /var/lib/vakifname/models/face
# version-RFB-320.onnx  (github.com/onnx/models · validated/vision/body_analysis/ultraface/models)
# face_detection_yunet_2023mar.onnx  (github.com/opencv/opencv_zoo · models/face_detection_yunet)
sudo install -m 644 version-RFB-320.onnx face_detection_yunet_2023mar.onnx /var/lib/vakifname/models/face/
```

Pillow (`pip install pillow==11.3.0`) genel API ortamına kurulu olmalıdır.
