"""Gerçek eserlerde ziyaretçi ilerlemesi: oyun kademeleri ve iki ayrı mühür türü (kalıcı SQLite).

- **Kademe 1 (`engagement`)**: anlatımı sonuna kadar dinleme (`listened`) ve rehbere soru sorma (`asked`) olayları.
  Olay bir kez kaydedilir (birincil anahtar); soru metni saklanmaz.
- **Bilgi mührü (`knowledge`)**: "Rozeti Al" sınavında (`quizzes`, bkz. `game.py`) 5 sorudan en az 4'ü doğru
  cevaplanınca ya da eski akışta eserin bütün keşif soruları doğru cevaplanınca verilir. Uzaktan kazanılabilir; fiziksel
  ziyaret iddia etmez. Sınavın doğru cevapları yalnızca bu depoda, sunucuda durur.
- **Ziyaret mührü (`visit`)**: bilgi mühründen sonra, eserin onaylı konumunun yarıçapı içinde yapılan ziyaretle verilir.
  Sunum modunda (simülasyon) mesafe denetlenmeden verilen mühür `simulated = 1` ile saklanır ve her yerde simülasyon
  olarak gösterilir; gerçek ziyaret simülasyon mührünü gerçeğe çevirir. Ziyaretçinin konumu (koordinat) hiçbir tabloda
  saklanmaz.

Aynı mühür ikinci kez verilmez (birincil anahtar). Doğru cevap bir kez kaydedilir; yanlış denemeler yalnızca sayılır.
Rotada açılan eserler (`unlocks`, bkz. `route_engine.py`) kalıcıdır; bir kez açılan eser yeniden kilitlenmez.
Kullanıcı kimliği tarayıcıda üretilen takma bir misafir kimliği (`ziyaretci-…`) ya da hesap kimliğidir (`u-…`, bkz.
`accounts.py`); bu depoda kişisel veri tutulmaz. Misafir ilerlemesi girişte hesaba taşınır (`merge_user`), hesap
silinince ilerlemesi de silinir (`delete_user`).
"""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Literal, Optional, TypeVar

from .models import Stamp

