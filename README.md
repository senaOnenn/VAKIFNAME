# VAKIFNAME
VAKIFNAME - Oyunlaştırılmış Kültür Turu &amp; RAG Destekli Canlı Vasiyet Platformu (Team HisGuard)

## Takım için hızlı başlangıç

**Amaç:** Bursa'daki vakıf eserlerini (10 eserlik dijital katalog, editörün onayladığı 76 tarihî bilgi) eser sayfaları,
fotoğraf galerisi, harita, keşif görevleri ve dijital pasaportla oyunlaştırılmış bir kültür turuna dönüştürmek. Tarihî
bilgiler yalnızca insan onayından geçmiş kayıtlardan gelir; yapay zekâ rehberi bu kayıtların dışına çıkamaz.

### Dallar

| Dal | Durum | Kullanım |
|---|---|---|
| `develop` | **Kararlı ortak sürüm.** Backend ve frontend testleri geçer; testers ortamında doğrulanmış rehber sürümünü içerir. | Yeni işler buradan dallanır. |
| `feat/game` | Oyun geliştirme dalı (`develop` ile aynı noktadan başlar) | Oyun ekibi. |
| `feat/ai-guide-photo-analysis` | **Henüz tam doğrulanmadı** (bkz. o daldaki `docs/GELISTIRME_NOTLARI_YAPAY_ZEKA.md`) | Yalnızca yapay zekâ rehberi geliştirmesi. |
| `main` | Önceki birleştirilmiş sürüm | `develop`, gözden geçirme sonrası PR ile birleştirilir. |

### Kurulum (gizli anahtar veya canlı veritabanı gerekmez)

```bash
git clone git@github.com:senaOnenn/VAKIFNAME.git && cd VAKIFNAME
git switch develop            # oyun ekibi: git switch feat/game

# Backend (Python 3.10+; 3.12 ile test edildi)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && set -a && . ./.env && set +a     # sahte/varsayılan değerler
uvicorn app.main:app --reload --port 8000

# Frontend (ayrı terminal; Node 20.19+ veya 22.12+)
cd frontend
cp .env.example .env          # VITE_API_BASE_URL=http://127.0.0.1:8000
npm ci
npm run dev                   # http://localhost:5173  ·  demo oyun: http://localhost:5173/?mod=demo
```

### Ortam değişkenleri

Tam liste ve açıklamalar: `backend/.env.example` ve `frontend/.env.example`. Oyun geliştirmesi için yeterli olanlar:

| Değişken | Değer | Ne işe yarar |
|---|---|---|
| `VAKIFNAME_DEMO_API` | `on` | Kurgusal demo mekânları, demo check-in ve pasaport uçları (`/places`, `/quests/...`) |
| `VAKIFNAME_PUBLIC_CATALOG_FILE` | `tests/ask_eval/catalog_snapshot.json` | Örnek gerçek katalog (10 eser, 76 onaylı olgu) |
| `VAKIFNAME_GUIDE_MODE` | `off` | Yapay zekâ rehberi kapalı; anahtar gerekmez |
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Frontend'in bağlandığı backend |

Anahtarlar (OpenRouter/NVIDIA, dahili erişim anahtarı) depoda **yoktur**; yalnızca yetkili sunucuda korumalı dosyalarda
tutulur. `.env` dosyaları Git'e girmez.

### Örnek veriyle geliştirme

- **Demo oyun:** `data/places.json` kurgusal mekânlardır; `VAKIFNAME_DEMO_API=on` ile `/places` ve demo görevler çalışır.
- **Gerçek katalog:** `backend/tests/ask_eval/catalog_snapshot.json` onaylı olguların test anlık görüntüsüdür. Fotoğraf
  dosyaları depoda olmadığı için galeride görseller yüklenmez (kayıtlar ve kaynak bilgileri görünür).
- **Kurgusal yayın akışı:** `backend/scripts/e2e_fictional_catalog.py <boş-dizin>` BUR-9xxx kurgusal kataloğu üretir.
- Dahili V20 verisi, inceleme veritabanı, kitap görselleri ve 121 fotoğraflık ZIP arşivinin görselleri depoda yoktur;
  bunlara bağlı testler kendiliğinden atlanır.

