"""Yalıtılmış ortamda yetkisiz erişim reddi ve genel API veri sızıntısı denetimi (tarayıcı testlerine ek).

    python scripts/e2e_api_checks.py --internal 8766 --public 8001 --workdir /tmp/e2e-xyz [--fictional]
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Genel API'de asla görünmemesi gereken dahili/araştırma işaretleri.
LEAK_MARKERS = ["LC-0", "S-0001-", "D-0008-01", "Claude Code", "OpenStreetMap", "osm:way", "wikidata:", "Kültür Portalı",
                "evidence_quote", "rationale", "reviewer", "DRAFT-", "ISSUE-", "access_notes", "Namaz vakitleri",
                "Tarayıcı Testi Editörü", "e2e.editor"]

results = []


def check(label, ok, extra=""):
    results.append((bool(ok), label, extra))


def req(url, method="GET", headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, resp.read().decode(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), e.headers


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--internal", type=int, required=True)
    p.add_argument("--public", type=int, required=True)
    p.add_argument("--workdir", type=Path, required=True)
    p.add_argument("--fictional", action="store_true", help="Genel API kurgusal onaylı katalogla çalışıyor")
    p.add_argument("--expect", type=int, default=None, help="Beklenen yayımlanmış eser sayısı")
    a = p.parse_args()
    i, pub = f"http://127.0.0.1:{a.internal}", f"http://127.0.0.1:{a.public}"
    token = (a.workdir / "token").read_text().strip()

    if not a.fictional:
        for path in ("/internal/status", "/internal/catalog/monuments", "/internal/review/location-candidates",
                     "/internal/catalog/research/BUR-0008", "/internal/review/audit"):
            check(f"Anahtarsız {path} → 401", req(i + path)[0] == 401)
        check("Yanlış anahtar → 401", req(i + "/internal/status", headers={"X-Internal-Token": "x" * 40})[0] == 401)
        status, _, headers = req(i + "/internal/status", headers={"X-Internal-Token": token})
        check("Doğru anahtar → 200, no-store", status == 200 and headers.get("Cache-Control") == "no-store")
        status, body, _ = req(i + "/internal/review/tickets", "POST", {"X-Internal-Token": token},
                              {"subject_kind": "fact", "subject_id": "BUR-0001-F001", "decision_type": "fact_editorial"})
        check("Paylaşılan anahtarla karar bileti → 403", status == 403)
        check("Yanlış oturum anahtarı → 401",
              req(i + "/internal/session", "POST", {"X-Vakifname-Review": "1"}, {"token": "y" * 40})[0] == 401)
        check("CSRF başlığı olmadan oturum ucu → 401", req(i + "/internal/session", "POST", None, {"token": token})[0] == 401)
        check("OpenAPI kapalı", req(i + "/openapi.json", headers={"X-Internal-Token": token})[0] == 404)

    status, body, _ = req(pub + "/monuments")
    listing = json.loads(body)
    expected = a.expect if a.expect is not None else (2 if a.fictional else 0)
    check("Genel API'de demo uçları kapalı (/places, demo pasaportu)",
          req(pub + "/places")[0] == 404 and req(pub + "/users/u/passport")[0] == 404)
    check(f"Genel /monuments yayın sayısı {expected}", status == 200 and listing["published_count"] == expected)
    check("Yayımlanmamış gerçek eser → 404", req(pub + "/monuments/BUR-0001")[0] == 404)
    check("Yayımlanmamış eserde check-in → 404",
          req(pub + "/monuments/BUR-0001/check-in", "POST", None, {"user_id": "u", "latitude": 40.18, "longitude": 29.06})[0] == 404)
    check("Genel API'de /internal yok", req(pub + "/internal/status")[0] == 404)
    blobs = [req(pub + path)[1] for path in ("/monuments", "/openapi.json", "/places")]
    if a.fictional:
        blobs += [req(pub + f"/monuments/{m['monument_id']}")[1] for m in listing["monuments"]]
        ident = "BUR-9002" if expected == 2 else "BUR-9001"
        detail = json.loads(req(pub + f"/monuments/{ident}")[1])
        check(f"Yalnızca kimlik onaylı eser ({ident}): olgu/görsel/konum/check-in yok",
              detail["facts"] == [] and detail["images"] == [] and detail["location"] is None
              and detail["checkin_available"] is False)
        check("Araştırma erişim notu yayına geçmedi", "Test notu." not in "\n".join(blobs))
    blob = "\n".join(blobs)
    leaked = [m for m in LEAK_MARKERS if m in blob]
    check("Genel API yanıtlarında dahili işaret yok", not leaked, ", ".join(leaked))

    for ok, label, extra in results:
        print(f"{'PASS' if ok else 'FAIL'} [API{'-S3' if a.fictional else ''}] {label}{' — ' + extra if extra else ''}")
    sys.exit(0 if all(ok for ok, _, _ in results) else 1)


if __name__ == "__main__":
    main()
