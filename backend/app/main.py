import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .accounts import AccountStore
from .ask.service import AskService
from .ask_routes import RateLimiter, router as ask_router
from .auth_routes import router as auth_router
from .people_routes import router as people_router
from .google_auth import google_verifier_from_env
from .guide.lexicon import TurkishLexicon
from .guide.privacy import FaceScreen
from .guide.registry import DEFAULT_MODELS, build_provider, log_selection
from .guide.service import GuideService, GuideSettings, budget_from_env
from .guide_routes import BodyLimit, InFlight, TesterSessions, guide_mode, router as guide_router
from .monument_routes import router as monument_router
from .public_catalog import PublicCatalogRepository
from .route_routes import router as route_router
from .routes import router
from .progress import MonumentProgressStore
from .services import PlaceRepository, ProgressStore

# Rehber logları (yalnızca durum, aşama, süre, token sayısı, HTTP durumu ve hata kodu; soru, fotoğraf ve anahtar yazılmaz)
# zaman damgasıyla uvicorn çıktısına gider. Yapılandırılmamış Python yalnızca WARNING ve üstünü, damgasız yazıyordu.
# Hesap logları (`vakifname.auth`) yalnızca ret nedeni kodunu yazar; e-posta, parola ve belirteç yazılmaz.
for _name in ("vakifname.guide", "vakifname.auth"):
    _log = logging.getLogger(_name)
    if not _log.handlers:
        _h = logging.StreamHandler()
        _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        _log.addHandler(_h)
        _log.setLevel(logging.INFO)

DEFAULT_PLACES_FILE = Path(__file__).resolve().parents[2] / "data" / "places.json"
# Dahili dışa aktarıcının (`python -m app.internal.publish`) ürettiği, yalnızca yayın onaylı kayıtları içeren anlık görüntü.
DEFAULT_PUBLIC_CATALOG_FILE = Path(__file__).resolve().parents[2] / "data" / "public_catalog" / "catalog.json"

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]


def cors_origins_from_env() -> list[str]:
    """`VAKIFNAME_CORS_ORIGINS` virgülle ayrılmış tam origin listesidir; tanımlı değilse yerel geliştirme listesi kullanılır."""
    raw = os.environ.get("VAKIFNAME_CORS_ORIGINS")
    if raw is None:
        return list(DEFAULT_CORS_ORIGINS)
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    if "*" in origins:
        raise ValueError("VAKIFNAME_CORS_ORIGINS içinde '*' kullanılamaz; origin'leri tek tek yazın.")
    return origins


def _json_safe_error(error: dict, echo_input: bool = True) -> dict:
    """Hata kaydını JSON'a çevrilebilir hale getirir; NaN/Infinity gibi değerleri yanıtta tekrar yazmaz."""
    if not echo_input:
        error = {k: v for k, v in error.items() if k != "input"}
    error = jsonable_encoder(error)
    for key in ("input", "ctx"):
        try:
            json.dumps(error, allow_nan=False)
            break
        except ValueError:
            error.pop(key, None)
    return error


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Hesap uçlarında girdi (parola, belirteç) hata yanıtında geri yazılmaz.
    echo = not request.url.path.startswith("/auth/")
    return JSONResponse(status_code=422, content={"detail": [_json_safe_error(e, echo) for e in exc.errors()]})


def demo_api_from_env() -> bool:
    """Kurgusal demo uçları (`/places`, demo check-in ve pasaport) yalnızca `VAKIFNAME_DEMO_API=on` ile açılır.

    Genel platform yalnızca yayın onaylı gerçek eserleri sunar; demo oyunu otomatik testler ve geliştirme içindir.
    """
    return os.environ.get("VAKIFNAME_DEMO_API", "off").strip().lower() in ("1", "on", "true", "yes")


