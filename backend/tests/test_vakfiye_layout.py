"""R6.9: Kayıp Vakfiye'nin tek ve sabit yerleşimi (sunucu tanımlar, bütün ekranlar kullanır)."""

from pathlib import Path

from fastapi.testclient import TestClient

from app import vakfiye
from app.main import create_app

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"


def test_layout_is_fixed_and_independent_of_input_order():
    ids = list(vakfiye.LAYOUT["bursa"])
    assert len(ids) == 10 and len(set(ids)) == 10
    assert vakfiye.slots("bursa", reversed(ids)) == ids
    # Sonradan yayımlanan eser sona eklenir; var olan yuvalar kaymaz.
    assert vakfiye.slots("bursa", ids + ["BUR-0042"]) == ids + ["BUR-0042"]
    # Yerleşimi olmayan şehirde kimlik sırası.
    assert vakfiye.slots("izmir", ["BUR-0102", "BUR-0101"]) == ["BUR-0101", "BUR-0102"]


def test_layout_endpoint_matches_the_route_monuments():
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as c:
        r = c.get("/vakfiye/layout", params={"city": "Bursa"})
        assert r.status_code == 200
        body = r.json()
        assert body["city"] == "bursa" and body["slots"] == list(vakfiye.LAYOUT["bursa"])
        assert c.get("/vakfiye/layout", params={"city": "ankara"}).status_code == 404
