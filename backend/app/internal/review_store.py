"""Editör, hak ve konum kararlarının kalıcı deposu (SQLite).

- **İncelemeci hesapları:** Her gerçek kişinin ayrı hesabı, rolü ve kişisel kimlik bilgisi vardır. Kimlik bilgisi yalnızca
  scrypt özeti olarak saklanır; açık hali bir kez, hesap oluşturulurken komut satırında gösterilir (`reviewers.py`).
  Paylaşılan dahili erişim anahtarı bir kişinin kimliğini kanıtlamaz; bu yüzden onunla karar kaydedilemez.
- **Kararlar yalnızca eklenir:** Bir kararı değiştirmek, öncekinin yerine geçen yeni bir karar eklemek demektir.
  Veritabanı tetikleyicileri `decisions` ve `audit_log` tablolarında UPDATE/DELETE işlemini reddeder.
- **Denetim günlüğü hash zinciridir:** Her kayıt bir öncekinin özetini içerir; `verify_audit_chain` aradan silinen veya
  değiştirilen kaydı yakalar.
- Kayıtlı karar yoksa durum her zaman `pending`'dir; hiçbir onayın varsayılanı `approved` değildir.
"""

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

Role = Literal["editor", "rights", "location"]
ROLES: tuple[Role, ...] = ("editor", "rights", "location")
DecisionValue = Literal["approved", "rejected", "needs_revision"]

GENESIS_HASH = "0" * 64
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

SCHEMA = """
CREATE TABLE IF NOT EXISTS reviewers (
    reviewer_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    roles TEXT NOT NULL,
    credential_salt BLOB NOT NULL,
    credential_hash BLOB NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id TEXT NOT NULL UNIQUE,
    subject_kind TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'needs_revision')),
    source_check TEXT NOT NULL,
    rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
    payload_json TEXT NOT NULL,
    reviewer_id TEXT NOT NULL REFERENCES reviewers(reviewer_id),
    reviewer_name TEXT NOT NULL,
    reviewer_role TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    data_version TEXT NOT NULL,
    subject_sha256 TEXT NOT NULL,
    supersedes TEXT,
    open_issue_ids_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_subject ON decisions (subject_kind, subject_id, decision_type, seq);
CREATE TABLE IF NOT EXISTS audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    subject TEXT NOT NULL,
    details_json TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS decisions_no_update BEFORE UPDATE ON decisions
    BEGIN SELECT RAISE(ABORT, 'decisions tablosu yalnızca eklenebilir'); END;
CREATE TRIGGER IF NOT EXISTS decisions_no_delete BEFORE DELETE ON decisions
    BEGIN SELECT RAISE(ABORT, 'decisions tablosu yalnızca eklenebilir'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log tablosu yalnızca eklenebilir'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log tablosu yalnızca eklenebilir'); END;
CREATE TRIGGER IF NOT EXISTS reviewers_no_delete BEFORE DELETE ON reviewers
    BEGIN SELECT RAISE(ABORT, 'incelemeci silinemez; devre dışı bırakılır'); END;
"""


class ReviewStoreError(ValueError):
    pass


@dataclass(frozen=True)
class Reviewer:
    reviewer_id: str
    display_name: str
    roles: tuple[str, ...]
    active: bool


