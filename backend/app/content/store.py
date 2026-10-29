"""İçerik deposu (şartname 5.1.1): yöneticinin eklediği kaynak kitaplar, eserler, kayıtlar ve görseller.

Kurallar (CLAUDE.md §2.13, docs/ICERIK_YONETIMI.md):
- Tek rol yöneticidir; onay yöneticinin kendi kaydıdır. Taslak hiçbir genel uçta görünmez.
- Her yayın, reddetme ve yayından çekme `decisions` tablosuna **yalnızca eklenen** bir karar olarak yazılır (kim, ne zaman,
  içeriğin özeti). Tablo güncellenemez ve silinemez (tetikleyici).
- Onaylı katalog (V20 anlık görüntüsü) salt okunurdur. Yönetici ona yeni kayıt ve görsel ekleyebilir; yeni eser kendi
  kimlik aralığından (`<ŞEHİR>-5001`…) alır.
- Yayımlanan içerik `published.json` katmanına atomik yazılır; genel katalog onu V20'nin üstüne ekler
  (`public_catalog.apply_overlay`) ve dosya değişince yeniden yükler.
"""

import hashlib
import json
import logging
import os
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from ..public_catalog import PublicFact, PublicImage, PublicMonument
from . import pdftext

logger = logging.getLogger("vakifname.content")
OVERLAY_SCHEMA = "vakifname.content_overlay/1"
OVERLAY_FILE = "published.json"
CERTAINTY = ("documented", "reported", "uncertain")
CATEGORIES = ("construction", "architecture", "restoration", "historical_event", "historical_person", "function",
              "artistic_feature", "burial_practice", "inscription", "foundation_purpose")
TYPES = ("cami", "mescit", "türbe", "medrese", "han", "hamam", "bedesten", "çeşme", "imaret", "köprü", "kervansaray",
         "külliye", "tekke", "zaviye", "sebil", "kütüphane", "diğer")
# Şehir kodu: eser kimliğinin öneki. Yeni şehir buraya eklenir (yoksa şehir adının ilk üç harfi kullanılır).
CITY_CODES = {"bursa": "BUR", "kutahya": "KUT", "konya": "KON", "hatay": "HAT", "izmir": "IZM", "manisa": "MAN"}
CITY_NAMES = {"bursa": "Bursa", "kutahya": "Kütahya", "konya": "Konya", "hatay": "Hatay", "izmir": "İzmir", "manisa": "Manisa"}
NEW_MONUMENT_FROM = 5001  # yönetici eserleri; V20 kimlikleriyle çakışmaz
CATALOG_FACT_FROM = 501   # katalog eserine eklenen kayıtlar; V20 kayıt numaralarıyla çakışmaz
MAP_PICK_ACCURACY_M = 25.0
# Kitaptan görsel: envanter yayınları projenin kendi yayınıdır (telif sorunu yok, CLAUDE.md §3); atıf sayfa ile yazılır.
MIN_BOOK_IMAGE_SIDE = 250
BOOK_RIGHTS_HOLDER = "Vakıf Eserleri Envanter Projesi"
BOOK_LICENSE = "Envanter yayını"
BOOK_SOURCE_LABEL = "Vakıf Eserleri Envanteri"

SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
    upload_id TEXT PRIMARY KEY, kind TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT PRIMARY KEY, title TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, page_count INTEGER NOT NULL,
    rights_confirmed INTEGER NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_pages (
    source_id TEXT NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (source_id, page));
CREATE TABLE IF NOT EXISTS monuments (
    monument_id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decision_id TEXT);
CREATE TABLE IF NOT EXISTS facts (
    fact_id TEXT PRIMARY KEY, monument_id TEXT NOT NULL, data TEXT NOT NULL, origin TEXT NOT NULL, status TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decision_id TEXT);
CREATE TABLE IF NOT EXISTS images (
    image_id TEXT PRIMARY KEY, monument_id TEXT NOT NULL, file TEXT NOT NULL, card_file TEXT, width INTEGER,
    height INTEGER, data TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, decision_id TEXT);