### Oyun bölümünün klasör yapısı

```text
frontend/src/
  demo/DemoGame.tsx                      Demo Keşif Oyunu (?mod=demo; üretim derlemesine girmez)
  components/Quest*.tsx                  Görev paneli, görev durumu rozeti, görev bölümü
  components/PassportSection.tsx, Seal.tsx   Dijital pasaport ve mühürler
  components/Place*.tsx, MapSection.tsx  Mekân listesi, kartı, ayrıntısı ve harita (Leaflet)
  hooks/useCheckIn.ts, useSelectedPlace.ts, useApi.ts
  api/client.ts, api/types.ts            Backend istemcisi ve tipler
  demoUser.ts, visitor.ts                Demo kullanıcı ve ziyaretçi kimliği (kişisel veri yok)
  QuestPassport.test.tsx                 Görev + pasaport akış testleri
backend/app/
  routes.py, services.py, models.py      Demo mekân, check-in, görev ve pasaport uçları
  monument_routes.py, progress.py        Gerçek eser görevleri, check-in, mühür ve pasaport
  geo.py                                 Mesafe/yarıçap doğrulaması
backend/tests/test_api.py, test_batch_and_quests.py, test_hardening.py
data/places.json                         Kurgusal demo mekânları
```

### Test komutları

```bash
cd backend && python -m pytest -q     # özel veri yoksa ilgili testler atlanır (skipped)
cd frontend && npm test               # vitest
cd frontend && npx tsc -b             # TypeScript denetimi
cd frontend && npm run build          # derleme + genel paket denetimi (scripts/check-public-build.mjs)
```

### Önerilen Git iş akışı (oyun ekibi)

1. `git switch feat/game && git pull` — güncel oyun dalı.
2. Küçük işler için kısa dallar: `git switch -c feat/game-<konu>`; commit'ler küçük ve açıklayıcı olsun.
3. `develop`'taki yenilikleri almak için `git fetch origin && git merge origin/develop` (paylaşılan dalda rebase ve
   `--force` kullanılmaz).
4. İş bitince `feat/game-<konu>` → `feat/game` PR'ı; oyun özelliği tamamlanınca `feat/game` → `develop` PR'ı.
5. Commit öncesi backend/frontend testleri ve `npx tsc -b`. `.env`, anahtar, veritabanı, görsel ve PDF eklenmez.

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

Genel API (`/places`, check-in, pasaport) yalnızca **Demo Keşif Oyunu**'nun kurgusal mekânlarını (`DemoPlace`) sunar. Koordinatları okyanus üzerindedir ve gerçek bir eseri temsil etmez. Bu dosyadaki her kayıt `is_demo: true` olmalıdır ve kimliği `BUR-` ile başlayamaz; aksi halde uygulama açılmaz. Gerçek Bursa eserleri (`RealMonument`, `BUR-xxxx`) bu dosyaya eklenmez; yalnızca dahili katalogda tutulur (bkz. "Dahili V20 veri katmanı"). Onaylı gerçek eserler ayrı `/monuments` API'siyle sunulur (bkz. "Gerçek eser kataloğu ve editör onayı").

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

