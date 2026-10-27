"""Çerezsiz, anonim ziyaret istatistikleri (sponsorun isteği: ilgi ölçümü).

- Kişisel veri tutulmaz: IP, tarayıcı bilgisi veya kullanıcı kimliği diske yazılmaz. Günlük tekil ziyaretçi, yalnızca
  bellekte duran ve her gün yenilenen rastgele bir tuzla (IP + tarayıcı) özetlenerek sayılır; gün değişince özetler
  ve tuz atılır. Sunucu gün içinde yeniden başlarsa aynı kişi iki kez sayılabilir (bilinen sınır).
- Diske yalnızca günlük sayaçlar yazılır: `(gün, ölçü, anahtar) -> sayı`.
"""

import hashlib
import secrets
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

PAGES = ("acilis", "giris", "sehir", "rota", "eserler", "eser", "rozet", "pasaport", "hesap")
MAX_SEEN = 200_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS stats_daily (
    day TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('visitors', 'pageview', 'monument_view')),
    key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, metric, key)
);
"""


def _today() -> date:
    return datetime.now(timezone.utc).date()


class StatsStore:
    def __init__(self, path: Optional[Path] = None, today: Callable[[], date] = _today):
        target = ":memory:"
        if path is not None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            target = str(path)
        self._db = sqlite3.connect(target, check_same_thread=False, isolation_level=None)
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()
        self._today = today
        self._day: Optional[date] = None
        self._salt = b""
        self._seen: set[bytes] = set()

    def _bump(self, day: str, metric: str, key: str):
        self._db.execute("INSERT INTO stats_daily(day, metric, key, count) VALUES (?, ?, ?, 1) "
                         "ON CONFLICT(day, metric, key) DO UPDATE SET count = count + 1", (day, metric, key))

    def record(self, page: str, monument_id: Optional[str], client: str) -> None:
        """Bir sayfa görüntülemesini sayar. `client` (IP + tarayıcı) yalnızca bellekte, günlük tuzla özetlenir."""
        with self._lock:
            today = self._today()
            if today != self._day:
                self._day, self._salt, self._seen = today, secrets.token_bytes(32), set()
            day = today.isoformat()
            digest = hashlib.sha256(self._salt + client.encode("utf-8", "replace")).digest()[:16]
            if digest not in self._seen and len(self._seen) < MAX_SEEN:
                self._seen.add(digest)
                self._bump(day, "visitors", "")
            self._bump(day, "pageview", page)
            if monument_id:
                self._bump(day, "monument_view", monument_id)

    def summary(self, days: int = 30) -> dict:
        today = self._today()
        start = (today - timedelta(days=days - 1)).isoformat()
        with self._lock:
            rows = self._db.execute("SELECT day, metric, key, count FROM stats_daily WHERE day >= ?", (start,)).fetchall()
        per_day = {(today - timedelta(days=i)).isoformat(): {"visitors": 0, "pageviews": 0} for i in range(days)}
        pages: dict[str, int] = {}
        monuments: dict[str, int] = {}
        for day, metric, key, count in rows:
            if metric == "visitors":
                per_day[day]["visitors"] += count
            elif metric == "pageview":
                per_day[day]["pageviews"] += count
                pages[key] = pages.get(key, 0) + count
            else:
                monuments[key] = monuments.get(key, 0) + count
        series = [{"day": d, **v} for d, v in sorted(per_day.items())]
        return {
            "days": series,
            "totals": {"visitors": sum(d["visitors"] for d in series), "pageviews": sum(d["pageviews"] for d in series),
                       "monument_views": sum(monuments.values())},
            "pages": sorted(({"page": k, "views": v} for k, v in pages.items()), key=lambda x: (-x["views"], x["page"])),
            "monuments": sorted(({"monument_id": k, "views": v} for k, v in monuments.items()),
                                key=lambda x: (-x["views"], x["monument_id"])),
        }
