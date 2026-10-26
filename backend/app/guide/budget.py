"""Günlük çağrı ve token bütçesi ile devre kesici.

- Sayaçlar UTC gününe göre SQLite'ta (yoksa bellekte) tutulur; soru metni, görsel veya istemci adresi saklanmaz,
  yalnızca gün, çağrı sayısı ve token toplamları.
- Çağrıdan önce `reserve(tahmin)` bütçeyi ayırır; yetersizse çağrı yapılmaz. Çağrıdan sonra `settle` gerçek kullanımı
  yazar (ayrılan tahmin geri alınır).
- Dakika sınırı: son 60 saniyedeki çağrı sayısı `max_per_minute`'u aşamaz (sağlayıcının dakika sınırının altında tutulur).
  Çağrı zamanları da aynı veritabanında tutulur; yeniden başlatma dakika sınırını sıfırlamaz.
- Sağlayıcı performansı: günlük toplam/en uzun sağlayıcı süresi ve zaman aşımı sayısı (yalnızca sayılar).
- Devre kesici: art arda `threshold` sağlayıcı hatasından sonra `cooldown_s` boyunca çağrı yapılmaz (yedek arama devreye
  girer). 429 (hız sınırı) devreyi hemen `Retry-After` kadar açar; günlük kota bitince devre UTC günü sıfırlanana dek
  açık kalır. Kimlik, ücret ve yapılandırma hataları devreyi uzun süre açar. Hiçbir hata otomatik yeniden deneme yapmaz.
"""

import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _seconds_to_utc_midnight() -> float:
    now = datetime.now(timezone.utc)
    return (datetime(now.year, now.month, now.day, tzinfo=timezone.utc) + timedelta(days=1) - now).total_seconds()