SealKind = Literal["knowledge", "visit"]
EngagementEvent = Literal["listened", "asked"]

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
    simulated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, monument_id, kind)
);
CREATE TABLE IF NOT EXISTS unlocks (
    user_id TEXT NOT NULL,
    monument_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, monument_id)
);
CREATE TABLE IF NOT EXISTS engagement (
    user_id TEXT NOT NULL,
    monument_id TEXT NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('listened', 'asked')),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, monument_id, event)
);
CREATE TABLE IF NOT EXISTS quizzes (
    quiz_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    monument_id TEXT NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    submitted_at TEXT,
    score INTEGER
);
CREATE INDEX IF NOT EXISTS quizzes_by_user ON quizzes (user_id, monument_id);
"""

T = TypeVar("T")


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
        # Faz 5 öncesi dosyalarda bu sütun yoktur; eski mühürler gerçek (simülasyon olmayan) mühürdür.
        if "simulated" not in {r["name"] for r in self._db.execute("PRAGMA table_info(seals)")}:
            self._db.execute("ALTER TABLE seals ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0")
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

    def add_seal(self, user_id: str, monument_id: str, monument_name: str, kind: SealKind,
                 simulated: bool = False) -> tuple[dict, bool]:
        """Mührü verir; ikinci dönüş değeri mühür bu çağrıda verildiyse True. Yalnızca ziyaret mührü simülasyon olabilir.

        Var olan mühür değişmez; tek istisna: simülasyon ziyaret mührü varken gerçek ziyaret gelirse mühür gerçeğe
        çevrilir (kazanılma zamanı da gerçek ziyaretinki olur) ve bu çağrı yeni mühür sayılır.
        """
        simulated = bool(simulated) and kind == "visit"
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO seals (user_id, monument_id, kind, monument_name, earned_at, simulated) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT (user_id, monument_id, kind) DO UPDATE SET simulated = 0, "
                "earned_at = excluded.earned_at WHERE seals.simulated = 1 AND excluded.simulated = 0",
                (user_id, monument_id, kind, monument_name, _now(), int(simulated)))
            row = self._db.execute("SELECT * FROM seals WHERE user_id=? AND monument_id=? AND kind=?",
                                   (user_id, monument_id, kind)).fetchone()
            return dict(row), cur.rowcount == 1

    def seal(self, user_id: str, monument_id: str, kind: SealKind) -> Optional[dict]:
        with self._lock:
            row = self._db.execute("SELECT * FROM seals WHERE user_id=? AND monument_id=? AND kind=?",
                                   (user_id, monument_id, kind)).fetchone()
            return dict(row) if row else None

    def seals(self, user_id: str) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._db.execute(
                "SELECT * FROM seals WHERE user_id=? ORDER BY earned_at, monument_id", (user_id,)).fetchall()]

    # --- Rota kilitleri -------------------------------------------------------------

    def _completions(self, user_id: str) -> list[dict]:
        # Zaman damgası saniye çözünürlüklü; aynı saniyedeki mühürlerde ekleme sırası (rowid) belirler.
        return [{**dict(r), "visit": bool(r["visit"])} for r in self._db.execute(
            "SELECT k.monument_id, k.monument_name, k.earned_at, EXISTS (SELECT 1 FROM seals v WHERE v.user_id = k.user_id "
            "AND v.monument_id = k.monument_id AND v.kind = 'visit') AS visit FROM seals k "
            "WHERE k.user_id=? AND k.kind='knowledge' ORDER BY k.earned_at DESC, k.rowid DESC", (user_id,)).fetchall()]

    def _unlocked(self, user_id: str) -> set[str]:
        return {r["monument_id"] for r in self._db.execute("SELECT monument_id FROM unlocks WHERE user_id=?", (user_id,))}

    def completions(self, user_id: str) -> list[dict]:
        """Tamamlanan eserler (bilgi mühürleri), en son kazanılan önce; `visit`: ziyaret mührü de var mı."""
        with self._lock:
            return self._completions(user_id)

    def unlocked(self, user_id: str) -> set[str]:
        with self._lock:
            return self._unlocked(user_id)

    def plan_unlocks(self, user_id: str,
                     planner: Callable[[list[dict], set[str]], tuple[T, Iterable[str]]]) -> T:
        """Tamamlananları ve açılmış eserleri tek yazma işleminde okur, `planner(tamamlananlar, açılmışlar)` ile yeni
        açılacakları seçtirir ve kalıcı yazar; `planner`'ın ilk dönüş değerini verir.

        Aynı kullanıcının eş zamanlı istekleri sınırı iki kez dolduramaz (işlem ve kilit). `planner` bu depoyu çağırmamalıdır.
        """
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                result, new_ids = planner(self._completions(user_id), self._unlocked(user_id))
                now = _now()
                self._db.executemany("INSERT OR IGNORE INTO unlocks (user_id, monument_id, unlocked_at) VALUES (?,?,?)",
                                     [(user_id, m, now) for m in new_ids])
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            return result

    # --- Kademe 1: dinle ve konuş ------------------------------------------------------

    def record_engagement(self, user_id: str, monument_id: str, event: EngagementEvent) -> bool:
        """Olayı bir kez kaydeder (aynı olay ikinci kez gelirse durum değişmez); yeni kayıtsa True."""
        with self._lock:
            cur = self._db.execute("INSERT OR IGNORE INTO engagement (user_id, monument_id, event, recorded_at) "
                                   "VALUES (?,?,?,?)", (user_id, monument_id, event, _now()))
            return cur.rowcount == 1

    def engagement(self, user_id: str, monument_id: str) -> set[str]:
        with self._lock:
            return {r["event"] for r in self._db.execute(
                "SELECT event FROM engagement WHERE user_id=? AND monument_id=?", (user_id, monument_id))}

    # --- Kademe 2: sınavlar -----------------------------------------------------------

    def start_quiz(self, quiz_id: str, user_id: str, monument_id: str, created_at: str, expires_at: str,
                   compose: Callable[[list[dict]], list[dict]]) -> list[dict]:
        """Yeni sınavı tek işlemde yazar: `compose(önceki sınavın soruları)` soruları üretir (yeniden denemede farklı
        seçim için). Kullanıcının bu eserdeki önceki sınavları silinir; eser başına en fazla bir sınav tutulur."""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                row = self._db.execute("SELECT items FROM quizzes WHERE user_id=? AND monument_id=? "
                                       "ORDER BY created_at DESC, rowid DESC LIMIT 1", (user_id, monument_id)).fetchone()
                items = compose(json.loads(row["items"]) if row else [])
                self._db.execute("DELETE FROM quizzes WHERE user_id=? AND monument_id=?", (user_id, monument_id))
                self._db.execute("INSERT INTO quizzes (quiz_id, user_id, monument_id, items, created_at, expires_at) "
                                 "VALUES (?,?,?,?,?,?)", (quiz_id, user_id, monument_id,
                                                          json.dumps(items, ensure_ascii=False), created_at, expires_at))
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            return items

    def quiz(self, quiz_id: str) -> Optional[dict]:
        with self._lock:
            row = self._db.execute("SELECT * FROM quizzes WHERE quiz_id=?", (quiz_id,)).fetchone()
        if row is None:
            return None
        return {**dict(row), "items": json.loads(row["items"])}

    def close_quiz(self, quiz_id: str, submitted_at: str, score: int) -> bool:
        """Sınavı gönderilmiş olarak işaretler. Yalnızca ilk gönderim True alır (eş zamanlı ikinci gönderim False)."""
        with self._lock:
            cur = self._db.execute("UPDATE quizzes SET submitted_at=?, score=? WHERE quiz_id=? AND submitted_at IS NULL",
                                   (submitted_at, score, quiz_id))
            return cur.rowcount == 1

    # --- Hesaplar -------------------------------------------------------------------

    def _transaction(self, statements: list[tuple[str, tuple]]) -> list[int]:
        # Çağıran kilidi tutar. Bağlantı otomatik onay kipindedir; işlem açıkça açılıp kapatılır.
        self._db.execute("BEGIN IMMEDIATE")
        try:
            counts = [self._db.execute(sql, args).rowcount for sql, args in statements]
            self._db.execute("COMMIT")
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        return counts

    def merge_user(self, from_id: str, to_id: str) -> dict:
        """Misafir ilerlemesini (`from_id`) hesaba (`to_id`) tek işlemde taşır ve misafir satırlarını siler.

        Hiçbir kayıt ikilenmez. Hesapta aynı mühür varsa hesabınki kalır; tek istisna, hesaptaki simülasyon ziyaret
        mührü misafirin gerçek ziyaret mührüyle gerçeğe çevrilir. Hesapta aynı soru varsa satır hesabınkidir;
        yalnızca hesabın henüz doğru cevaplamadığı soru misafirde doğru cevaplanmışsa o cevap zamanı alınır (aksi halde
        misafirken kazanılan bilgi mührü taşınır ama sorusu çözülmemiş görünürdü) ve deneme sayıları toplanır. Rotada
        açılmış eserler birleşir (hiçbiri yeniden kilitlenmez); hesapta da açıksa hesabın açılış zamanı kalır. Kademe 1
        olayları birleşir; misafirin açık sınavları hesaba geçer (girişten sonra hesap kimliğiyle gönderilebilir).
        """
        if from_id == to_id:
            return {"answers": 0, "seals": 0, "unlocks": 0}
        with self._lock:
            answers, seals, unlocks, *_ = self._transaction([
                ("INSERT INTO quest_answers (user_id, monument_id, quest_id, attempts, correct_at) "
                 "SELECT ?, monument_id, quest_id, attempts, correct_at FROM quest_answers WHERE user_id=? "
                 "ON CONFLICT (user_id, quest_id) DO UPDATE SET attempts = attempts + excluded.attempts, "
                 "correct_at = COALESCE(correct_at, excluded.correct_at)", (to_id, from_id)),
                # Misafirin mühürleri kazanılma sırasıyla eklenir: aynı saniyedeki mühürlerin sırası (rowid) korunur.
                ("INSERT INTO seals (user_id, monument_id, kind, monument_name, earned_at, simulated) "
                 "SELECT ?, monument_id, kind, monument_name, earned_at, simulated FROM seals WHERE user_id=? "
                 "ORDER BY rowid ON CONFLICT (user_id, monument_id, kind) DO UPDATE SET simulated = 0, "
                 "earned_at = excluded.earned_at WHERE seals.simulated = 1 AND excluded.simulated = 0",
                 (to_id, from_id)),
                ("INSERT OR IGNORE INTO unlocks (user_id, monument_id, unlocked_at) "
                 "SELECT ?, monument_id, unlocked_at FROM unlocks WHERE user_id=?", (to_id, from_id)),
                ("INSERT OR IGNORE INTO engagement (user_id, monument_id, event, recorded_at) "
                 "SELECT ?, monument_id, event, recorded_at FROM engagement WHERE user_id=?", (to_id, from_id)),
                ("UPDATE quizzes SET user_id=? WHERE user_id=?", (to_id, from_id)),
                ("DELETE FROM quest_answers WHERE user_id=?", (from_id,)),
                ("DELETE FROM seals WHERE user_id=?", (from_id,)),
                ("DELETE FROM unlocks WHERE user_id=?", (from_id,)),
                ("DELETE FROM engagement WHERE user_id=?", (from_id,)),
            ])
        return {"answers": answers, "seals": seals, "unlocks": unlocks}

    def delete_user(self, user_id: str) -> None:
        """Kullanıcının bütün soru cevaplarını, mühürlerini, rota kilitlerini, kademe olaylarını ve sınavlarını siler
        (hesap silme, KVKK)."""
        with self._lock:
            self._transaction([(f"DELETE FROM {table} WHERE user_id=?", (user_id,))
                               for table in ("quest_answers", "seals", "unlocks", "engagement", "quizzes")])

    # --- `services.check_in` arayüzü (yalnızca ziyaret mührü) ---------------------------

    def add_stamp(self, user_id: str, place) -> tuple[Stamp, bool]:
        seal, created = self.add_seal(user_id, place.id, place.name, "visit")
        return Stamp(place_id=seal["monument_id"], place_name=seal["monument_name"],
                     earned_at=datetime.fromisoformat(seal["earned_at"])), created

    def get_stamps(self, user_id: str) -> list[Stamp]:
        return [Stamp(place_id=s["monument_id"], place_name=s["monument_name"], earned_at=datetime.fromisoformat(s["earned_at"]))
                for s in self.seals(user_id) if s["kind"] == "visit"]
