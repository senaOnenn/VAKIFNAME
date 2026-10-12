from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

TEST_PLACES_FILE = Path(__file__).parent / "data" / "places.json"


@pytest.fixture
def client():
    # Her test için yeni uygulama: bellek içi ilerleme testler arasında paylaşılmaz.
    with TestClient(create_app(TEST_PLACES_FILE)) as c:
        yield c
