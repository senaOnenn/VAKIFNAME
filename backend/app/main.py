import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI

from .routes import router
from .services import PlaceRepository, ProgressStore

DEFAULT_PLACES_FILE = Path(__file__).resolve().parents[2] / "data" / "places.json"


def create_app(places_file: Optional[Path] = None) -> FastAPI:
    places_file = places_file or Path(os.environ.get("VAKIFNAME_PLACES_FILE", DEFAULT_PLACES_FILE))

    app = FastAPI(title="VAKIFNAME API", version="1.0.0")
    app.state.places = PlaceRepository(places_file)
    app.state.progress = ProgressStore()

    @app.get("/")
    def read_root():
        return {"status": "ok", "message": "VAKIFNAME API Service Active"}

    app.include_router(router)
    return app


app = create_app()