@dataclass(frozen=True)
class DecisionRecord:
    seq: int
    decision_id: str
    subject_kind: str
    subject_id: str
    decision_type: str
    decision: str
    source_check: str
    rationale: str
    payload: dict
    reviewer_id: str
    reviewer_name: str
    reviewer_role: str
    reviewed_at: str
    data_version: str
    subject_sha256: str
    supersedes: Optional[str]
    open_issue_ids: tuple[str, ...]

    def to_dict(self) -> dict:
        return {**self.__dict__, "open_issue_ids": list(self.open_issue_ids)}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _canonical(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash_credential(credential: str, salt: bytes) -> bytes:
    return hashlib.scrypt(credential.encode(), salt=salt, **_SCRYPT)


def _entry_hash(prev_hash: str, at: str, actor: str, action: str, subject: str, details_json: str) -> str:
    return hashlib.sha256(_canonical([prev_hash, at, actor, action, subject, details_json]).encode()).hexdigest()


class ReviewStore:
    def __init__(self, path: Path, clock=utc_now):
        self.path = Path(path)
        self._clock = clock
        # Tek bağlantı tüm iş parçacıklarınca paylaşılır (`check_same_thread=False`); sqlite3 bağlantısı eşzamanlı
        # kullanıma güvenli değildir. Okumalar da yazmalar gibi bu kilidin altında yapılır (bkz. `_all`, `_one`).
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(self.path.parent, 0o700)
        new = not self.path.exists()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        if new:
            os.chmod(self.path, 0o600)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.executescript(SCHEMA)

    def close(self):
        with self._lock:
            self._db.close()

    def _all(self, sql: str, args=()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def _one(self, sql: str, args=()) -> Optional[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchone()

    def _now(self) -> str:
        return self._clock().astimezone(timezone.utc).isoformat(timespec="seconds")

    def _append_audit(self, actor: str, action: str, subject: str, details: dict, at: Optional[str] = None):
        at = at or self._now()
        row = self._db.execute("SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1").fetchone()
        prev = row["entry_hash"] if row else GENESIS_HASH
        details_json = _canonical(details)
        self._db.execute(
            "INSERT INTO audit_log (at, actor, action, subject, details_json, prev_hash, entry_hash) VALUES (?,?,?,?,?,?,?)",
            (at, actor, action, subject, details_json, prev, _entry_hash(prev, at, actor, action, subject, details_json)),
        )

    def log(self, actor: str, action: str, subject: str, details: Optional[dict] = None):
        """Karar dışındaki olayları (oturum açma, başarısız giriş, dışa aktarma) denetim günlüğüne yazar."""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._append_audit(actor, action, subject, details or {})
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise

    # --- İncelemeciler -------------------------------------------------------------

    def add_reviewer(self, reviewer_id: str, display_name: str, roles: tuple[str, ...], created_by: str) -> str:
        """Hesap oluşturur ve kişisel kimlik bilgisini **bir kez** döndürür."""
        reviewer_id, display_name = reviewer_id.strip(), display_name.strip()
        if not reviewer_id or not display_name:
            raise ReviewStoreError("İncelemeci kimliği ve görünen adı boş olamaz.")
        if not roles or any(r not in ROLES for r in roles):
            raise ReviewStoreError(f"Geçersiz rol; izin verilenler: {', '.join(ROLES)}.")
        credential = secrets.token_urlsafe(32)
        salt = secrets.token_bytes(16)
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute(
                    "INSERT INTO reviewers VALUES (?,?,?,?,?,1,?,?)",
                    (reviewer_id, display_name, ",".join(sorted(set(roles))), salt,
                     _hash_credential(credential, salt), self._now(), created_by),
                )
                self._append_audit(created_by, "reviewer_created", f"reviewer:{reviewer_id}",
                                   {"display_name": display_name, "roles": sorted(set(roles))})
                self._db.execute("COMMIT")
            except sqlite3.IntegrityError:
                self._db.execute("ROLLBACK")
                raise ReviewStoreError(f"'{reviewer_id}' kimlikli incelemeci zaten var.") from None
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return credential

    def set_active(self, reviewer_id: str, active: bool, changed_by: str):
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                cur = self._db.execute("UPDATE reviewers SET active=? WHERE reviewer_id=?", (int(active), reviewer_id))
                if cur.rowcount != 1:
                    raise ReviewStoreError(f"'{reviewer_id}' bulunamadı.")
                self._append_audit(changed_by, "reviewer_activated" if active else "reviewer_deactivated",
                                   f"reviewer:{reviewer_id}", {})
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise

    def reviewer(self, reviewer_id: str) -> Optional[Reviewer]:
        row = self._one("SELECT * FROM reviewers WHERE reviewer_id=?", (reviewer_id,))
        if row is None:
            return None
        return Reviewer(row["reviewer_id"], row["display_name"], tuple(row["roles"].split(",")), bool(row["active"]))

    def reviewers(self) -> list[Reviewer]:
        rows = self._all("SELECT reviewer_id FROM reviewers ORDER BY reviewer_id")
        return [self.reviewer(r["reviewer_id"]) for r in rows]

    def authenticate(self, reviewer_id: str, credential: str) -> Optional[Reviewer]:
        row = self._one("SELECT * FROM reviewers WHERE reviewer_id=?", (reviewer_id,))
        # Bilinmeyen kullanıcıda da özet hesaplanır; yanıt süresi hesabın varlığını ele vermez.
        salt = row["credential_salt"] if row else b"\0" * 16
        expected = row["credential_hash"] if row else b"\0" * 32
        ok = hmac.compare_digest(_hash_credential(credential, salt), expected)
        if not (row and ok and row["active"]):
            return None
        return self.reviewer(reviewer_id)

    # --- Kararlar --------------------------------------------------------------------

    def _row_to_decision(self, row) -> DecisionRecord:
        return DecisionRecord(
            seq=row["seq"], decision_id=row["decision_id"], subject_kind=row["subject_kind"],
            subject_id=row["subject_id"], decision_type=row["decision_type"], decision=row["decision"],
            source_check=row["source_check"], rationale=row["rationale"], payload=json.loads(row["payload_json"]),
            reviewer_id=row["reviewer_id"], reviewer_name=row["reviewer_name"], reviewer_role=row["reviewer_role"],
            reviewed_at=row["reviewed_at"], data_version=row["data_version"], subject_sha256=row["subject_sha256"],
            supersedes=row["supersedes"], open_issue_ids=tuple(json.loads(row["open_issue_ids_json"])),
        )

    def latest(self, subject_kind: str, subject_id: str, decision_type: str) -> Optional[DecisionRecord]:
        row = self._one(
            "SELECT * FROM decisions WHERE subject_kind=? AND subject_id=? AND decision_type=? ORDER BY seq DESC LIMIT 1",
            (subject_kind, subject_id, decision_type),
        )
        return self._row_to_decision(row) if row else None

    def latest_all(self) -> dict[tuple[str, str, str], DecisionRecord]:
        """Her (konu türü, konu, karar türü) için en son karar."""
        rows = self._all(
            "SELECT d.* FROM decisions d JOIN (SELECT MAX(seq) AS seq FROM decisions "
            "GROUP BY subject_kind, subject_id, decision_type) m ON d.seq = m.seq"
        )
        return {(r["subject_kind"], r["subject_id"], r["decision_type"]): self._row_to_decision(r) for r in rows}

    def history(self, subject_kind: Optional[str] = None, subject_id: Optional[str] = None) -> list[DecisionRecord]:
        sql, args = "SELECT * FROM decisions", []
        if subject_kind is not None:
            sql += " WHERE subject_kind=? AND subject_id=?"
            args = [subject_kind, subject_id]
        rows = self._all(sql + " ORDER BY seq", args)
        return [self._row_to_decision(r) for r in rows]

    def count_by_reviewer_since(self, reviewer_id: str, since_iso: str) -> int:
        row = self._one(
            "SELECT COUNT(*) AS n FROM decisions WHERE reviewer_id=? AND reviewed_at >= ?", (reviewer_id, since_iso)
        )
        return row["n"]

    def record_decision(
        self,
        *,
        reviewer: Reviewer,
        role: str,
        subject_kind: str,
        subject_id: str,
        decision_type: str,
        decision: str,
        source_check: str,
        rationale: str,
        payload: dict,
        data_version: str,
        subject_sha256: str,
        expected_supersedes: Optional[str],
        open_issue_ids: tuple[str, ...],
    ) -> DecisionRecord:
        """Kararı ve denetim kaydını tek işlemde ekler. Araya başka karar girdiyse reddeder (eşzamanlılık)."""
        if role not in reviewer.roles:
            raise ReviewStoreError("İncelemecinin bu karar için rolü yok.")
        at = self._now()
        decision_id = f"DEC-{secrets.token_hex(8)}"
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                current = self._db.execute(
                    "SELECT decision_id FROM decisions WHERE subject_kind=? AND subject_id=? AND decision_type=? "
                    "ORDER BY seq DESC LIMIT 1",
                    (subject_kind, subject_id, decision_type),
                ).fetchone()
                if (current["decision_id"] if current else None) != expected_supersedes:
                    raise ReviewStoreError("Bu kayıt için siz incelerken başka bir karar kaydedildi; yeniden açın.")
                active = self._db.execute("SELECT active FROM reviewers WHERE reviewer_id=?",
                                          (reviewer.reviewer_id,)).fetchone()
                if not (active and active["active"]):
                    raise ReviewStoreError("İncelemeci hesabı etkin değil.")
                self._db.execute(
                    "INSERT INTO decisions (decision_id, subject_kind, subject_id, decision_type, decision, source_check, "
                    "rationale, payload_json, reviewer_id, reviewer_name, reviewer_role, reviewed_at, data_version, "
                    "subject_sha256, supersedes, open_issue_ids_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (decision_id, subject_kind, subject_id, decision_type, decision, source_check, rationale.strip(),
                     _canonical(payload), reviewer.reviewer_id, reviewer.display_name, role, at, data_version,
                     subject_sha256, expected_supersedes, _canonical(list(open_issue_ids))),
                )
                self._append_audit(
                    reviewer.reviewer_id, "decision_recorded", f"{subject_kind}:{subject_id}",
                    {"decision_id": decision_id, "decision_type": decision_type, "decision": decision,
                     "source_check": source_check, "supersedes": expected_supersedes, "data_version": data_version,
                     "subject_sha256": subject_sha256},
                    at=at,
                )
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
        return self.latest(subject_kind, subject_id, decision_type)

    # --- Denetim günlüğü -------------------------------------------------------------

    def audit_entries(self, limit: int = 200) -> list[dict]:
        rows = self._all("SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?", (limit,))
        return [{**dict(r), "details": json.loads(r["details_json"])} for r in rows]

    def verify_audit_chain(self) -> dict:
        prev, count = GENESIS_HASH, 0
        for r in self._all("SELECT * FROM audit_log ORDER BY seq"):
            expected = _entry_hash(prev, r["at"], r["actor"], r["action"], r["subject"], r["details_json"])
            if r["prev_hash"] != prev or r["entry_hash"] != expected:
                return {"valid": False, "entries": count, "broken_at_seq": r["seq"]}
            prev, count = r["entry_hash"], count + 1
        decisions = self._one("SELECT COUNT(*) AS n FROM decisions")["n"]
        logged = self._one("SELECT COUNT(*) AS n FROM audit_log WHERE action='decision_recorded'")["n"]
        return {"valid": decisions == logged, "entries": count, "decisions": decisions,
                "decisions_logged": logged, "head": prev}