class DailyBudget:
    def __init__(self, path: Optional[Path], max_calls: int, max_tokens: int, today: Callable[[], str] = _today,
                 max_per_minute: Optional[int] = None, clock: Callable[[], float] = time.time):
        self.max_calls, self.max_tokens, self._today = max_calls, max_tokens, today
        self.max_per_minute, self._clock = max_per_minute, clock
        self.path = Path(path) if path is not None else None
        self.denied: Optional[str] = None  # son reddin nedeni: daily_calls | daily_tokens | per_minute
        self._lock = threading.Lock()
        if path is not None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path) if path else ":memory:", check_same_thread=False)
        self._db.execute("CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL, "
                         "prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL, failures INTEGER NOT NULL)")
        self._db.execute("CREATE TABLE IF NOT EXISTS recent_calls (ts REAL NOT NULL)")
        cols = {r[1] for r in self._db.execute("PRAGMA table_info(usage)")}
        for col in ("latency_ms_total", "latency_max_ms", "timeouts"):
            if col not in cols:  # önceki sürümün dosyası: sayaçlar korunur, yeni sütunlar eklenir
                self._db.execute(f"ALTER TABLE usage ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0")
        self._db.commit()
        self._reserved_tokens = 0
        self._reserved_calls = 0

    def _row(self, day: str) -> tuple[int, int, int, int]:
        r = self._db.execute("SELECT calls, prompt_tokens, completion_tokens, failures FROM usage WHERE day=?", (day,)).fetchone()
        return r or (0, 0, 0, 0)

    def _perf(self, day: str) -> tuple[int, int, int]:
        r = self._db.execute("SELECT latency_ms_total, latency_max_ms, timeouts FROM usage WHERE day=?", (day,)).fetchone()
        return r or (0, 0, 0)

    def _minute_count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM recent_calls WHERE ts > ?", (self._clock() - 60.0,)).fetchone()[0]

    def reserve(self, est_tokens: int) -> bool:
        with self._lock:
            calls, p, c, _ = self._row(self._today())
            self.denied = None
            if calls + self._reserved_calls + 1 > self.max_calls:
                self.denied = "daily_calls"
            elif p + c + self._reserved_tokens + est_tokens > self.max_tokens:
                self.denied = "daily_tokens"
            elif self.max_per_minute is not None and self._minute_count() >= self.max_per_minute:
                self.denied = "per_minute"
            if self.denied:
                return False
            now = self._clock()
            self._db.execute("DELETE FROM recent_calls WHERE ts <= ?", (now - 60.0,))
            self._db.execute("INSERT INTO recent_calls(ts) VALUES (?)", (now,))
            self._db.commit()
            self._reserved_calls += 1
            self._reserved_tokens += est_tokens
            return True

    def settle(self, est_tokens: int, prompt_tokens: int, completion_tokens: int, failed: bool = False,
               latency_ms: int = 0, timed_out: bool = False):
        """Ayrılan tahmini bırakır ve gerçek kullanımı yazar. Başarısız çağrı da çağrı sayılır (sağlayıcı ücretlendirebilir)."""
        with self._lock:
            self._reserved_calls = max(0, self._reserved_calls - 1)
            self._reserved_tokens = max(0, self._reserved_tokens - est_tokens)
            day = self._today()
            self._db.execute(
                "INSERT INTO usage(day, calls, prompt_tokens, completion_tokens, failures, latency_ms_total, latency_max_ms, "
                "timeouts) VALUES (?, 1, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(day) DO UPDATE SET calls=calls+1, prompt_tokens=prompt_tokens+excluded.prompt_tokens, "
                "completion_tokens=completion_tokens+excluded.completion_tokens, failures=failures+excluded.failures, "
                "latency_ms_total=latency_ms_total+excluded.latency_ms_total, "
                "latency_max_ms=MAX(latency_max_ms, excluded.latency_max_ms), timeouts=timeouts+excluded.timeouts",
                (day, prompt_tokens, completion_tokens, int(failed), latency_ms, latency_ms, int(timed_out)))
            self._db.commit()

    def status(self) -> dict:
        with self._lock:
            calls, p, c, failures = self._row(self._today())
            lat_total, lat_max, timeouts = self._perf(self._today())
            minute = self._minute_count()
        return {"last_minute_calls": minute, "max_per_minute": self.max_per_minute, "day": self._today(), "calls": calls, "max_calls": self.max_calls, "tokens": p + c,
                "prompt_tokens": p, "completion_tokens": c, "max_tokens": self.max_tokens, "failures": failures,
                "remaining_calls": max(0, self.max_calls - calls), "remaining_tokens": max(0, self.max_tokens - p - c),
                "avg_latency_ms": lat_total // calls if calls else 0, "max_latency_ms": lat_max, "timeouts": timeouts}


class CircuitBreaker:
    def __init__(self, threshold: int = 3, cooldown_s: float = 60.0, long_cooldown_s: float = 900.0,
                 clock: Callable[[], float] = time.monotonic, until_reset: Callable[[], float] = _seconds_to_utc_midnight):
        self.threshold, self.cooldown_s, self.long_cooldown_s, self.clock = threshold, cooldown_s, long_cooldown_s, clock
        self.until_reset = until_reset
        self._failures = 0
        self._open_until = 0.0
        self.last_error: Optional[str] = None
        self._lock = threading.Lock()

    def allow(self) -> bool:
        with self._lock:
            return self.clock() >= self._open_until

    def success(self):
        with self._lock:
            self._failures, self.last_error = 0, None

    def failure(self, kind: str, retry_after: Optional[int] = None):
        with self._lock:
            self.last_error = kind
            now = self.clock()
            if kind == "quota":
                self._open_until = now + max(self.long_cooldown_s, self.until_reset())
                return
            if kind in ("no_key", "auth", "insecure_permissions", "invalid", "paid_model_blocked", "paid_usage_detected",
                        "model_mismatch"):
                self._open_until = now + self.long_cooldown_s
                return
            if kind == "rate_limited":
                self._open_until = now + (retry_after if retry_after else self.cooldown_s)
                self._failures = 0
                return
            self._failures += 1
            if self._failures >= self.threshold:
                self._open_until = self.clock() + self.cooldown_s
                self._failures = 0

    def state(self) -> dict:
        with self._lock:
            remaining = max(0.0, self._open_until - self.clock())
            return {"open": remaining > 0, "retry_in_s": int(remaining), "last_error": self.last_error}
