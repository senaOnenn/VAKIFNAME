import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .routes import router
from .services import PlaceRepository, ProgressStore

DEFAULT_PLACES_FILE = Path(__file__).resolve().parents[2] / "data" / "places.json"

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


def _json_safe_error(error: dict) -> dict:
    """Hata kaydını JSON'a çevrilebilir hale getirir; NaN/Infinity gibi değerleri yanıtta tekrar yazmaz."""
    error = jsonable_encoder(error)
    for key in ("input", "ctx"):
        try:
            json.dumps(error, allow_nan=False)
            break
        except ValueError:
            error.pop(key, None)
    return error


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": [_json_safe_error(e) for e in exc.errors()]})


def create_app(places_file: Optional[Path] = None, cors_origins: Optional[list[str]] = None) -> FastAPI:
    places_file = places_file or Path(os.environ.get("VAKIFNAME_PLACES_FILE", DEFAULT_PLACES_FILE))
    cors_origins = cors_origins_from_env() if cors_origins is None else cors_origins

    app = FastAPI(title="VAKIFNAME API", version="1.0.0")
    app.state.places = PlaceRepository(places_file)
    app.state.progress = ProgressStore()

    # CORS yalnızca tarayıcıların hangi sitelerden çağrı yapabileceğini belirler; erişim kontrolü değildir.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    @app.get("/")
    def read_root():
        return {"status": "ok", "message": "VAKIFNAME API Service Active"}

    app.include_router(router)
    return app


app = create_app()
