"""Gerçek eserlerde ziyaretçi ilerlemesi: keşif soruları ve iki ayrı mühür türü (kalıcı SQLite).

- **Bilgi mührü (`knowledge`)**: Eserin yayın ve oyun onaylı bütün keşif soruları doğru cevaplanınca verilir. Uzaktan
  kazanılabilir; fiziksel ziyaret iddia etmez.
- **Ziyaret mührü (`visit`)**: Yalnızca `gps_checkin` kararıyla onaylanmış giriş noktasında, yarıçap içinde yapılan
  check-in ile verilir. GPS onayı olmayan eserde bu mühür kazanılamaz.

Aynı mühür ikinci kez verilmez (birincil anahtar). Doğru cevap bir kez kaydedilir; yanlış denemeler yalnızca sayılır.
Kullanıcı kimliği tarayıcıda üretilen takma bir kimliktir; kişisel veri tutulmaz.
"""

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from .models import Stamp

SealKind = Literal["knowledge", "visit"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS quest_answers (
    user_id TEXT NOT NULL,
    monument_id TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    correct_at TEXT,
    PRIMARY KEY (user_id, quest_id)
);
CREATE TABLE IF NOT EXISTS seals (
    user_id TEXT NOT NULL,
    monument_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('knowledge', 'visit')),
    monument_name TEXT NOT NULL,
    earned_at TEXT NOT NULL,
    PRIMARY KEY (user_id, monument_id, kind)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class MonumentProgressStore:
    def __init__(self, path: Optional[Path] = None):
        # Yol verilmezse bellek içi depo (testler). Üretimde dosya yolu verilir ve ilerleme yeniden başlatmada korunur.
        target = ":memory:"
        if path is not None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            target = str(path)
        self._db = sqlite3.connect(target, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        if path is not None:
            self._db.execute("PRAGMA journal_mode = WAL")
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()

    def close(self):
        with self._lock:
            self._db.close()

    # --- Sorular --------------------------------------------------------------------

    def record_answer(self, user_id: str, monument_id: str, quest_id: str, correct: bool) -> bool:
        """Cevabı kaydeder; soru bu kullanıcı için daha önce doğru cevaplanmışsa True döner (durum değişmez)."""
        with self._lock:
            self._db.execute(
                "INSERT INTO quest_answers (user_id, monument_id, quest_id, attempts, correct_at) VALUES (?,?,?,0,NULL) "
                "ON CONFLICT (user_id, quest_id) DO NOTHING", (user_id, monument_id, quest_id))
            row = self._db.execute("SELECT correct_at FROM quest_answers WHERE user_id=? AND quest_id=?",
                                   (user_id, quest_id)).fetchone()
            already = row["correct_at"] is not None
            self._db.execute("UPDATE quest_answers SET attempts = attempts + 1, correct_at = COALESCE(correct_at, ?) "
                             "WHERE user_id=? AND quest_id=?", (_now() if correct else None, user_id, quest_id))
            return already

    def solved(self, user_id: str, monument_id: Optional[str] = None) -> set[str]:
        sql = "SELECT quest_id FROM quest_answers WHERE user_id=? AND correct_at IS NOT NULL"
        args: tuple = (user_id,)
        if monument_id is not None:
            sql += " AND monument_id=?"
            args = (user_id, monument_id)
        with self._lock:
            return {r["quest_id"] for r in self._db.execute(sql, args).fetchall()}

    # --- Mühürler -------------------------------------------------------------------

    def add_seal(self, user_id: str, monument_id: str, monument_name: str, kind: SealKind) -> tuple[dict, bool]:
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO seals (user_id, monument_id, kind, monument_name, earned_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT DO NOTHING", (user_id, monument_id, kind, monument_name, _now()))
            row = self._db.execute("SELECT * FROM seals WHERE user_id=? AND monument_id=? AND kind=?",
                                   (user_id, monument_id, kind)).fetchone()
            return dict(row), cur.rowcount == 1

    def seals(self, user_id: str) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._db.execute(
                "SELECT * FROM seals WHERE user_id=? ORDER BY earned_at, monument_id", (user_id,)).fetchall()]

    # --- `services.check_in` arayüzü (yalnızca ziyaret mührü) ---------------------------

    def add_stamp(self, user_id: str, place) -> tuple[Stamp, bool]:
        seal, created = self.add_seal(user_id, place.id, place.name, "visit")
        return Stamp(place_id=seal["monument_id"], place_name=seal["monument_name"],
                     earned_at=datetime.fromisoformat(seal["earned_at"])), created

    def get_stamps(self, user_id: str) -> list[Stamp]:
        return [Stamp(place_id=s["monument_id"], place_name=s["monument_name"], earned_at=datetime.fromisoformat(s["earned_at"]))
                for s in self.seals(user_id) if s["kind"] == "visit"]
