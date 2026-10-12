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
