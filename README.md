# VAKIFNAME
VAKIFNAME - Oyunlaştırılmış Kültür Turu &amp; RAG Destekli Canlı Vasiyet Platformu (Team HisGuard)

## Backend'i çalıştırma

Gereksinim: Python 3.10+

### Linux / macOS

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Windows (PowerShell)

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Uygulama `http://127.0.0.1:8000` adresinde açılır, API dokümantasyonu `http://127.0.0.1:8000/docs` adresindedir.

Testler (`backend` klasöründe, sanal ortam aktifken): `python -m pytest`

### Endpoint'ler

| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/` | Sağlık kontrolü |
| GET | `/places` | Eser listesi |
| GET | `/places/{place_id}` | Eser detayı (bulunamazsa 404) |
| POST | `/quests/{place_id}/check-in` | `{"user_id", "latitude", "longitude"}` ile konum check-in'i |
| GET | `/users/{user_id}/passport` | Kullanıcının mühürleri |

### Eser verisi

Eserler `data/places.json` dosyasından okunur. Farklı bir dosya kullanmak için `VAKIFNAME_PLACES_FILE` ortam değişkenini ayarlayın.

Şu anki kayıtların tamamı **kurgusaldır** (`is_demo: true`). Koordinatları okyanus üzerindedir ve gerçek bir eseri temsil etmez. Gerçek eser kayıtları yalnızca doğrulanabilir bir kaynakla (`source_title`, `source_url`) ve `is_demo: false` olarak eklenmelidir.

### CORS (tarayıcıdan erişim)

Tarayıcıda çalışan bir frontend'in API'yi çağırabilmesi için origin'i izin listesinde olmalıdır. `VAKIFNAME_CORS_ORIGINS` tanımlı değilse yalnızca yerel geliştirme origin'lerine izin verilir:

`http://localhost:3000`, `http://localhost:5173`, `http://127.0.0.1:3000`, `http://127.0.0.1:5173`

Farklı origin'ler için virgülle ayrılmış **tam** adresler verin (şema, alan adı ve port birebir eşleşmelidir). Bu değişken tanımlandığında varsayılan liste kullanılmaz. `*` kabul edilmez.

```bash
# Linux / macOS
export VAKIFNAME_CORS_ORIGINS="https://vakifname.example,http://localhost:5173"
```

```powershell
# Windows (PowerShell)
$env:VAKIFNAME_CORS_ORIGINS = "https://vakifname.example,http://localhost:5173"
```

CORS yalnızca tarayıcıların hangi sitelerden istek atabileceğini belirler. Bir kimlik doğrulama veya erişim kontrolü mekanizması **değildir**: `curl` gibi tarayıcı dışı istemciler origin listesinden bağımsız olarak API'ye erişebilir.

### Bilinen sınırlamalar (MVP)

- **İlerleme bellekte tutulur:** Sunucu yeniden başlatıldığında tüm mühürler silinir. Birden fazla worker ile çalıştırıldığında her worker'ın kendi verisi olur.
- **Konum doğrulanmaz:** Check-in, istemcinin bildirdiği koordinatlara güvenir. Bu bir simülasyondur; GPS sahteciliğini engellemez ve kullanıcının eseri gerçekten ziyaret ettiğini kanıtlamaz.
- **Kimlik doğrulama yoktur:** `user_id` serbest metindir.

## Dahili V20 veri katmanı

> **Yalnızca yetkili dahili geliştirme içindir.** Tarihsel editör onayı ve kaynak/görsel lisans incelemesi tamamlanmadı. Hiçbir kayıt genel API'de, haritada, check-in akışında veya frontend'de kullanılmaz.

V20 bilgi tabanı (10 `BUR-xxxx` eseri, 80 olgu, karantinadaki 57 aday kayıt), orijinal PDF'ler, dahili RAG paketi ve görseller repository **dışında**, yalnızca sunucu kullanıcısının okuyabildiği bir dizinde tutulur (varsayılan `/var/lib/vakifname-internal`, `VAKIFNAME_INTERNAL_DATA_DIR` ile değiştirilebilir, izinler `0700`/`0600`):