> **Yalnızca yetkili dahili geliştirme içindir.** Tarihsel editör onayı ve kaynak/görsel lisans incelemesi tamamlanmadı. Bir kayıt ancak inceleme veritabanında ilgili onay kararları kayıtlıysa ve dışa aktarıldıysa genel katalogda görünür; şu anda hiçbir kayıt bu durumda değildir.

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
# Anahtar bir kez, yalnızca root'un okuyabildiği dosyaya üretilir; süreç ortamına konmaz.
sudo install -d -m 700 /var/lib/vakifname-internal/secrets
sudo bash -c 'umask 077; python3 -c "import secrets; print(secrets.token_urlsafe(48))" > /var/lib/vakifname-internal/secrets/internal_token'
export VAKIFNAME_INTERNAL_TOKEN_FILE=/var/lib/vakifname-internal/secrets/internal_token
export VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR=/var/lib/vakifname-internal/models/multilingual-e5-small-614241f
HF_HUB_OFFLINE=1 /var/lib/vakifname-internal/rag/venv/bin/python -m app.internal.server --port 8765
```

Anahtar rotasyonu (yetkili yönetici onayıyla; anahtar yazdırılmaz, inceleme veritabanı önce yedeklenir, hata olursa geri
alınır): `sudo python3 -I scripts/rotate_internal_token.py` (ön denetim) ve ardından `--yes`.

Yalnızca `127.0.0.1` / `::1` üzerinde dinler, loopback dışındaki istemcileri 403 ile reddeder ve her istekte yetki ister (401). CORS ve OpenAPI sayfaları kapalıdır; yanıtlar `Cache-Control: no-store` taşır. Anahtar frontend koduna veya `VITE_*` değişkenlerine konmaz. İki yetki yolu vardır:

- **Komut satırı / betik:** `X-Internal-Token` başlığı.
- **Tarayıcıdaki envanter ekranı:** anahtar formdan bir kez `POST /internal/session` ile gönderilir. Sunucu 2 saatlik, `HttpOnly`, `SameSite=Strict`, `Path=/internal` bir oturum çerezi verir (anahtarın kendisi değil). Çerezli istekler `X-Vakifname-Review: 1` başlığı da taşımalıdır (CSRF koruması). Dakikada 5 hatalı denemeden sonra giriş 429 ile geçici olarak kapanır. Oturumlar bellekte tutulur; sunucu yeniden başlatılınca düşer.

| Metot | Yol | Açıklama |
|---|---|---|
| POST / GET / DELETE | `/internal/session` | İnceleme oturumu aç / denetle / kapat |
| GET | `/internal/status` | Kayıt sayıları, konum durumları ve erişim politikası |
| GET | `/internal/catalog/monuments[/{id}]` | Eserler; konum kaydı (`location`), inceleme durumu ve yayın engelleri (`review`); ayrıntıda olgular, fiziksel sayfa referansları ve sayfa denetimi, açık sorunlar |
| GET | `/internal/catalog/facts/{fact_id}` | Tek olgu ve kaynak referansı |
| GET | `/internal/catalog/issues` | Açık editoryal sorunlar |
| GET | `/internal/catalog/drafts` | Karantinadaki aday kayıtlar (yalnızca editoryal inceleme) |
| GET | `/internal/catalog/images` | Görsel envanteri (yalnızca meta veri) |
| POST | `/internal/rag/ask` | `{"question": "..."}` — kaynak kontrollü, LLM'siz cevap |

RAG embedding modeli (`intfloat/multilingual-e5-small`) çalışma sırasında ağdan **indirilmez**. `VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR` yerel bir model klasörünü göstermiyorsa anlamsal arama gerektiren sorular kaynak göstermeden `retrieval_unavailable` döner; kural tabanlı cevaplar (tarih çelişkisi, kubbe sayısı, güncel bilgi reddi) çalışmaya devam eder.

### Veri modelleri

| Model | Nerede | Kural |
|---|---|---|
| `DemoPlace` | `app/models.py` | Genel API'nin tek mekân tipi. `is_demo: true` zorunlu, `BUR-` kimliği yasak. |
| `RealMonument` | `app/internal/catalog.py` | `BUR-xxxx` kimlikli gerçek eser. Genel API'de, haritada, check-in'de yok. |
| `LocationRecord` | `app/internal/catalog.py` | `missing` / `unverified` / `verified`. `verified` için koordinat kaynağı (`field_survey_gnss`, `official_registry`, `cadastral_parcel`, `editor_map_review`), kaynak belgesi, doğruluk (m), doğrulayan ve tarih zorunlu. Koordinat tahmin edilmez; V20'deki tüm eserler `missing`. |
| `HistoricalFact` + `SourceReference` | `app/internal/catalog.py` | Kaynak PDF ve fiziksel sayfa; `source_page_audit.json` ile alıntının o sayfada bulunup bulunmadığı. |
| `ReviewStatus` | `app/internal/review.py` | Eser başına editör, lisans, kaynak denetimi, görsel ve konum durumu; `public_release_blockers` boş olmadan eser yayına alınamaz. |

Doğrulanmış konum tek başına check-in açmaz: harita gösterimi (`location_map_display`) ve GPS check-in (`gps_checkin`) ayrı kararlardır.

## Gerçek eser kataloğu ve editör onayı

Akış: **araştırma → kişisel incelemeci kararları → dışa aktarma → genel API**. Genel uygulama V20'yi veya inceleme veritabanını okumaz.

1. **Araştırma** (`data/real_catalog/monument_research.json`, `app/internal/research.py`): 10 eserin kaynakları (Kültür Portalı, Bursa Alan Başkanlığı, V20 PDF fiziksel sayfası), adres iddiaları, kaynaklar arası tutarsızlıklar ve WGS84 koordinat adayları. Dosyadaki her aday `unverified`'dir; dosya `verified` veya incelemeci adı içeremez.
2. **İnceleme** (`app/internal/review_store.py`, `decisions.py`): `<veri dizini>/review/review.sqlite3`. Kararlar yalnızca eklenir (tetikleyiciler UPDATE/DELETE'i reddeder), denetim günlüğü hash zinciridir. Kayıtlı karar yoksa durum `pending`'dir; kaynak sayfa denetimi onay yerine geçmez.
   - Paylaşılan `VAKIFNAME_INTERNAL_TOKEN` **bir kişinin kimliğini kanıtlamaz**; yalnızca okuma sağlar. Karar için kişisel hesap gerekir:
     ```bash
     cd backend
     /var/lib/vakifname-internal/rag/venv/bin/python -m app.internal.reviewers add --id ayse.editor --name "Ayşe Yılmaz" --role editor
     # roller: editor (olgu/kimlik/sorun), rights (kaynak ve görsel hakları), location (konum, harita, check-in)
     ```
   - Her karar tek kayıt içindir: önce `POST /internal/review/tickets`, en az 5 sn sonra `POST /internal/review/decisions` (gerekçe ≥15 karakter, onayda kaynak kontrolü). İncelemeci başına 10 dakikada en çok 20 karar. Kayıt veya veri sürümü değişirse karar `stale` olur.
   - Karar türleri: `catalog_identity`, `fact_editorial`, `fact_publication`, `fact_game_use`, `source_usage_rights`, `image_rights`, `image_publication`, `image_game_use`, `location_verification`, `location_map_display`, `gps_checkin`, `issue_resolution`, `draft_triage` (yayına etkisi yok).
3. **Dışa aktarma** (yalnızca tüm zinciri geçerli kayıtlar):
   ```bash
   cd backend
   /var/lib/vakifname-internal/rag/venv/bin/python -m app.internal.publish --out ../data/public_catalog/catalog.json
   ```
4. **Genel API** (`app/public_catalog.py`, `app/monument_routes.py`; dosya `VAKIFNAME_PUBLIC_CATALOG_FILE`, yoksa katalog boştur):

| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/monuments` | Yayımlanmış eserler; `location` doğrulanmış ve haritası onaylı değilse `null` |
| GET | `/monuments/{monument_id}` | Onaylı olgular (kaynak + fiziksel sayfa), onaylı görseller; yayımlanmamış eser 404 |
| GET | `/monuments/media/{sha256}.jpeg` | Yalnızca yayın onaylı görsel |
| POST | `/monuments/{monument_id}/check-in` | Yalnızca `gps_checkin` onaylıysa; aksi halde 409 |
| GET | `/users/{user_id}/monument-passport` | Gerçek eser mühürleri (demo pasaportundan ayrı) |

