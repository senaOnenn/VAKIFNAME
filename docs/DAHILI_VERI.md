# Dahili veri katmanı ve editör onayı (ekip notları)

> Bu bölüm 30 Ekim'de README'den olduğu gibi taşındı (yazan: ekip). Genel uygulama bu katmanı kullanmaz; güncel ürün için README ve CLAUDE.md.

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
