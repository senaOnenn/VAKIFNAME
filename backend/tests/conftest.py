from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import DEFAULT_CORS_ORIGINS, create_app

TEST_PLACES_FILE = Path(__file__).parent / "data" / "places.json"


@pytest.fixture
def client():
    # Her test için yeni uygulama: bellek içi ilerleme testler arasında paylaşılmaz.
    with TestClient(create_app(TEST_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS)) as c:
        yield c