Ek dahili uçlar: `POST/DELETE /internal/session/reviewer`, `GET /internal/review/overview`, `GET /internal/review/subjects/{tür}/{kimlik}`, `GET /internal/review/audit`, `GET /internal/review/publication-preview`, `GET /internal/catalog/research/{id}`.

Frontend: varsayılan sayfa **Gerçek Bursa Eserleri** (`/monuments`); **Demo Keşif Oyunu** `?mod=demo` (üretimde `VITE_DEMO_GAME=off` ile kapatılabilir); envanter yalnızca geliştirme sunucusunda `?mod=envanter`. `npm run build` sonunda `scripts/check-public-build.mjs` paketin dahili envanter içermediğini denetler.

RAG genel yayını kapalıdır (FAISS indeks uyumsuzluğu, kanıtsız soruda ilgisiz sonuç); ayrı kalite ve onay aşaması gerekir.

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

### Geliştirme modları

`npm run dev` ile açılan sayfanın üstündeki "Geliştirme ortamı" çubuğu iki ayrı deneyim sunar:

1. **Demo Keşif Oyunu** (varsayılan): kurgusal demo mekânları; harita, check-in, görevler, mühür ve pasaport.
2. **Gerçek Bursa Envanteri** (`?mod=envanter`): 10 gerçek eserin dahili, erişim kontrollü önizlemesi. Kimlik, kayıt durumu, koordinat doğrulaması, kaynak sayfa denetimi, görsel lisans durumu ve yayın engelleri gösterilir; eser seçilince olgular, fiziksel PDF sayfa referansları, alıntılar ve karantinadaki adaylar incelenebilir. Harita, görev veya check-in içermez; görseller gösterilmez.

