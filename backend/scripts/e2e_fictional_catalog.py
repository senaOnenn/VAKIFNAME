"""Tarayıcı testi için KURGUSAL (BUR-9xxx) yayın anlık görüntüsü üretir. Gerçek V20 verisi veya gerçek inceleme
veritabanı kullanılmaz; her şey verilen boş çalışma dizininde oluşturulur.

- BUR-9001: kimlik + bir olgu + doğrulanmış harita konumu (check-in yok)
- BUR-9002: yalnızca temel kimlik (olgu, görsel ve konum kararı yok)

    python scripts/e2e_fictional_catalog.py /tmp/e2e-xyz/fictional
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.internal.publish import write_snapshot  # noqa: E402
from tests import test_review_workflow as w  # noqa: E402


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    tmp = Path(argv[0]).resolve()
    tmp.mkdir(parents=True, exist_ok=False)
    env = w.env.__wrapped__(tmp)
    clock = w.Clock()
    with w.make_client(env, clock) as c:
        w.approve_chain(c, env, clock, location=True)
        w.login(c, env, "editor")
        identity = {**w.IDENTITY, "display_name": "Test Eseri BUR-9002", "identity_source_ids": ["S-9002-KP"],
                    "acknowledged_discrepancy_ids": ["D-9002-01"]}
        r = w.decide(c, clock, "monument", "BUR-9002", "catalog_identity", source_check="verified_on_page",
                     payload=identity)
        assert r.status_code == 201, r.text
        snap = write_snapshot(c.app.state.review, tmp / "public" / "catalog.json", env["root"] / "images" / "monuments",
                              "e2e")
        assert c.get("/internal/review/audit", headers=w.REVIEW).json()["verification"]["valid"]
    print([(m.monument_id, len(m.facts), m.location is not None, m.checkin is not None) for m in snap.monuments])


if __name__ == "__main__":
    main()