CREATE TABLE IF NOT EXISTS decisions (
    decision_id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, action TEXT NOT NULL,
    actor TEXT NOT NULL, at TEXT NOT NULL, content_sha256 TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS decisions_no_update BEFORE UPDATE ON decisions
    BEGIN SELECT RAISE(ABORT, 'decisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS decisions_no_delete BEFORE DELETE ON decisions
    BEGIN SELECT RAISE(ABORT, 'decisions are append-only'); END;
CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, monument_id TEXT NOT NULL, page_from INTEGER NOT NULL,
    page_to INTEGER NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    finished_at TEXT, candidates INTEGER NOT NULL DEFAULT 0, dropped INTEGER NOT NULL DEFAULT 0, error TEXT);
"""


class ContentError(Exception):
    """Kural ihlali. `status`: HTTP karşılığı (400 geçersiz, 404 yok, 409 kural)."""

    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sha(data) -> str:
    raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def city_code(slug: str) -> str:
    return CITY_CODES.get(slug) or (slug.upper() + "XXX")[:3]


class ContentStore:
    def __init__(self, root: Path, base_monuments: Callable[[], dict], clock: Callable[[], str] = _now):
        """`base_monuments`: onaylı katalogdaki (katmansız) eserler, kimlik → `PublicMonument`."""
        self.root = Path(root)
        for d in (self.root, self.root / "uploads", self.root / "sources", self.root / "media"):
            d.mkdir(parents=True, exist_ok=True)
            os.chmod(d, 0o700)
        self.overlay_path = self.root / OVERLAY_FILE
        self.media_dir = self.root / "media"
        self._base = base_monuments
        self._clock = clock
        self._lock = threading.RLock()
        self._pages: dict[str, list[str]] = {}  # kaynak sayfaları değişmez; alıntı denetimi için bellekte tutulur
        self._db = sqlite3.connect(self.root / "content.sqlite3", check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        # Yarım kalan hat işleri sunucu yeniden başlayınca sürmez; açıkça başarısız sayılır.
        self._db.execute("UPDATE jobs SET status='failed', error='Sunucu yeniden başladı; iş yarıda kaldı.', finished_at=? "
                         "WHERE status IN ('queued','running')", (self._clock(),))
        if not self.overlay_path.exists():
            self.write_overlay()

    def close(self):
        self._db.close()

    # --- Yardımcılar ----------------------------------------------------------------------------------------------

    # Tek bağlantı birden çok iş parçacığından (istekler + hat işi) kullanılır: her erişim kilit altındadır.
    def _one(self, sql: str, args: tuple = ()) -> Optional[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchone()

    def _all(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def _exec(self, sql: str, args: tuple = ()):
        with self._lock:
            self._db.execute(sql, args)

    def _tx(self):
        store = self

        class _Tx:
            def __enter__(self):
                store._lock.acquire()
                store._db.execute("BEGIN IMMEDIATE")

            def __exit__(self, exc_type, exc, tb):
                try:
                    store._db.execute("ROLLBACK" if exc_type else "COMMIT")
                finally:
                    store._lock.release()
                return False

        return _Tx()

    def _decide(self, subject_type: str, subject_id: str, action: str, actor: str, content) -> dict:
        at = self._clock()
        content_sha = _sha(content)
        decision_id = "DEC-" + _sha(f"{subject_type}|{subject_id}|{action}|{actor}|{at}|{content_sha}|"
                                    f"{secrets.token_hex(8)}".encode())[:16]
        self._db.execute("INSERT INTO decisions VALUES (?,?,?,?,?,?,?)",
                         (decision_id, subject_type, subject_id, action, actor, at, content_sha))
        return {"decision_id": decision_id, "by": actor, "at": at}

    def _decision(self, decision_id: Optional[str]) -> Optional[dict]:
        if not decision_id:
            return None
        r = self._one("SELECT decision_id, actor, at FROM decisions WHERE decision_id=?", (decision_id,))
        return {"decision_id": r["decision_id"], "by": r["actor"], "at": r["at"]} if r else None

    # --- Yüklemeler -----------------------------------------------------------------------------------------------

    def save_upload(self, kind: str, data: bytes, actor: str) -> dict:
        upload_id = "UPL-" + secrets.token_hex(8)
        path = self.root / "uploads" / upload_id
        path.write_bytes(data)
        os.chmod(path, 0o600)
        self._exec("INSERT INTO uploads VALUES (?,?,?,?,?,?,?)",
                   (upload_id, kind, _sha(data), len(data), str(path), actor, self._clock()))
        return {"upload_id": upload_id, "kind": kind, "size": len(data)}

    def _take_upload(self, upload_id: str, kind: str) -> tuple[bytes, str]:
        r = self._one("SELECT * FROM uploads WHERE upload_id=?", (upload_id,))
        if r is None or r["kind"] != kind:
            raise ContentError("Yüklenen dosya bulunamadı veya türü uymuyor.", 400)
        return Path(r["path"]).read_bytes(), r["sha256"]

    def _drop_upload(self, upload_id: str):
        r = self._one("SELECT path FROM uploads WHERE upload_id=?", (upload_id,))
        if r:
            Path(r["path"]).unlink(missing_ok=True)
            self._exec("DELETE FROM uploads WHERE upload_id=?", (upload_id,))

    # --- Kaynaklar ------------------------------------------------------------------------------------------------

    def _source_view(self, r: sqlite3.Row) -> dict:
        return {"source_id": r["source_id"], "title": r["title"], "page_count": r["page_count"],
                "rights_confirmed": bool(r["rights_confirmed"]), "uploaded_at": r["uploaded_at"],
                "uploaded_by": r["uploaded_by"]}

    def add_source(self, upload_id: str, title: str, rights_confirmed: bool, actor: str) -> dict:
        data, sha = self._take_upload(upload_id, "pdf")
        if self._one("SELECT 1 FROM sources WHERE sha256=?", (sha,)):
            raise ContentError("Bu PDF zaten kaynak olarak eklenmiş.")
        try:
            pages = pdftext.extract_pages(data)
        except pdftext.PdfError as e:
            raise ContentError(str(e), 400) from e
        if not pages or not any(p.strip() for p in pages):
            raise ContentError("PDF'te metin katmanı yok (taranmış görüntü). Metinli bir PDF gerekir.", 400)
        with self._tx():
            n = (self._one("SELECT COUNT(*) AS n FROM sources")["n"] or 0) + 1
            source_id = f"SRC-{n:04d}"
            (self.root / "sources" / f"{source_id}.pdf").write_bytes(data)
            self._db.execute("INSERT INTO sources VALUES (?,?,?,?,?,?,?)",
                             (source_id, title.strip(), sha, len(pages), int(rights_confirmed), actor, self._clock()))
            self._db.executemany("INSERT INTO source_pages VALUES (?,?,?)",
                                 [(source_id, i, t) for i, t in enumerate(pages, start=1)])
        self._drop_upload(upload_id)
        return self.source(source_id)

    def source(self, source_id: str) -> dict:
        r = self._one("SELECT * FROM sources WHERE source_id=?", (source_id,))
        if r is None:
            raise ContentError("Kaynak bulunamadı.", 404)
        return self._source_view(r)

    def sources(self) -> list[dict]:
        return [self._source_view(r) for r in self._all("SELECT * FROM sources ORDER BY source_id")]

    def page_text(self, source_id: str, page: int) -> dict:
        src = self.source(source_id)
        r = self._one("SELECT text FROM source_pages WHERE source_id=? AND page=?", (source_id, page))
        if r is None:
            raise ContentError(f"Sayfa 1–{src['page_count']} aralığında olmalı.", 404)
        return {"source_id": source_id, "page": page, "page_count": src["page_count"], "text": r["text"]}

    def pages(self, source_id: str) -> list[str]:
        if source_id not in self._pages:
            self.source(source_id)
            self._pages[source_id] = [r["text"] for r in
                                      self._all("SELECT text FROM source_pages WHERE source_id=? ORDER BY page", (source_id,))]
        return self._pages[source_id]

    def search(self, source_id: str, query: str) -> list[dict]:
        return pdftext.search(self.pages(source_id), query)

    # --- Eserler --------------------------------------------------------------------------------------------------

    def _content_monument(self, monument_id: str) -> Optional[sqlite3.Row]:
        return self._one("SELECT * FROM monuments WHERE monument_id=?", (monument_id,))

    def _monument_view(self, r: sqlite3.Row) -> dict:
        return {"monument_id": r["monument_id"], **json.loads(r["data"]), "origin": "content", "status": r["status"],
                "decision": self._decision(r["decision_id"])}

    @staticmethod
    def _catalog_view(m: PublicMonument) -> dict:
        return {"monument_id": m.monument_id, "name": m.name, "alternative_names": list(m.alternative_names),
                "type": m.type, "city": m.city, "district": m.district, "address": m.address,
                "latitude": m.location.latitude if m.location else None,
                "longitude": m.location.longitude if m.location else None, "site_notice": m.site_notice,
                "origin": "catalog", "status": "published", "decision": None}

    def monument_exists(self, monument_id: str) -> bool:
        return monument_id in self._base() or self._content_monument(monument_id) is not None

    def monument(self, monument_id: str) -> dict:
        base = self._base().get(monument_id)
        if base is not None:
            return self._catalog_view(base)
        r = self._content_monument(monument_id)
        if r is None:
            raise ContentError("Eser bulunamadı.", 404)
        return self._monument_view(r)

    def monuments(self) -> list[dict]:
        counts: dict[str, dict] = {}
        for r in self._all("SELECT monument_id, status, COUNT(*) AS n FROM facts GROUP BY monument_id, status"):
            c = counts.setdefault(r["monument_id"], {"draft": 0, "published": 0})
            if r["status"] in c:
                c[r["status"]] = r["n"]
        rows = [{"monument_id": m.monument_id, "name": m.name, "city": m.city, "type": m.type, "origin": "catalog",
                 "status": "published"} for m in self._base().values()]
        rows += [{"monument_id": r["monument_id"], "name": json.loads(r["data"])["name"],
                  "city": json.loads(r["data"])["city"], "type": json.loads(r["data"])["type"], "origin": "content",
                  "status": r["status"]} for r in self._all("SELECT * FROM monuments")]
        base = self._base()
        for row in rows:
            c = dict(counts.get(row["monument_id"], {"draft": 0, "published": 0}))
            if row["monument_id"] in base:  # onaylı katalogdaki kayıtlar da yayındadır
                c["published"] += len(base[row["monument_id"]].facts)
            row["facts"] = c
        return sorted(rows, key=lambda r: (r["city"], r["monument_id"]))

    @staticmethod
    def _check_monument(fields: dict):
        if (fields["latitude"] is None) != (fields["longitude"] is None):
            raise ContentError("Enlem ve boylam birlikte verilmeli (ya da ikisi de boş).", 400)
        if fields["latitude"] == 0 and fields["longitude"] == 0:
            raise ContentError("0,0 geçerli bir eser konumu değildir.", 400)
        if fields["type"] not in TYPES:
            raise ContentError("Bilinmeyen eser türü.", 400)

    def create_monument(self, fields: dict, publish: bool, actor: str) -> dict:
        self._check_monument(fields)
        slug = fields.pop("city_slug")
        code = city_code(slug)
        with self._tx():
            nums = [int(r["monument_id"][4:]) for r in
                    self._all("SELECT monument_id FROM monuments WHERE monument_id LIKE ?", (f"{code}-%",))]
            monument_id = f"{code}-{max([NEW_MONUMENT_FROM - 1, *nums]) + 1:04d}"
            now = self._clock()
            decision = self._decide("monument", monument_id, "publish", actor, fields) if publish else None
            self._db.execute("INSERT INTO monuments VALUES (?,?,?,?,?,?,?)",
                             (monument_id, json.dumps(fields, ensure_ascii=False), "published" if publish else "draft",
                              actor, now, now, decision and decision["decision_id"]))
        self.write_overlay()
        return self.monument(monument_id)

    def update_monument(self, monument_id: str, fields: dict, publish: bool, actor: str) -> dict:
        if monument_id in self._base():
            raise ContentError("Onaylı katalog eseri buradan düzenlenemez; yalnızca kayıt ve görsel eklenebilir.")
        if self._content_monument(monument_id) is None:
            raise ContentError("Eser bulunamadı.", 404)
        self._check_monument(fields)
        slug = fields.pop("city_slug")
        if city_code(slug) != monument_id[:3]:
            raise ContentError("Eserin şehri değiştirilemez (kimlik şehir koduna bağlıdır).", 400)
        with self._tx():
            decision = self._decide("monument", monument_id, "publish", actor, fields) if publish else None
            self._db.execute("UPDATE monuments SET data=?, status=?, updated_at=?, decision_id=? WHERE monument_id=?",
                             (json.dumps(fields, ensure_ascii=False), "published" if publish else "draft", self._clock(),
                              decision and decision["decision_id"], monument_id))
        self.write_overlay()
        return self.monument(monument_id)

    def withdraw_monument(self, monument_id: str, actor: str) -> dict:
        r = self._content_monument(monument_id)
        if r is None:
            raise ContentError("Yalnızca yönetimden eklenen eser yayından çekilebilir.", 404 if monument_id not in
                               self._base() else 409)
        if r["status"] != "published":
            raise ContentError("Eser yayında değil.")
        with self._tx():
            self._decide("monument", monument_id, "withdraw", actor, json.loads(r["data"]))
            self._db.execute("UPDATE monuments SET status='withdrawn', updated_at=?, decision_id=NULL WHERE monument_id=?",
                             (self._clock(), monument_id))
        self.write_overlay()
        return self.monument(monument_id)

    # --- Kayıtlar -------------------------------------------------------------------------------------------------

    def _quote_check(self, data: dict) -> str:
        if not data.get("quote", "").strip():
            return "no_quote"
        try:
            pages = self.pages(data["source_id"])
        except ContentError:
            return "not_found"
        return "found" if pdftext.quote_page(pages, data["page"], data["quote"]) == data["page"] else "not_found"

    def _fact_view(self, r: sqlite3.Row) -> dict:
        data = json.loads(r["data"])
        return {"fact_id": r["fact_id"], "monument_id": r["monument_id"], **data, "origin": r["origin"],
                "status": r["status"], "quote_check": self._quote_check(data), "updated_at": r["updated_at"],
                "decision": self._decision(r["decision_id"])}

    def fact(self, fact_id: str) -> dict:
        r = self._one("SELECT * FROM facts WHERE fact_id=?", (fact_id,))
        if r is None:
            raise ContentError("Kayıt bulunamadı.", 404)
        return self._fact_view(r)

    def facts(self, status: Optional[str] = None, monument_id: Optional[str] = None) -> list[dict]:
        sql, args = "SELECT * FROM facts WHERE 1=1", []
        if status:
            sql, args = sql + " AND status=?", args + [status]
        if monument_id:
            sql, args = sql + " AND monument_id=?", args + [monument_id]
        return [self._fact_view(r) for r in self._all(sql + " ORDER BY updated_at DESC, fact_id", tuple(args))]

    def _validate_fact(self, data: dict):
        src = self.source(data["source_id"])
        if not 1 <= data["page"] <= src["page_count"]:
            raise ContentError(f"Sayfa 1–{src['page_count']} aralığında olmalı.", 400)
        if data["category"] not in CATEGORIES or data["certainty"] not in CERTAINTY:
            raise ContentError("Bilinmeyen kategori veya kesinlik.", 400)
        q = data.get("quest")
        if q is not None:
            if not data["game_use"]:
                raise ContentError("Keşif sorusu yalnızca oyunda kullanılan kayıtta olabilir.", 400)
            if not 2 <= len(q["choices"]) <= 4 or not 0 <= q["answer_index"] < len(q["choices"]):
                raise ContentError("Soruda 2–4 seçenek ve geçerli bir doğru cevap olmalı.", 400)
            if len({pdftext.squash(c) for c in q["choices"]}) != len(q["choices"]):
                raise ContentError("Soru seçenekleri birbirinden farklı olmalı.", 400)

    def _publish_rules(self, data: dict, origin: str):
        src = self.source(data["source_id"])
        if not src["rights_confirmed"]:
            raise ContentError("Bu kaynağın kullanım izni onaylanmadığı için kitaptan türetilen kayıt yayımlanamaz.")
        check = self._quote_check(data)
        if check == "not_found":
            raise ContentError(f"Alıntı kaynağın {data['page']}. sayfasında bulunamadı; alıntıyı veya sayfayı düzeltin.")
        if origin == "pipeline" and check != "found":
            raise ContentError("Hattan gelen kayıt, kaynakta bulunan birebir alıntı olmadan yayımlanamaz.")

    def _next_fact_id(self, monument_id: str) -> str:
        nums = [int(r["fact_id"].rsplit("-F", 1)[1]) for r in
                self._all("SELECT fact_id FROM facts WHERE monument_id=?", (monument_id,))]
        base = self._base().get(monument_id)
        if base is not None:
            nums += [int(f.fact_id.rsplit("-F", 1)[1]) for f in base.facts]
            start = CATALOG_FACT_FROM
        else:
            start = 1
        return f"{monument_id}-F{max([start - 1, *nums]) + 1:03d}"

    def create_fact(self, monument_id: str, data: dict, origin: str, publish: bool, actor: str) -> dict:
        if not self.monument_exists(monument_id):
            raise ContentError("Eser bulunamadı.", 404)
        self._validate_fact(data)
        if publish:
            self._publish_rules(data, origin)
        with self._tx():
            fact_id = self._next_fact_id(monument_id)
            now = self._clock()
            decision = self._decide("fact", fact_id, "publish", actor, data) if publish else None
            self._db.execute("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?)",
                             (fact_id, monument_id, json.dumps(data, ensure_ascii=False), origin,
                              "published" if publish else "draft", actor, now, now, decision and decision["decision_id"]))
        if publish:
            self.write_overlay()
        return self.fact(fact_id)

    def update_fact(self, fact_id: str, data: dict, publish: bool, actor: str) -> dict:
        r = self._one("SELECT * FROM facts WHERE fact_id=?", (fact_id,))
        if r is None:
            raise ContentError("Kayıt bulunamadı.", 404)
        self._validate_fact(data)
        if publish:
            self._publish_rules(data, r["origin"])
        with self._tx():
            decision = self._decide("fact", fact_id, "publish", actor, data) if publish else None
            self._db.execute("UPDATE facts SET data=?, status=?, updated_at=?, decision_id=? WHERE fact_id=?",
                             (json.dumps(data, ensure_ascii=False), "published" if publish else "draft", self._clock(),
                              decision and decision["decision_id"], fact_id))
        self.write_overlay()
        return self.fact(fact_id)

    def set_fact_status(self, fact_id: str, action: str, actor: str) -> dict:
        r = self._one("SELECT * FROM facts WHERE fact_id=?", (fact_id,))
        if r is None:
            raise ContentError("Kayıt bulunamadı.", 404)
        data = json.loads(r["data"])
        if action == "publish":
            if r["status"] == "published":
                raise ContentError("Kayıt zaten yayında.")
            self._publish_rules(data, r["origin"])
            new_status = "published"
        elif action == "reject":
            if r["status"] == "published":
                raise ContentError("Yayındaki kayıt reddedilemez; önce yayından çekin.")
            new_status = "rejected"
        elif action == "withdraw":
            if r["status"] != "published":
                raise ContentError("Kayıt yayında değil.")
            new_status = "withdrawn"
        else:  # pragma: no cover - uçlar yalnızca bu üç eylemi çağırır
            raise ContentError("Bilinmeyen eylem.", 400)
        with self._tx():
            decision = self._decide("fact", fact_id, action, actor, data)
            self._db.execute("UPDATE facts SET status=?, updated_at=?, decision_id=? WHERE fact_id=?",
                             (new_status, self._clock(), decision["decision_id"] if action == "publish" else None, fact_id))
        self.write_overlay()
        return self.fact(fact_id)

    def known_fact_texts(self, monument_id: str) -> set[str]:
        """Eserin mevcut kayıtlarının (katalog + depo, reddedilenler dahil) karşılaştırma biçimi: hat tekrar önermez."""
        out = {pdftext.squash(json.loads(r["data"])["text"]) for r in
               self._all("SELECT data FROM facts WHERE monument_id=?", (monument_id,))}
        out |= {pdftext.squash(json.loads(r["data"]).get("quote", "")) for r in
                self._all("SELECT data FROM facts WHERE monument_id=?", (monument_id,))} - {""}
        base = self._base().get(monument_id)
        return out | ({pdftext.squash(f.text) for f in base.facts} if base else set())

    # --- Görseller ------------------------------------------------------------------------------------------------

    def _image_view(self, r: sqlite3.Row) -> dict:
        data = json.loads(r["data"])
        return {"image_id": r["image_id"], "monument_id": r["monument_id"], "file": r["file"],
                "url": f"/admin/content/media/{r['file']}", **data, "status": r["status"],
                "decision": self._decision(r["decision_id"])}

    def images(self, monument_id: str) -> list[dict]:
        return [self._image_view(r) for r in
                self._all("SELECT * FROM images WHERE monument_id=? ORDER BY image_id", (monument_id,))]

    def add_image(self, monument_id: str, upload_id: str, meta: dict, publish: bool, actor: str) -> dict:
        if not self.monument_exists(monument_id):
            raise ContentError("Eser bulunamadı.", 404)
        if meta["license"].upper().startswith("CC-BY") and not meta.get("attribution"):
            raise ContentError("CC BY lisanslı görselde atıf zorunludur.", 400)
        data, _ = self._take_upload(upload_id, "image")
        file, card, (w, h) = _store_image(data, self.media_dir)
        with self._tx():
            n = len(self._all("SELECT 1 FROM images WHERE monument_id=?", (monument_id,))) + 1
            image_id = f"{monument_id}-G{n:03d}"
            now = self._clock()
            decision = self._decide("image", image_id, "publish", actor, {**meta, "file": file}) if publish else None
            self._db.execute("INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                             (image_id, monument_id, file, card, w, h, json.dumps(meta, ensure_ascii=False),
                              "published" if publish else "draft", actor, now, now, decision and decision["decision_id"]))
        self._drop_upload(upload_id)
        if publish:
            self.write_overlay()
        return self._image_view(self._one("SELECT * FROM images WHERE image_id=?", (image_id,)))

    def set_image_status(self, image_id: str, action: str, actor: str) -> dict:
        r = self._one("SELECT * FROM images WHERE image_id=?", (image_id,))
        if r is None:
            raise ContentError("Görsel bulunamadı.", 404)
        if (action == "publish") == (r["status"] == "published"):
            raise ContentError("Görsel zaten yayında." if action == "publish" else "Görsel yayında değil.")
        with self._tx():
            decision = self._decide("image", image_id, action, actor, json.loads(r["data"]))
            self._db.execute("UPDATE images SET status=?, updated_at=?, decision_id=? WHERE image_id=?",
                             ("published" if action == "publish" else "withdrawn", self._clock(),
                              decision["decision_id"] if action == "publish" else None, image_id))
        self.write_overlay()
        return self._image_view(self._one("SELECT * FROM images WHERE image_id=?", (image_id,)))

    # --- Kitaptan görsel (karar 14 = A) -----------------------------------------------------------------------------

    def _page_pil_images(self, source_id: str, page: int) -> list:
        """Sayfadaki gömülü görseller (PIL), küçük süs görselleri elenmiş. Sıra PDF'teki sıradır."""
        src = self.source(source_id)
        if not 1 <= page <= src["page_count"]:
            raise ContentError(f"Sayfa 1–{src['page_count']} aralığında olmalı.", 404)
        from pypdf import PdfReader

        try:
            reader = PdfReader(str(self.root / "sources" / f"{source_id}.pdf"))
            images = list(reader.pages[page - 1].images)
        except Exception as e:  # noqa: BLE001 — bozuk görsel akışı sayfayı düşürmez
            logger.warning("Kaynak %s s.%d görselleri okunamadı: %s", source_id, page, type(e).__name__)
            return []
        out = []
        for im in images:
            try:
                pil = im.image
            except Exception:  # noqa: BLE001
                continue
            w, h = pil.size
            if min(w, h) >= MIN_BOOK_IMAGE_SIDE and max(w, h) >= 2 * MIN_BOOK_IMAGE_SIDE:
                out.append(pil)
        return out

    def page_images(self, source_id: str, page: int) -> list[dict]:
        return [{"index": i, "width": im.size[0], "height": im.size[1],
                 "url": f"/admin/content/sources/{source_id}/pages/{page}/images/{i}"}
                for i, im in enumerate(self._page_pil_images(source_id, page))]

    def page_image_preview(self, source_id: str, page: int, index: int) -> bytes:
        images = self._page_pil_images(source_id, page)
        if not 0 <= index < len(images):
            raise ContentError("Görsel bulunamadı.", 404)
        from io import BytesIO

        im = images[index].convert("RGB")
        im.thumbnail((640, 640))
        buf = BytesIO()
        im.save(buf, "JPEG", quality=80)
        return buf.getvalue()

    def add_image_from_source(self, monument_id: str, source_id: str, page: int, index: int, title: Optional[str],
                              publish: bool, actor: str) -> dict:
        if not self.monument_exists(monument_id):
            raise ContentError("Eser bulunamadı.", 404)
        src = self.source(source_id)
        images = self._page_pil_images(source_id, page)
        if not 0 <= index < len(images):
            raise ContentError("Görsel bulunamadı.", 404)
        from io import BytesIO

        buf = BytesIO()
        images[index].convert("RGB").save(buf, "JPEG", quality=95)
        file, card, (w, h) = _store_image(buf.getvalue(), self.media_dir)
        meta = {"rights_holder": BOOK_RIGHTS_HOLDER, "license": BOOK_LICENSE,
                "attribution": f"Görsel: {src['title']}, s. {page}", "title": title or None, "source_url": None,
                "origin": "source", "source_id": source_id, "page": page}
        with self._tx():
            n = len(self._all("SELECT 1 FROM images WHERE monument_id=?", (monument_id,))) + 1
            image_id = f"{monument_id}-G{n:03d}"
            now = self._clock()
            decision = self._decide("image", image_id, "publish", actor, {**meta, "file": file}) if publish else None
            self._db.execute("INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                             (image_id, monument_id, file, card, w, h, json.dumps(meta, ensure_ascii=False),
                              "published" if publish else "draft", actor, now, now, decision and decision["decision_id"]))
        if publish:
            self.write_overlay()
        return self._image_view(self._one("SELECT * FROM images WHERE image_id=?", (image_id,)))

    def media_file(self, file: str) -> Optional[Path]:
        if not self._one("SELECT 1 FROM images WHERE file=? OR card_file=?", (file, file)):
            return None
        path = self.media_dir / file
        return path if path.is_file() else None

    # --- Hat işleri -----------------------------------------------------------------------------------------------

    def create_job(self, source_id: str, monument_id: str, page_from: int, page_to: int, actor: str) -> dict:
        job_id = "JOB-" + secrets.token_hex(6)
        self._exec("INSERT INTO jobs (job_id, source_id, monument_id, page_from, page_to, status, created_by, created_at) "
                   "VALUES (?,?,?,?,?,?,?,?)", (job_id, source_id, monument_id, page_from, page_to, "queued", actor,
                                                self._clock()))
        return self.job(job_id)

    def update_job(self, job_id: str, **fields):
        cols = ", ".join(f"{k}=?" for k in fields)
        self._exec(f"UPDATE jobs SET {cols} WHERE job_id=?", (*fields.values(), job_id))

    def job(self, job_id: str) -> dict:
        r = self._one("SELECT * FROM jobs WHERE job_id=?", (job_id,))
        if r is None:
            raise ContentError("İş bulunamadı.", 404)
        return {k: r[k] for k in ("job_id", "source_id", "monument_id", "page_from", "page_to", "status", "created_at",
                                  "finished_at", "candidates", "dropped", "error")}

    def active_job(self) -> Optional[dict]:
        r = self._one("SELECT job_id FROM jobs WHERE status IN ('queued','running') LIMIT 1")
        return self.job(r["job_id"]) if r else None

    # --- Yayın katmanı --------------------------------------------------------------------------------------------

    def _public_fact(self, r: sqlite3.Row, sources: dict) -> dict:
        data = json.loads(r["data"])
        dec = r["decision_id"]
        fact = {"fact_id": r["fact_id"], "title": data["title"], "text": data["text"], "category": data["category"],
                "certainty": data["certainty"],
                "source": {"title": sources[data["source_id"]], "pdf_physical_page": data["page"], "page_kind": "physical"},
                "editorial_decision_id": dec, "publication_decision_id": dec, "game_use": data["game_use"],
                "game_use_decision_id": dec if data["game_use"] else None, "basis": "licensed_source"}
        if data.get("quest"):
            fact["quest"] = {**data["quest"], "decision_id": dec}
        return PublicFact.model_validate(fact).model_dump(mode="json")

    def _public_image(self, r: sqlite3.Row) -> dict:
        data = json.loads(r["data"])
        img = {"image_id": r["image_id"], "file": r["file"], "card_file": r["card_file"], "width": r["width"],
               "height": r["height"], "rights_holder": data["rights_holder"], "license": data["license"],
               "attribution": data.get("attribution") or None, "title": data.get("title") or None,
               "source_url": data.get("source_url") or None, "rights_decision_id": r["decision_id"],
               "publication_decision_id": r["decision_id"], "game_use": False,
               "source_label": BOOK_SOURCE_LABEL if data.get("origin") == "source" else "Yönetici yüklemesi"}
        return PublicImage.model_validate(img).model_dump(mode="json")

    def build_overlay(self) -> dict:
        sources = {r["source_id"]: r["title"] for r in self._all("SELECT source_id, title FROM sources")}
        facts: dict[str, list] = {}
        for r in self._all("SELECT * FROM facts WHERE status='published' ORDER BY fact_id"):
            facts.setdefault(r["monument_id"], []).append(self._public_fact(r, sources))
        images: dict[str, list] = {}
        for r in self._all("SELECT * FROM images WHERE status='published' ORDER BY image_id"):
            images.setdefault(r["monument_id"], []).append(self._public_image(r))
        monuments = []
        for r in self._all("SELECT * FROM monuments WHERE status='published' ORDER BY monument_id"):
            d, dec = json.loads(r["data"]), r["decision_id"]
            loc = None
            if d["latitude"] is not None:
                loc = {"latitude": d["latitude"], "longitude": d["longitude"], "accuracy_m": MAP_PICK_ACCURACY_M,
                       "represents": "admin_map_point", "verification_decision_id": dec, "map_decision_id": dec}
            m = {"monument_id": r["monument_id"], "name": d["name"], "alternative_names": d["alternative_names"],
                 "type": d["type"], "city": d["city"], "district": d["district"], "address": d["address"],
                 "catalog_decision_id": dec, "facts": facts.pop(r["monument_id"], []),
                 "images": images.pop(r["monument_id"], []), "location": loc, "site_notice": d.get("site_notice") or None}
            monuments.append(PublicMonument.model_validate(m).model_dump(mode="json"))
        base = self._base()
        # Katalog eserlerine eklenenler. Taslak (yayında olmayan) yönetici eserinin kayıtları katmana girmez.
        extra_facts = [{"monument_id": mid, "fact": f} for mid, fs in facts.items() if mid in base for f in fs]
        extra_images = [{"monument_id": mid, "image": i} for mid, imgs in images.items() if mid in base for i in imgs]
        return {"schema": OVERLAY_SCHEMA, "generated_at": self._clock(), "monuments": monuments,
                "facts": extra_facts, "images": extra_images}

    def write_overlay(self):
        with self._lock:
            overlay = self.build_overlay()
            tmp = self.overlay_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(overlay, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, self.overlay_path)

    def draft_count(self) -> int:
        return self._one("SELECT COUNT(*) AS n FROM facts WHERE status='draft'")["n"]


def _store_image(data: bytes, media_dir: Path) -> tuple[str, str, tuple[int, int]]:
    """Görseli yeniden kodlar (EXIF/konum bilgisi atılır), en fazla 2400 px; kart için 800 px. Ad: içerik özeti."""
    from io import BytesIO

    from PIL import Image, UnidentifiedImageError

    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise ContentError("Görsel okunamadı.", 400) from e
    img = img.convert("RGB")
    img.thumbnail((2400, 2400))
    names = []
    for im in (img, img.copy()):
        if names:
            im.thumbnail((800, 800))
        buf = BytesIO()
        im.save(buf, "JPEG", quality=86, optimize=True)
        raw = buf.getvalue()
        name = f"{_sha(raw)}.jpg"
        (media_dir / name).write_bytes(raw)
        names.append(name)
    return names[0], names[1], img.size
