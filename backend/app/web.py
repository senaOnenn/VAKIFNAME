"""Genel kullanıcı arayüzünün production sunucusu: derlenmiş `frontend/dist` dizinini sunar.

Vite geliştirme sunucusu son kullanıcıya sunulmaz. Bu uygulama yalnızca derleme çıktısındaki dosyaları verir; API'ye
vekillik etmez ve dahili inceleme sunucusuna hiçbir yol açmaz.

- `index.html` önbelleğe alınmaz; adı özetli `assets/*` bir yıl, `media/*` bir gün önbelleğe alınır.
- `media/hero.mp4` Range istekleriyle sunulur (Starlette `FileResponse`).
- İçerik Güvenliği Politikası (CSP): betik ve stil yalnızca aynı kaynaktan (+ Google ile giriş betiği ve düğmesi:
  `accounts.google.com/gsi/`); bağlantı yalnızca genel API'ye; harita karoları yalnızca OpenStreetMap'ten; video ve ses
  aynı kaynaktan ya da API'den. Çerçeveye alınamaz.
- İstemci tarafı yönlendirme: yalnızca uygulamanın bilinen sayfa yolları (`APP_ROUTES`) `index.html` döner (adres
  çubuğundan doğrudan açma, yenileme); bilinmeyen yol 404 döner.

    python -m app.web --dist ../frontend/dist --api-origin https://api.example.org --port 4173
"""

import argparse
import re
from pathlib import Path
from urllib.parse import urlsplit

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

TILE_ORIGIN = "https://tile.openstreetmap.org"
GSI = "https://accounts.google.com/gsi/"
# Arayüzün sayfa yolları (frontend/src/app/VakifnameApp.tsx). Yalnızca bunlar index.html'e düşer.
APP_ROUTES = re.compile(
    r"^/(giris|gizlilik|dogrula|sifre-sifirla|sifre-yenile|sehir|bursa|eserler|harita|rehber|pasaport|hesap|yonetim"
    r"|rota/[a-z0-9-]{1,40}|eser/[A-Za-z0-9-]{1,20}(/rozet)?"
    # Oyun paneli (Görev 34): giriş, kâşif seçimi, şehir, rota, eserin mühür yolu ve Rozeti Al.
    r"|oyun(/karakter|/sehir|/rota/[a-z0-9-]{1,40}|/eser/[A-Za-z0-9-]{1,20}(/rozet)?)?"
    r"|yonetim/icerik(/(eser|kayit|ceviri)/[A-Za-z0-9-]{1,30}(/yeni-kayit)?)?)/?$"
)


def _origin(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.path not in ("", "/"):
        raise ValueError("--api-origin yalnızca şema ve sunucu içermeli (ör. https://api.example.org).")
    return f"{parts.scheme}://{parts.netloc}"


def content_security_policy(api_origin: str) -> str:
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' {GSI}client",
        # Leaflet işaretçi ve katman konumlarını satır içi stil olarak yazar; Google düğmesinin kendi stili.
        f"style-src 'self' 'unsafe-inline' {GSI}style",
        f"frame-src {GSI}",
        # Yayın onaylı eser fotoğrafları genel API'nin `/monuments/media` ucundan gelir.
        f"img-src 'self' data: {TILE_ORIGIN} {api_origin}",
        f"media-src 'self' {api_origin}",
        "font-src 'self'",
        f"connect-src 'self' {api_origin} {GSI}",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    ])


class _Headers(BaseHTTPMiddleware):
    def __init__(self, app, csp: str):
        super().__init__(app)
        self.csp = csp

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        h = response.headers
        h["Content-Security-Policy"] = self.csp
        h["X-Content-Type-Options"] = "nosniff"
        h["Referrer-Policy"] = "strict-origin-when-cross-origin"
        h["X-Frame-Options"] = "DENY"
        h["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=(), payment=()"
        # Google ile giriş açılır penceresi için (GIS önerisi); başka kökenle pencere paylaşımı yok.
        h["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
        if path.startswith("/assets/") and response.status_code == 200:
            h["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.startswith("/media/") and response.status_code in (200, 206):
            h["Cache-Control"] = "public, max-age=86400"
        else:
            h["Cache-Control"] = "no-cache"
        return response


def create_web_app(dist: Path, api_origin: str) -> Starlette:
    dist = Path(dist).resolve()
    index = dist / "index.html"
    if not index.is_file():
        raise FileNotFoundError(f"{index} yok; önce `npm run build` çalıştırın.")
    csp = content_security_policy(_origin(api_origin))

    async def home(request: Request) -> Response:
        return FileResponse(index, media_type="text/html; charset=utf-8")

    async def not_found(request: Request, exc: Exception) -> Response:
        if request.method in ("GET", "HEAD") and APP_ROUTES.match(request.url.path):
            return FileResponse(index, media_type="text/html; charset=utf-8")
        return PlainTextResponse("Bulunamadı.", status_code=404)

    routes = [
        Route("/", home, methods=["GET", "HEAD"]),
        Route("/index.html", home, methods=["GET", "HEAD"]),
        # StaticFiles dizin dışına çıkan yolları reddeder; `html=False`: dizin listesi yok. Sayfa yolları 404 işleyicisinde.
        Mount("/", app=StaticFiles(directory=dist, html=False, follow_symlink=False)),
    ]
    app = Starlette(routes=routes, exception_handlers={404: not_found})
    app.add_middleware(_Headers, csp=csp)
    return app


def main(argv=None):
    import uvicorn

    parser = argparse.ArgumentParser(description="VAKIFNAME genel arayüz production sunucusu")
    parser.add_argument("--dist", type=Path, default=Path(__file__).resolve().parents[2] / "frontend" / "dist")
    parser.add_argument("--api-origin", required=True, help="Derlemedeki VITE_API_BASE_URL ile aynı köken")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args(argv)
    uvicorn.run(create_web_app(args.dist, args.api_origin), host=args.host, port=args.port,
                proxy_headers=False, server_header=False)


if __name__ == "__main__":
    main()