Envanter için dahili sunucuyu yukarıdaki gibi `127.0.0.1:8765` üzerinde başlatın. Vite geliştirme sunucusu `/internal` isteklerini yalnızca bu makineden gelen tarayıcılar için oraya iletir (`vite.config.ts`). Envanter kodu yalnızca `import.meta.env.DEV` altında yüklenir; `npm run build` çıktısında ve `npm run preview`'da envanter ekranı ve `/internal` proxy'si yoktur.

### Harita

Harita, OpenStreetMap karolarını internet üzerinden yükler. Bağlantı yoksa harita altlığı görünmez ama eser listesi ve ayrıntılar çalışmaya devam eder. Mevcut kayıtlar kurgusal olduğu için harita üzerinde "Kurgusal demo konumları" uyarısı gösterilir.

OpenStreetMap'in genel karo sunucusu geliştirme ve demo içindir. Yüksek trafikli yayında [kullanım politikasına](https://operations.osmfoundation.org/policies/tiles/) uygun bir karo sağlayıcı kullanılmalıdır.

### Görevler ve dijital pasaport

Her eser için bir keşif görevi vardır. "Demo konumuyla görevi dene" butonu, eserin backend kaydındaki koordinatlarla `POST /quests/{place_id}/check-in` isteği gönderir; tarayıcı konumu (GPS) istenmez ve kullanılmaz. Demo check-in gerçek bir ziyaretin kanıtı değildir.

Pasaport (`GET /users/{user_id}/passport`) ve görev durumları yalnızca backend verisinden gösterilir; mühürler tarayıcıda saklanmaz. Backend ilerlemeyi bellekte tuttuğu için sunucu yeniden başlatılınca mühürler silinir ve arayüz de bunu boş pasaport olarak gösterir.

`user_id`, her tarayıcı sekmesi oturumu için üretilen rastgele bir demo kimliğidir (`sessionStorage`). Kullanıcı hesabı veya kimlik doğrulama **değildir**; kişisel bilgi istenmez.

### Tasarım

Arayüz "Bursa'nın Kayıp Vakfiyesi" kültür atlası tasarımını izler: parşömen zemin, koyu zümrüt yeşili, bakır vurgu ve lacivert/altın pasaport kapağı. Eser kartlarındaki çizgisel mimari çizimler temsilidir; belirli bir eserin rölövesi veya fotoğrafı değildir ve ekranda böyle etiketlenir. Fotoğraflar, lisans ve eser eşleştirmesi onaylanmadan kullanılmaz.