```
v20/            V20 bilgi tabanı, freeze manifesti, editoryal raporlar
sources/        Orijinal PDF'ler
rag/runtime/    Dahili RAG teslim paketi (V3 çekirdek, FAISS indeksi)
rag/venv/       RAG bağımlılıkları için ayrı sanal ortam
images/monuments/BUR-xxxx/*.jpeg
manifests/      source_registry.json, source_page_audit.json, image_manifest.json
models/         Yerel embedding modeli (sabit revizyon)
```

- Kod: `backend/app/internal/`. Genel uygulama (`app.main`) bu paketi içe aktarmaz; `/places`, check-in ve pasaport sözleşmeleri değişmedi.
- Kaynak sayfaları **fiziksel PDF sayfasıdır** (1 tabanlı). V20 basılı sayfa numarası içermez; türetilmez.
- V20'de koordinatlar boştur ve `null` olarak tutulur. Doğrulanmış konumu olmayan eser check-in'e çevrilemez (`to_checkin_place`).
- Görselin bir esere klasörle bağlanması yayın izni değildir; görseller hiçbir API'den sunulmaz.

### Manifestleri üretme

```bash
cd backend
/var/lib/vakifname-internal/rag/venv/bin/pip install -r requirements-internal.txt
/var/lib/vakifname-internal/rag/venv/bin/python -I scripts/build_internal_manifests.py
```

### Dahili API (yalnızca loopback)

```bash
cd backend
export VAKIFNAME_INTERNAL_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR=/var/lib/vakifname-internal/models/multilingual-e5-small-614241f
HF_HUB_OFFLINE=1 /var/lib/vakifname-internal/rag/venv/bin/python -m app.internal.server --port 8765
```

Yalnızca `127.0.0.1` / `::1` üzerinde dinler, loopback dışındaki istemcileri 403 ile reddeder ve her istekte `X-Internal-Token` başlığı ister (401). CORS ve OpenAPI sayfaları kapalıdır. Anahtar frontend'e konmamalıdır.

| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/internal/status` | Kayıt sayıları ve erişim politikası |
| GET | `/internal/catalog/monuments[/{id}]` | Eserler, olgular, açık sorunlar |
| GET | `/internal/catalog/facts/{fact_id}` | Tek olgu ve kaynak referansı |
| GET | `/internal/catalog/issues` | Açık editoryal sorunlar |
| GET | `/internal/catalog/drafts` | Karantinadaki aday kayıtlar (yalnızca editoryal inceleme) |
| GET | `/internal/catalog/images` | Görsel envanteri (yalnızca meta veri) |
| POST | `/internal/rag/ask` | `{"question": "..."}` — kaynak kontrollü, LLM'siz cevap |

RAG embedding modeli (`intfloat/multilingual-e5-small`) çalışma sırasında ağdan **indirilmez**. `VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR` yerel bir model klasörünü göstermiyorsa anlamsal arama gerektiren sorular kaynak göstermeden `retrieval_unavailable` döner; kural tabanlı cevaplar (tarih çelişkisi, kubbe sayısı, güncel bilgi reddi) çalışmaya devam eder.

### Embedding modeli

Model bir kez, sabit bir revizyonla ve yalnızca gerekli dosyalarla korumalı dizine indirilir (`trust_remote_code` kullanılmaz; depoda Python kodu yoktur):

```bash
umask 077
/var/lib/vakifname-internal/rag/venv/bin/python -I -c "
from huggingface_hub import snapshot_download
snapshot_download('intfloat/multilingual-e5-small',
    revision='614241f622f53c4eeff9890bdc4f31cfecc418b3',
    local_dir='/var/lib/vakifname-internal/models/multilingual-e5-small-614241f',
    allow_patterns=['config.json', 'model.safetensors', 'modules.json', '1_Pooling/config.json',
                    'sentence_bert_config.json', 'sentencepiece.bpe.model', 'special_tokens_map.json',
                    'tokenizer.json', 'tokenizer_config.json'])"
export VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR=/var/lib/vakifname-internal/models/multilingual-e5-small-614241f
```

Anlamsal arama ilk kullanıldığında indeksteki 80 belge vektörü yerel modelle yeniden kodlanıp karşılaştırılır (indeks değiştirilmez). En düşük kosinüs benzerliği `0.999`'un altındaysa cevaplar `retrieval_reliable: false` ve `embedding_index_mismatch` uyarısı taşır; ölçümler `/internal/status` içinde `rag_index_compatibility` alanında görünür. Mevcut teslim indeksi bu revizyonla birebir üretilmemiştir (en düşük kosinüs ≈0.97); bu nedenle anlamsal arama sonuçları şimdilik güvenilir sayılmaz.

### Testler

Kurgusal veriyle çalışan testler her ortamda çalışır. Gerçek veri ve RAG testleri, korumalı dizin ve `requirements-internal.txt` bağımlılıkları yoksa; gerçek model testleri `VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR` tanımlı değilse atlanır:

```bash
cd backend
HF_HUB_OFFLINE=1 VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR=/var/lib/vakifname-internal/models/multilingual-e5-small-614241f \
  /var/lib/vakifname-internal/rag/venv/bin/python -m pytest
```

## Frontend'i çalıştırma

React + TypeScript + Vite ile yazılmış web arayüzü `frontend/` klasöründedir. Eser, görev ve pasaport verilerini doğrudan backend'den alır; frontend içinde sabit eser listesi yoktur.

Gereksinim: Node.js `20.19+` veya `22.12+`. Önce backend'i yukarıdaki gibi `http://127.0.0.1:8000` adresinde başlatın.

### Linux / macOS

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

### Windows (PowerShell)

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Arayüz `http://localhost:5173` adresinde açılır.

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu (`http://localhost:5173`) |
| `npm test` | Vitest + React Testing Library testleri (ağ erişimi gerekmez) |
| `npm run build` | Tür denetimi ve üretim derlemesi (`frontend/dist`) |
| `npm run preview` | Üretim derlemesini `http://localhost:5173` adresinde sunar |

### Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Backend adresi. Derleme sırasında koda gömülür; gizli bilgi koymayın. |

Frontend 5173 portunda çalışır çünkü bu port backend'in varsayılan CORS listesinde bulunur. Frontend'i başka bir adreste yayınlarsanız o adresi backend'de `VAKIFNAME_CORS_ORIGINS` ile tanımlayın.

### Harita

Harita, OpenStreetMap karolarını internet üzerinden yükler. Bağlantı yoksa harita altlığı görünmez ama eser listesi ve ayrıntılar çalışmaya devam eder. Mevcut kayıtlar kurgusal olduğu için harita üzerinde "Kurgusal demo konumları" uyarısı gösterilir.

OpenStreetMap'in genel karo sunucusu geliştirme ve demo içindir. Yüksek trafikli yayında [kullanım politikasına](https://operations.osmfoundation.org/policies/tiles/) uygun bir karo sağlayıcı kullanılmalıdır.

### Görevler ve dijital pasaport

Her eser için bir keşif görevi vardır. "Demo konumuyla görevi dene" butonu, eserin backend kaydındaki koordinatlarla `POST /quests/{place_id}/check-in` isteği gönderir; tarayıcı konumu (GPS) istenmez ve kullanılmaz. Demo check-in gerçek bir ziyaretin kanıtı değildir.

Pasaport (`GET /users/{user_id}/passport`) ve görev durumları yalnızca backend verisinden gösterilir; mühürler tarayıcıda saklanmaz. Backend ilerlemeyi bellekte tuttuğu için sunucu yeniden başlatılınca mühürler silinir ve arayüz de bunu boş pasaport olarak gösterir.

`user_id`, her tarayıcı sekmesi oturumu için üretilen rastgele bir demo kimliğidir (`sessionStorage`). Kullanıcı hesabı veya kimlik doğrulama **değildir**; kişisel bilgi istenmez.

### Henüz olmayanlar

Gerçek kullanıcı hesapları, gerçek konum doğrulaması ve RAG sohbeti bu sürümde yoktur.
