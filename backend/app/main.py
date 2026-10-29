import json
import logging
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .accounts import AccountStore, email_token_ttls_from_env
from .ask.service import AskService
from .game import GameSettings
from .game_routes import router as game_router
from .ask_routes import RateLimiter, router as ask_router
from .content.pipeline import Pipeline, content_dir_from_env, content_model
from .content.store import ContentStore
from .content_routes import router as content_router
from .speech_routes import router as speech_router
from .tts import SpeechService, TtsSettings
from .auth_routes import router as auth_router
from .people_routes import router as people_router
from .stats import StatsStore
from .stats_routes import router as stats_router
from .google_auth import google_verifier_from_env
from .mailer import mailer_from_env, public_base_url
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


_FIELD_TR = {"title": "Başlık", "text": "Metin", "quote": "Alıntı", "page": "Sayfa", "page_from": "Başlangıç sayfası",
             "page_to": "Bitiş sayfası", "question": "Soru", "choices": "Seçenekler", "answer_index": "Doğru cevap",
             "explanation": "Açıklama", "name": "Ad", "alternative_names": "Diğer adlar", "type": "Tür", "city": "Şehir",
             "district": "İlçe", "address": "Adres", "latitude": "Enlem", "longitude": "Boylam",
             "site_notice": "Ziyaret uyarısı", "rights_holder": "Hak sahibi", "license": "Lisans",
             "attribution": "Atıf", "source_url": "Kaynak adresi", "source_id": "Kaynak", "category": "Konu",
             "certainty": "Kesinlik", "monument_id": "Eser", "upload_id": "Yüklenen dosya"}


