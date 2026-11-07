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

**Oyuncu profili (`player_profiles`, R6.3)**: hesabın seçtiği karakter (yalnızca görünüş; oyunda avantaj sağlamaz).
Yalnızca hesap kimliğiyle yazılır (misafir karakter seçemez); seçim yapılmadan satır yoktur ve varsayılan karakter
atanmaz. Mühür, vakfiye ve rota tablolarından ayrıdır: tablo eklenirken mevcut ilerleme değişmez.

**XP (`xp_events`, R6.4)**: her satır bir kazanımdır ve nedenini taşır (kaynak, eser, zaman, `origin`). XP yalnızca bu
depodaki doğrulanmış kayıtlardan türetilir (dinleme/soru olayı, bilgi mührü, gerçek ziyaret mührü; bkz. `xp.py`);
istemci XP yazamaz. Birincil anahtar (kullanıcı, kaynak, kapsam) aynı ödülün ikinci kez verilmesini engeller. Olay
anında `live`, eski kayıtlardan geriye dönük türetilen satırlar `backfill` olarak işaretlenir (eski oyuncular sıfıra
düşmez; türetme kuralı aynıdır). Mühür ve vakfiye tabloları XP'den ayrıdır ve XP onları değiştirmez.
"""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Literal, Optional, TypeVar

from .models import Stamp
from .xp import XP_RULES

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
-- 7 Kasım: sorular tek tek cevaplanır. Her soru ekrana geldiğinde açılır (`opened_at`, süre buradan sayılır); cevap bir
-- kez yazılır ve değişmez. `choice` NULL = süre doldu / cevap yok (yanlış sayılır).
CREATE TABLE IF NOT EXISTS quiz_steps (
    quiz_id TEXT NOT NULL,
    qid TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    choice INTEGER,
    answered_at TEXT,
    PRIMARY KEY (quiz_id, qid)
);
CREATE TABLE IF NOT EXISTS xp_events (
    user_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('first_discovery', 'listened', 'listen_and_ask', 'knowledge', 'visit')),
    scope TEXT NOT NULL,
    monument_id TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    earned_at TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('live', 'backfill')),
    PRIMARY KEY (user_id, source, scope)
);
CREATE TABLE IF NOT EXISTS player_profiles (
    user_id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    chosen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

T = TypeVar("T")

# XP türetme (bkz. xp.py). Her ifade yalnızca doğrulanmış kayıtlardan okur; INSERT OR IGNORE ve birincil anahtar
# sayesinde kaç kez çalışırsa çalışsın aynı ödül bir kez verilir. Parametreler: ?1 = origin, ?2 = user_id.
_XP_SYNC = [
    "INSERT OR IGNORE INTO xp_events (user_id, source, scope, monument_id, amount, earned_at, origin) "
    f"SELECT user_id, 'listened', monument_id, monument_id, {XP_RULES['listened']}, recorded_at, ?1 "
    "FROM engagement WHERE user_id=?2 AND event='listened'",
    # R6.7: `listen_and_ask` artık "rehbere soru sordu" ödülüdür (isteğe bağlı; sınavın şartı değil): eserde kaydedilmiş
    # bir `asked` olayı, eser başına bir kez. R6.4 kuralıyla (dinledi ve sordu / dinledi ve sınavı geçti) daha önce verilmiş
    # satırlar olduğu gibi kalır; aynı anahtar ikinci kez verilmez.
    "INSERT OR IGNORE INTO xp_events (user_id, source, scope, monument_id, amount, earned_at, origin) "
    f"SELECT user_id, 'listen_and_ask', monument_id, monument_id, {XP_RULES['listen_and_ask']}, recorded_at, ?1 "
    "FROM engagement WHERE user_id=?2 AND event='asked'",
    "INSERT OR IGNORE INTO xp_events (user_id, source, scope, monument_id, amount, earned_at, origin) "
    f"SELECT user_id, 'knowledge', monument_id, monument_id, {XP_RULES['knowledge']}, earned_at, ?1 "
    "FROM seals WHERE user_id=?2 AND kind='knowledge'",
    # Yalnızca gerçek ziyaret: simülasyon (sunum modu) ziyaret mührü XP vermez; gerçeğe çevrilince verilir.
    "INSERT OR IGNORE INTO xp_events (user_id, source, scope, monument_id, amount, earned_at, origin) "
    f"SELECT user_id, 'visit', monument_id, monument_id, {XP_RULES['visit']}, earned_at, ?1 "
    "FROM seals WHERE user_id=?2 AND kind='visit' AND simulated=0",
    # Hesap başına bir kez: ilk dinleme ya da (eski oyuncularda) ilk mühür.
    "INSERT OR IGNORE INTO xp_events (user_id, source, scope, monument_id, amount, earned_at, origin) "
    f"SELECT ?2, 'first_discovery', 'hesap', monument_id, {XP_RULES['first_discovery']}, t, ?1 FROM ("
    "SELECT monument_id, recorded_at AS t FROM engagement WHERE user_id=?2 AND event='listened' "
    "UNION ALL SELECT monument_id, earned_at AS t FROM seals WHERE user_id=?2) ORDER BY t, monument_id LIMIT 1",
]


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
            if cur.rowcount == 1:
                self._sync_xp_locked(user_id, "live")
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
            if cur.rowcount == 1:
                self._sync_xp_locked(user_id, "live")
            return cur.rowcount == 1

    def started(self, user_id: str) -> set[str]:
        """R6.7 "göreve başlandı": anlatım dinlendi, rehbere soruldu ya da bilgi görevi (sınav) açıldı."""
        with self._lock:
            return {r[0] for r in self._db.execute(
                "SELECT monument_id FROM engagement WHERE user_id=? UNION SELECT monument_id FROM quizzes WHERE user_id=?",
                (user_id, user_id)).fetchall()}

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
                self._db.execute("DELETE FROM quiz_steps WHERE quiz_id IN (SELECT quiz_id FROM quizzes WHERE user_id=? "
                                 "AND monument_id=?)", (user_id, monument_id))
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

    def quiz_steps(self, quiz_id: str) -> dict[str, dict]:
        """Sorunun açılış ve cevap kayıtları (soru kimliği → kayıt)."""
        with self._lock:
            rows = self._db.execute("SELECT * FROM quiz_steps WHERE quiz_id=?", (quiz_id,)).fetchall()
        return {r["qid"]: dict(r) for r in rows}

    def open_step(self, quiz_id: str, qid: str, opened_at: str) -> dict:
        """Soruyu açar (ilk açılış kalır: yeniden açmak süreyi sıfırlamaz) ve kaydı döndürür."""
        with self._lock:
            self._db.execute("INSERT OR IGNORE INTO quiz_steps (quiz_id, qid, opened_at) VALUES (?,?,?)",
                             (quiz_id, qid, opened_at))
            return dict(self._db.execute("SELECT * FROM quiz_steps WHERE quiz_id=? AND qid=?", (quiz_id, qid)).fetchone())

    def answer_step(self, quiz_id: str, qid: str, choice: Optional[int], answered_at: str) -> bool:
        """Cevabı bir kez yazar. Yalnızca ilk cevap True alır (eş zamanlı ikinci cevap False)."""
        with self._lock:
            cur = self._db.execute("UPDATE quiz_steps SET choice=?, answered_at=? WHERE quiz_id=? AND qid=? "
                                   "AND answered_at IS NULL", (choice, answered_at, quiz_id, qid))
            return cur.rowcount == 1

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
                # Misafirin XP satırları taşınmaz: hesap XP'si taşınan doğrulanmış kayıtlardan yeniden türetilir.
                ("DELETE FROM xp_events WHERE user_id=?", (from_id,)),
            ])
            self._sync_xp_locked(to_id, "backfill")
        return {"answers": answers, "seals": seals, "unlocks": unlocks}

    def funnel(self) -> dict:
        """Yönetim istatistiği (tüm zamanlar): oyun kademelerine ulaşan (kişi, eser) çifti sayıları ve tekil oyuncu
        sayısı. Kimlik veya eser bazında kişi bilgisi döndürmez."""
        with self._lock:
            one = lambda sql: self._db.execute(sql).fetchone()[0]  # noqa: E731
            return {
                "players": one("SELECT COUNT(DISTINCT user_id) FROM engagement"),
                "listened": one("SELECT COUNT(*) FROM engagement WHERE event = 'listened'"),
                "asked": one("SELECT COUNT(*) FROM engagement WHERE event = 'asked'"),
                "knowledge": one("SELECT COUNT(*) FROM seals WHERE kind = 'knowledge'"),
                "visit": one("SELECT COUNT(*) FROM seals WHERE kind = 'visit' AND simulated = 0"),
                "visit_simulated": one("SELECT COUNT(*) FROM seals WHERE kind = 'visit' AND simulated = 1"),
            }

    def delete_user(self, user_id: str) -> None:
        """Kullanıcının bütün soru cevaplarını, mühürlerini, rota kilitlerini, kademe olaylarını, sınavlarını ve oyuncu
        profilini siler (hesap silme, KVKK)."""
        with self._lock:
            self._transaction([(f"DELETE FROM {table} WHERE user_id=?", (user_id,))
                               for table in ("quest_answers", "seals", "unlocks", "engagement", "quizzes",
                                             "player_profiles", "xp_events")])

    # --- XP (R6.4) --------------------------------------------------------------------

    def _sync_xp_locked(self, user_id: str, origin: str) -> int:
        # Çağıran kilidi tutar. Tek işlem: ya hepsi ya hiçbiri.
        return sum(self._transaction([(sql, (origin, user_id)) for sql in _XP_SYNC]))

    def sync_xp(self, user_id: str, origin: str = "backfill") -> int:
        """Doğrulanmış kayıtlardan eksik XP satırlarını türetir (eski oyuncular için geriye dönük); eklenen satır sayısı.
        Var olan satır değişmez; aynı kayıt ikinci kez ödül vermez."""
        with self._lock:
            return self._sync_xp_locked(user_id, origin)

    def award_xp(self, user_id: str, source: str, monument_id: str) -> bool:
        """Olay anında verilen ödül (yalnızca sunucudaki doğrulanmış koşuldan sonra çağrılır; ör. rehber şartı yokken
        dinlemeyle tamamlanan I. kademe). Miktar kural tablosundan gelir; ikinci çağrı etkisizdir."""
        amount = XP_RULES[source]
        scope = "hesap" if source == "first_discovery" else monument_id
        with self._lock:
            cur = self._db.execute(
                "INSERT OR IGNORE INTO xp_events (user_id, source, scope, monument_id, amount, earned_at, origin) "
                "VALUES (?,?,?,?,?,?, 'live')", (user_id, source, scope, monument_id, amount, _now()))
            return cur.rowcount == 1

    def xp_total(self, user_id: str) -> int:
        with self._lock:
            return int(self._db.execute("SELECT COALESCE(SUM(amount), 0) FROM xp_events WHERE user_id=?",
                                        (user_id,)).fetchone()[0])

    def xp_events(self, user_id: str, limit: int = 100) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._db.execute(
                "SELECT source, monument_id, amount, earned_at, origin FROM xp_events WHERE user_id=? "
                "ORDER BY earned_at DESC, rowid DESC LIMIT ?", (user_id, limit)).fetchall()]

    # --- Oyuncu profili (R6.3) ---------------------------------------------------------

    def profile(self, user_id: str) -> Optional[dict]:
        """Seçilmiş karakter; seçim yapılmadıysa None (varsayılan karakter yoktur)."""
        with self._lock:
            row = self._db.execute("SELECT character_id, chosen_at, updated_at FROM player_profiles WHERE user_id=?",
                                   (user_id,)).fetchone()
        return dict(row) if row else None

    def set_character(self, user_id: str, character_id: str) -> dict:
        """Karakteri kaydeder ya da değiştirir (yalnızca görünüş). İlk seçim zamanı (`chosen_at`) korunur."""
        now = _now()
        with self._lock:
            self._db.execute(
                "INSERT INTO player_profiles (user_id, character_id, chosen_at, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT (user_id) DO UPDATE SET character_id = excluded.character_id, updated_at = excluded.updated_at",
                (user_id, character_id, now, now))
            row = self._db.execute("SELECT character_id, chosen_at, updated_at FROM player_profiles WHERE user_id=?",
                                   (user_id,)).fetchone()
        return dict(row)

    # --- `services.check_in` arayüzü (yalnızca ziyaret mührü) ---------------------------

    def add_stamp(self, user_id: str, place) -> tuple[Stamp, bool]:
        seal, created = self.add_seal(user_id, place.id, place.name, "visit")
        return Stamp(place_id=seal["monument_id"], place_name=seal["monument_name"],
                     earned_at=datetime.fromisoformat(seal["earned_at"])), created

    def get_stamps(self, user_id: str) -> list[Stamp]:
        return [Stamp(place_id=s["monument_id"], place_name=s["monument_name"], earned_at=datetime.fromisoformat(s["earned_at"]))
                for s in self.seals(user_id) if s["kind"] == "visit"]
