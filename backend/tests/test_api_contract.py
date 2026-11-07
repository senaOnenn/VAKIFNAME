"""Arayüz ↔ sunucu sözleşmesi (R6.4.1).

Gerçek tarayıcıda "Oyuncu profili yüklenemedi" hatası, yeni arayüzün eski kodla çalışan bir sunucuya (`/player/*` yok,
404) bağlanmasından çıktı. Bu testler iki şeyi güvenceye alır:

1. Arayüzün (`frontend/src`) çağırdığı her sabit API yolu bu sunucu kodunda gerçekten vardır.
2. `GET /` sürüm bilgisi verir ve arayüzün beklediği en düşük sürümle (`REQUIRED_API_VERSION`) uyumludur; böylece arayüz
   eski bir süreci "sunucu güncel değil" diye ayırt edebilir.
"""

import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import API_VERSION, create_app

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"
SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
# apiGet('/x'), apiPost('/x', …), apiGet(`/x/${id}/y`, …) — yalnızca arayüzün genel API istemcisiyle yaptığı çağrılar.
CALL = re.compile(r"\bapi(?:Get|Post|Upload)\(\s*(['`])(/[^'`?]*)")
FILES = ["app/api.ts", "app/session.ts", "app/stats.ts", "catalog/catalogClient.ts", "catalog/guideClient.ts"]


def frontend_paths() -> set[str]:
    out = set()
    for rel in FILES:
        f = FRONTEND / rel
        if not f.exists():
            continue
        for _, path in CALL.findall(f.read_text(encoding="utf-8")):
            out.add(re.sub(r"\$\{[^}]+\}", "{}", path))
    return out


def server_patterns(app) -> list[re.Pattern]:
    # Uygulamanın yayımladığı bütün yollar (OpenAPI şeması; yönlendiriciler iç içe olsa da tam yol listesi verir).
    return [re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", path) + "$") for path in app.openapi()["paths"]]


def test_every_api_path_the_frontend_calls_exists_on_the_server():
    paths = frontend_paths()
    assert {"/player/profile", "/player/character", "/route", "/auth/me"} <= paths  # tarayıcı doğru dosyaları okudu
    app = create_app(public_catalog_file=SNAPSHOT, demo_api=False)
    pats = server_patterns(app)
    missing = sorted(p for p in paths if not any(rx.match(p.replace("{}", "x")) for rx in pats))
    assert missing == [], f"Arayüzün çağırdığı ama sunucuda olmayan yollar: {missing}"


def test_root_reports_a_version_the_frontend_accepts():
    text = (FRONTEND / "app" / "api.ts").read_text(encoding="utf-8")
    required = int(re.search(r"REQUIRED_API_VERSION\s*=\s*(\d+)", text).group(1))
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as c:
        body = c.get("/").json()
    assert body["status"] == "ok" and body["api_version"] == API_VERSION >= required
    assert {"player_profile", "xp", "account_only_game", "open_quests"} <= set(body["features"])
    # Sağlık yanıtında gizli bilgi veya yapılandırma yok.
    assert set(body) == {"status", "message", "api_version", "features"}