def _turkish_message(error: dict) -> str:
    """Yönetim formları için Türkçe doğrulama mesajı (alan adı + kural)."""
    field = next((_FIELD_TR[p] for p in reversed(error.get("loc", ())) if isinstance(p, str) and p in _FIELD_TR), "Alan")
    ctx, kind = error.get("ctx") or {}, error.get("type", "")
    if kind == "missing":
        return f"{field} zorunlu."
    if kind in ("string_too_short", "too_short"):
        n = ctx.get("min_length", 1)
        return f"{field} boş bırakılamaz." if n <= 1 else f"{field} en az {n} karakter olmalı."
    if kind in ("string_too_long", "too_long"):
        return f"{field} en fazla {ctx.get('max_length')} {'karakter' if kind == 'string_too_long' else 'öğe'} olabilir."
    if kind in ("greater_than_equal", "greater_than"):
        return f"{field} en az {ctx.get('ge', ctx.get('gt'))} olmalı."
    if kind in ("less_than_equal", "less_than"):
        return f"{field} en fazla {ctx.get('le', ctx.get('lt'))} olabilir."
    if kind == "value_error":
        return str(ctx.get("error") or error.get("msg", "")).removeprefix("Value error, ")
    return f"{field} geçersiz."


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Hesap uçlarında girdi (parola, belirteç) hata yanıtında geri yazılmaz.
    echo = not request.url.path.startswith("/auth/")
    errors = [_json_safe_error(e, echo) for e in exc.errors()]
    if request.url.path.startswith("/admin/content/"):
        for raw, e in zip(exc.errors(), errors):
            e["msg"] = _turkish_message(raw)
    return JSONResponse(status_code=422, content={"detail": errors})


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
    content_dir: Optional[Path] = None,
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
    # Gerçek eser kataloğu ve mühürleri demo oyunundan ayrı tutulur. İçerik yönetimi (`VAKIFNAME_CONTENT_DIR`, bkz.
    # docs/ICERIK_YONETIMI.md) açıksa yöneticinin yayımladığı katman (`published.json`) anlık görüntünün üstüne eklenir.
    content_dir = content_dir or (Path(d) if (d := content_dir_from_env()) else None)
    app.state.monuments = PublicCatalogRepository(
        public_catalog_file, overlay_path=content_dir / "published.json" if content_dir else None,
        overlay_media_dir=content_dir / "media" if content_dir else None)
    # Ziyaretçi ilerlemesi `VAKIFNAME_PROGRESS_DB` dosyasında kalıcıdır (ör. data/public_catalog/progress/progress.sqlite3);
    # tanımlı değilse (testler) bellek içi depo kullanılır ve yeniden başlatmada sıfırlanır.
    progress_db = progress_db or (Path(os.environ["VAKIFNAME_PROGRESS_DB"]) if os.environ.get("VAKIFNAME_PROGRESS_DB") else None)
    app.state.monument_progress = MonumentProgressStore(progress_db)
    # Oyun döngüsü (bkz. app/game_routes.py): ziyaret yarıçapı `VAKIFNAME_VISIT_RADIUS_M` (varsayılan 50 m) ve sunum modu
    # ziyareti `VAKIFNAME_VISIT_SIMULATION=on|off` (varsayılan off). Geçersiz değer açılışta hata verir. Saat ve
    # rastgelelik testlerde değiştirilebilir.
    app.state.game_settings = GameSettings.from_env()
    app.state.game_clock = lambda: datetime.now(timezone.utc)
    app.state.game_rng = random.SystemRandom()
    # Hesaplar ve oturumlar `VAKIFNAME_ACCOUNTS_DB` dosyasında (ilerlemeden ayrı); tanımlı değilse bellek içi (testler).
    accounts_db = accounts_db or (Path(os.environ["VAKIFNAME_ACCOUNTS_DB"]) if os.environ.get("VAKIFNAME_ACCOUNTS_DB") else None)
    app.state.accounts = AccountStore(accounts_db, token_ttls=email_token_ttls_from_env())
    # Hesap e-postaları (doğrulama, parola yenileme; bkz. app/mailer.py): `VAKIFNAME_MAIL_BACKEND=off|file|smtp`
    # (varsayılan off). Bağlantılar `VAKIFNAME_PUBLIC_BASE_URL` üzerine kurulur. Geçersiz yapılandırma açılışta hata verir.
    app.state.mailer = mailer_from_env()
    app.state.public_base_url = public_base_url()
    logging.getLogger("vakifname.mail").info("Hesap e-postaları: %s", app.state.mailer.name)
    # Aynı adrese/hesaba giden e-posta sınırı (istemci sınırına ek): dakikada 1, saatte 5.
    app.state.mail_limiter = RateLimiter(per_minute=1, per_hour=5, global_per_minute=120)
    # Google ile giriş yalnızca `VAKIFNAME_GOOGLE_CLIENT_ID` verilince açılır; testler sahte doğrulayıcı koyar.
    app.state.google_verifier = google_verifier_from_env()
    # `/auth/*` POST istekleri için `VAKIFNAME_AUTH_RATE=dakika/saat/genel-dakika` (varsayılan 10/60/300), istemci adresine göre.
    a_min, a_hour, a_global = (int(x) for x in os.environ.get("VAKIFNAME_AUTH_RATE", "10/60/300").split("/"))
    app.state.auth_limiter = RateLimiter(per_minute=a_min, per_hour=a_hour, global_per_minute=a_global)
    # Anonim ziyaret istatistikleri (çerezsiz; bkz. app/stats.py). Dosya yoksa bellekte tutulur.
    stats_db = os.environ.get("VAKIFNAME_STATS_DB", "").strip()
    app.state.stats = StatsStore(Path(stats_db) if stats_db else None)
    app.state.stats_limiter = RateLimiter(per_minute=120, per_hour=3000, global_per_minute=3000)
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
    # İçerik deposu ve hat: hat rehberin sağlayıcısını kullanır (model `VAKIFNAME_CONTENT_MODEL`, yoksa rehberinki).
    app.state.content = None
    if content_dir is not None:
        repo = app.state.monuments
        app.state.content = ContentStore(content_dir, lambda: {m.monument_id: m for m in repo.base_catalog.monuments})
    # Seslendirme (Faz 8, `VAKIFNAME_TTS_PROVIDER`; kapalıysa arayüz tarayıcı sesini kullanır). Önbellek dizini verilmediyse
    # içerik dizininin altında tutulur.
    tts_settings = TtsSettings.from_env()
    if tts_settings.cache_dir is None and content_dir is not None:
        tts_settings.cache_dir = content_dir / "tts"
    app.state.speech = SpeechService(tts_settings)
    app.state.speech_limiter = RateLimiter(per_minute=30, per_hour=600, global_per_minute=120)
    app.state.content_pipeline = Pipeline(app.state.content, provider, content_model(guide_settings.text_model)) \
        if app.state.content is not None else None

    # CORS yalnızca tarayıcıların hangi sitelerden çağrı yapabileceğini belirler; erişim kontrolü değildir. Kimlik bilgisi
    # (çerez: rehber test oturumu ve hesap oturumu) yalnızca açıkça listelenen origin'lerle kullanılır ('*' reddedilir).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
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
    app.include_router(game_router)
    app.include_router(route_router)
    app.include_router(people_router)
    app.include_router(stats_router)
    app.include_router(auth_router)
    app.include_router(content_router)
    app.include_router(speech_router)
    if app.state.ask.model_dir is not None:
        # Model ve dizin arka planda hazırlanır; o sırada kelime araması çalışır.
        app.state.ask.engine()
    return app


app = create_app()
