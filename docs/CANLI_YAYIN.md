# Canlı test ortamı: calismalar.tikirsoft.com

> Test içindir; alan adı değişebilir (değişince: Google OAuth yetkili kaynak, `api.env` adresleri, `nginx.conf`
> `server_name`, `calismalar-web.service` `--api-origin` ve arayüz derlemesindeki `VITE_API_BASE_URL`).

**Sunucu:** 89.167.32.115 (`ssh 89.167.32.115`, port 4242). Aynı sunucuda Tıkır, odak, Signal Brief ve ekibin eski
VAKIFNAME servisleri (8110, 4173) çalışır; **onlara dokunulmaz.**

## Yerleşim (`/root/calismalar`, yalnızca root)
| Yol | Ne |
|---|---|
| `app/backend`, `app/data` | Kod (Mac'ten rsync) ve `.venv` (sunucuda `pip install -r requirements.txt`) |
| `web/` | Arayüz derlemesi (Mac'te derlenir, rsync; sunucuda derleme yok) |
| `data/` | Katalog kopyası + fotoğraflar (`public_catalog/`), hesap/ilerleme/istatistik veritabanları, içerik deposu (`content/`) |
| `api.env` | Ayarlar (chmod 600; şablon `deploy/calismalar/api.env.example`) |
| `nginx.conf` | `/etc/nginx/sites-enabled/calismalar.tikirsoft.com` buna bağlantı |
| `calismalar-api.service`, `calismalar-web.service` | `systemctl link` ile bağlı; API 127.0.0.1:8120, site 127.0.0.1:4180 |

Akış: Cloudflare (HTTPS, `*.tikirsoft.com` origin sertifikası) → nginx 443 → `/api/` → 8120, diğer her şey → 4180.
Rehber: sunucudaki `claude` oturumu (talha.aygen@konzek.com, Pro), `VAKIFNAME_CLAUDE_BIN=/root/.local/bin/claude`.

## Güncelleme (Mac'ten)
```bash
cd ~/VAKIFNAME
(cd frontend && VITE_API_BASE_URL=https://calismalar.tikirsoft.com/api npm run build)
rsync -az --delete --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude tests --exclude scripts \
  --exclude 'local-*' --exclude .env --exclude '*.sqlite3*' backend/ 89.167.32.115:/root/calismalar/app/backend/
rsync -az --delete data/ 89.167.32.115:/root/calismalar/app/data/
rsync -az --delete frontend/dist/ 89.167.32.115:/root/calismalar/web/
ssh 89.167.32.115 'cd /root/calismalar/app/backend && .venv/bin/pip install -q -r requirements.txt && systemctl restart calismalar-api calismalar-web'
```

## Açık
- E-posta (SMTP) bilgisi gelene kadar `VAKIFNAME_MAIL_BACKEND=off`: parolayla kayıt olan e-postasını doğrulayamaz; Google ve misafir çalışır.
- Cloudflare Web Analytics betiği CSP ile engellenir (üçüncü taraf takip yok); istenirse Cloudflare panelinden kapatılabilir.