Başlık yazı tipi Cormorant Garamond'dur (SIL Open Font License 1.1). Yalnızca Latin ve Türkçe karakterleri içeren bir WOFF2 alt kümesi olarak `src/assets/fonts/` altında tutulur; lisans metni `public/fonts/OFL-Cormorant-Garamond.txt` ile derlemeye eklenir.

### Henüz olmayanlar

Gerçek kullanıcı hesapları, gerçek konum doğrulaması, gerçek eserlerin genel kataloğu ve RAG sohbeti bu sürümde yoktur.

## Giriş videosu (ana sayfa)

Video depoda tutulmaz (`.gitignore`: `*.mp4`). Sunucudaki tek dosya `../vakifname-video-assets/hero.mp4`
(değiştirmek için `VAKIFNAME_HERO_VIDEO=/yol/hero.mp4`). `frontend/heroVideo.ts` eklentisi:

- `npm run dev`: yalnızca `/media/hero.mp4` rotasından, Range destekli sunar.
- `npm run build`: dosyayı MP4 olarak doğrulayıp değiştirmeden `dist/media/hero.mp4`'e kopyalar; statik sunucu aynı
  adresten verir. Dosya yoksa derleme uyarır ve sayfa temsilî çizimle açılır.
- CDN kullanılacaksa `VITE_HERO_VIDEO_URL=https://…/hero.mp4` verilir; dosya derlemeye kopyalanmaz.

Video yapay zekâ ile üretilmiştir (dosyadaki C2PA manifesti); arayüzde temsilî olarak etiketlenir, gerçek bir Bursa
eserinin kaydı olarak sunulmaz.

## Genel platform ve geliştirme ortamı ayrımı

- **Genel platform (production):** yalnızca yayın onaylı gerçek eserler (`GET /monuments`, `GET /monuments/{id}`),
  gerçek eser pasaportu ve video giriş. Geliştirme çubuğu, mod seçici, Demo Keşif Oyunu ve dahili envanter üretim
  derlemesinde yoktur; `?mod=demo` ve `?mod=envanter` yok sayılır (`frontend/scripts/check-public-build.mjs` denetler).
- **Geliştirme ortamı (`npm run dev`):** `?mod=envanter` (yetkili dahili inceleme) ve `?mod=demo` (kurgusal demo, otomatik
  testler için). Demo uçları genel API'de varsayılan olarak kapalıdır; geliştirmede `VAKIFNAME_DEMO_API=on` ile açılır.
- **Yayın:** dışa aktarıcı (`python -m app.internal.publish --out ../data/public_catalog/catalog.json`) dosyayı atomik
  olarak yazar; genel API dosya değişince kataloğu yeniden başlatma olmadan yeniler. Geçersiz dosya reddedilir, son
  geçerli katalog sunulmaya devam eder.

### Production çalıştırma

```bash
# 1) Genel API (demo kapalı; yalnızca yayın anlık görüntüsü)
cd backend && VAKIFNAME_CORS_ORIGINS=https://vakifname.example \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# 2) Arayüz derlemesi ve sunucusu (Vite dev sunucusu son kullanıcıya sunulmaz)
cd frontend && VITE_API_BASE_URL=https://api.vakifname.example npm run build
cd backend && .venv/bin/python -m app.web --dist ../frontend/dist --api-origin https://api.vakifname.example --port 4173
```

`app.web` yalnızca `dist` içeriğini sunar (CSP, `nosniff`, `X-Frame-Options: DENY`, video için Range). TLS ve dış
erişim bir ters vekil (nginx vb.) üzerinden verilmelidir. Dahili inceleme sunucusu (`app.internal.server`) ayrı kalır ve
yalnızca `127.0.0.1` üzerinde dinler.

Uçtan uca tarayıcı testleri (yalıtılmış portlar, geçici DB, kurgusal onay akışı dahil): `frontend/e2e/run.sh`.

## Zülal

Çalışma dalı: `feat/game` — oyun geliştirmeleri.

- Henüz güncelleme yok.
