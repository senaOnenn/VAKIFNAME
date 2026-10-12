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

### Bilinen sınırlamalar (MVP)

- **İlerleme bellekte tutulur:** Sunucu yeniden başlatıldığında tüm mühürler silinir. Birden fazla worker ile çalıştırıldığında her worker'ın kendi verisi olur.
- **Konum doğrulanmaz:** Check-in, istemcinin bildirdiği koordinatlara güvenir. Bu bir simülasyondur; GPS sahteciliğini engellemez ve kullanıcının eseri gerçekten ziyaret ettiğini kanıtlamaz.
- **Kimlik doğrulama yoktur:** `user_id` serbest metindir.