def create_app(
    places_file: Optional[Path] = None,
    cors_origins: Optional[list[str]] = None,
    public_catalog_file: Optional[Path] = None,
    demo_api: Optional[bool] = None,
    progress_db: Optional[Path] = None,
    accounts_db: Optional[Path] = None,
    ask_model_dir: Optional[Path] = None,
    ask_index_dir: Optional[Path] = None,
    ask_encoder=None,
    ask_background: bool = True,
) -> FastAPI:
    demo_api = demo_api_from_env() if demo_api is None else demo_api
    places_file = places_file or Path(os.environ.get("VAKIFNAME_PLACES_FILE", DEFAULT_PLACES_FILE))
    public_catalog_file = public_catalog_file or Path(
        os.environ.get("VAKIFNAME_PUBLIC_CATALOG_FILE", DEFAULT_PUBLIC_CATALOG_FILE)
    )
    cors_origins = cors_origins_from_env() if cors_origins is None else cors_origins

    app = FastAPI(title="VAKIFNAME API", version="1.0.0")
    if demo_api:
        app.state.places = PlaceRepository(places_file)
        app.state.progress = ProgressStore()
    # Gerçek eser kataloğu ve mühürleri demo oyunundan ayrı tutulur.
    app.state.monuments = PublicCatalogRepository(public_catalog_file)
    # Ziyaretçi ilerlemesi `VAKIFNAME_PROGRESS_DB` dosyasında kalıcıdır (ör. data/public_catalog/progress/progress.sqlite3);
    # tanımlı değilse (testler) bellek içi depo kullanılır ve yeniden başlatmada sıfırlanır.
    progress_db = progress_db or (Path(os.environ["VAKIFNAME_PROGRESS_DB"]) if os.environ.get("VAKIFNAME_PROGRESS_DB") else None)
    app.state.monument_progress = MonumentProgressStore(progress_db)
    # Hesaplar ve oturumlar `VAKIFNAME_ACCOUNTS_DB` dosyasında (ilerlemeden ayrı); tanımlı değilse bellek içi (testler).
    accounts_db = accounts_db or (Path(os.environ["VAKIFNAME_ACCOUNTS_DB"]) if os.environ.get("VAKIFNAME_ACCOUNTS_DB") else None)
    app.state.accounts = AccountStore(accounts_db)
    # Google ile giriş yalnızca `VAKIFNAME_GOOGLE_CLIENT_ID` verilince açılır; testler sahte doğrulayıcı koyar.
    app.state.google_verifier = google_verifier_from_env()
    # `/auth/*` POST istekleri için `VAKIFNAME_AUTH_RATE=dakika/saat/genel-dakika` (varsayılan 10/60/300), istemci adresine göre.
    a_min, a_hour, a_global = (int(x) for x in os.environ.get("VAKIFNAME_AUTH_RATE", "10/60/300").split("/"))
    app.state.auth_limiter = RateLimiter(per_minute=a_min, per_hour=a_hour, global_per_minute=a_global)
    # "Esere Sor": yalnızca genel katalogdan. `VAKIFNAME_ASK_MODEL_DIR` yerel embedding modelini gösterir; yoksa veya
    # yüklenemezse kelime aramasıyla çalışır. Dizin `VAKIFNAME_ASK_INDEX_DIR` altında manifestiyle saklanır.
    ask_model_dir = ask_model_dir or (Path(os.environ["VAKIFNAME_ASK_MODEL_DIR"]) if os.environ.get("VAKIFNAME_ASK_MODEL_DIR") else None)
    ask_index_dir = ask_index_dir or (Path(os.environ["VAKIFNAME_ASK_INDEX_DIR"]) if os.environ.get("VAKIFNAME_ASK_INDEX_DIR") else None)
    # `VAKIFNAME_ASK_CE_DIR` (isteğe bağlı, varsayılan kapalı): yerel ONNX cross-encoder. Yüklenemezse CE'siz doğrulama sürer.
    ask_ce_dir = Path(os.environ["VAKIFNAME_ASK_CE_DIR"]) if os.environ.get("VAKIFNAME_ASK_CE_DIR") else None
    app.state.ask = AskService(app.state.monuments, ask_model_dir, ask_index_dir, encoder=ask_encoder, background=ask_background,
                               cross_encoder_dir=ask_ce_dir)
    # `VAKIFNAME_ASK_RATE=dakika/saat/genel-dakika` (varsayılan 30/600/300). Önizleme tünelle açıldığında bütün ziyaretçiler
    # aynı adresten (127.0.0.1) görünür; istemci sınırı bu durumda ortak sınır gibi çalışır.
    per_min, per_hour, global_min = (int(x) for x in os.environ.get("VAKIFNAME_ASK_RATE", "30/600/300").split("/"))
    app.state.ask_limiter = RateLimiter(per_minute=per_min, per_hour=per_hour, global_per_minute=global_min)
    app.state.ask_enabled = os.environ.get("VAKIFNAME_ASK_ENABLED", "on").strip().lower() not in ("0", "off", "false", "no")
    # Yapay zekâ rehberi (OpenRouter, NVIDIA Nemotron VL): `VAKIFNAME_GUIDE_MODE=off|testers|on`, varsayılan kapalı. Anahtar
    # yalnızca dosyadan okunur (bkz. app/guide/secret.py); yoksa rehber mevcut kaynaklı aramaya düşer. Yalnızca `:free`
    # modeller çağrılır; `VAKIFNAME_GUIDE_ALLOW_PAID_MODEL=1` bilinçli olarak verilmedikçe ücretli modele geçilmez.
    app.state.guide_mode = guide_mode()
    # Sağlayıcı seçimi tek yerden: bkz. app/guide/registry.py ve backend/.env.example (VAKIFNAME_GUIDE_PROVIDER, _FALLBACK).
    # Giriş/anahtar yoksa başka sağlayıcıya sessizce geçilmez; geçersiz ad açılışta hata verir.
    guide_settings = GuideSettings.from_env()
    provider, provider_name, _ = build_provider()
    if not os.environ.get("VAKIFNAME_GUIDE_MODEL") and provider_name in DEFAULT_MODELS:
        guide_settings.text_model = DEFAULT_MODELS[provider_name]
    if app.state.guide_mode != "off":
        log_selection(provider, guide_settings.text_model)
    # Türkçe sözlük (zeyrek; ~9 sn, ~200 MB; arka planda yüklenir): rehberde bozuk sözcük denetimi, Esere Sor'da yazım
    # düzeltmesinin doğru yazılmış ama katalogda geçmeyen sözcükleri ("nereli", "şehirden") değiştirmemesi için. Rehber
    # ve Esere Sor ikisi de kapalıysa yüklenmez. Yüklenene kadar düzeltme yalnızca katalog sözlüğüyle çalışır.
    lexicon = (TurkishLexicon() if (guide_mode() != "off" or app.state.ask_enabled)
               and os.environ.get("VAKIFNAME_GUIDE_LEXICON", "on").strip().lower() not in ("0", "off", "false", "no") else None)
    if lexicon is not None:
        app.state.ask.word_check = lexicon.is_word
    app.state.guide = GuideService(app.state.ask, provider, budget_from_env(), guide_settings, face_screen=FaceScreen(),
                                   lexicon=lexicon)
    g_min, g_hour, g_global = (int(x) for x in os.environ.get("VAKIFNAME_GUIDE_RATE", "6/60/10").split("/"))
    app.state.guide_limiter = RateLimiter(per_minute=g_min, per_hour=g_hour, global_per_minute=g_global)
    app.state.guide_sessions = TesterSessions()
    app.state.guide_inflight = InFlight()
    app.state.guide_login_limiter = RateLimiter(per_minute=5, per_hour=20, global_per_minute=30)

    # CORS yalnızca tarayıcıların hangi sitelerden çağrı yapabileceğini belirler; erişim kontrolü değildir. Kimlik bilgisi
    # (çerez: rehber test oturumu ve hesap oturumu) yalnızca açıkça listelenen origin'lerle kullanılır ('*' reddedilir).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "X-Vakifname-Guide"],
        allow_credentials=True,
    )
    app.add_middleware(BodyLimit)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    @app.get("/")
    def read_root():
        return {"status": "ok", "message": "VAKIFNAME API Service Active"}

    if demo_api:
        app.include_router(router)
    app.include_router(ask_router)
    app.include_router(guide_router)
    app.include_router(monument_router)
    app.include_router(route_router)
    app.include_router(people_router)
    app.include_router(auth_router)
    if app.state.ask.model_dir is not None:
        # Model ve dizin arka planda hazırlanır; o sırada kelime araması çalışır.
        app.state.ask.engine()
    return app


app = create_app()
