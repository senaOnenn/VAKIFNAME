"""Gerçek oyun döngüsünün saf kuralları (HTTP'den bağımsız): "Rozeti Al" sınavının soruları, puanlama, ziyaret ayarları.

Kurallar (ekip kararı, CLAUDE.md §2.6 ve §4):
- Sınav 5 sorudur; en az 4 doğru (%80) bilgi mührü verir. Doğru cevaplar yalnızca sunucuda saklanır; istemciye giden
  soru görünümü (`public_question`) beyaz listeyle kurulur ve cevap, anahtar ya da sahiplik bilgisi taşımaz.
- Sorular yalnızca yayın ve oyun onaylı (`game_use`) kayıtlardan kurulur; hiçbir cümle uydurulmaz:
  - `choice`: katalogdaki onaylı çoktan seçmeli keşif sorusu (şıklar karıştırılır, doğru şık yeniden eşlenir).
  - `image_pick`: "Hangisi {eser}?" Eserin oyun onaylı bir görseli ve başka iki eserin oyun onaylı birer görseli.
    Şıklarda yalnızca dosya adı (içerik özeti) ve atıf satırı vardır; atfında eser adı geçen görsel kullanılmaz. Aynı
    yapı topluluğundaki (`SAME_SITE_M` içindeki) eserlerin görselleri, fotoğrafta hedef eser de görünebileceği için
    yeterli seçenek varsa çeldirici yapılmaz.
  - `true_false`: onaylı bir bilginin metni gösterilir ve "Bu bilgi {eser} ile mi ilgili?" diye sorulur; bilgi bu
    esere aitse doğru, başka eserden alındıysa yanlıştır. Yalnızca belgelenmiş (`documented`) ve metninde hiçbir eserin
    adı (alternatif adı ya da ayırt edici adı, ör. "Koza", "II. Murad") geçmeyen bilgiler kullanılır. "Yanlış" için
    alınan bilgi: başka türde bir eserden gelir (iki türbe hakkındaki genel bir cümle ikisi için de doğru olabilir),
    katalogda birden fazla eserde aynen geçmez ve hedef eserin hiçbir kaydıyla belirgin içerik örtüşmesi taşımaz
    (ör. iki yapıda da "altıgen firuze çini" geçiyorsa kullanılmaz). Böylece "yanlış" cevabı yanıltıcı olmaz.
- Varsayılan karışım 3 `choice` + 1 `image_pick` + 1 `true_false`; veri azsa eksik sorular `image_pick`, `true_false`,
  `choice` sırasıyla dönüşümlü tamamlanır. Bir bilgi aynı sınavda hem soru hem ifade olmaz (cevabı vermesin).
  Doğru/yanlış sorusunun yönü (bu esere ait / başka eserden) mümkünse yazı-turayla seçilir. Yeniden denemede önceki
  sınavda kullanılmamış kayıt ve görseller önceliklidir (veri elverdiği ölçüde farklı seçim). Rastgelelik dışarıdan
  verilir (`rng`); testler belirlenimci çalışır.
"""

import os
import random
import re
import unicodedata
from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable, Optional, Sequence

from .geo import haversine_m
from .public_catalog import PublicCatalog, PublicFact, PublicImage, PublicMonument, quests_of

QUIZ_SIZE = 5
PASS_MARK = 4
QUIZ_TTL = timedelta(minutes=30)
DEFAULT_VISIT_RADIUS_M = 35
MAX_VISIT_RADIUS_M = 1000
# Bu mesafedeki eserler aynı yapı topluluğu sayılır (Muradiye'de dört eser 100 m içinde, Osman/Orhan Gazi 28 m).
SAME_SITE_M = 150
# "Yanlış" bilgi hedef eserin bir kaydıyla en az bu kadar ortak kök paylaşıyorsa kullanılmaz.
MIN_SHARED_STEMS = 3

TARGET_MIX = (("choice", 3), ("image_pick", 1), ("true_false", 1))
FILL_ORDER = ("image_pick", "true_false", "choice")
TRUE, FALSE = 1, 0

# --- Metin katlama ve ad denetimi ------------------------------------------------------------------------------------

_FOLD = str.maketrans({"ı": "i", "ş": "s", "ğ": "g", "ü": "u", "ö": "o", "ç": "c", "â": "a", "î": "i", "û": "u",
                       "̇": None, "’": "'", "‘": "'"})
# Eser adının sonundaki yapı türü sözcükleri: ayırt edici ad bunlar atılınca kalan kısımdır ("Koza Han" → "koza").
_TYPE_WORDS = {"camii", "cami", "camisi", "turbesi", "turbe", "medresesi", "medrese", "han", "hani", "bedesteni",
               "bedesten", "kulliyesi", "kulliye", "mescidi", "mescit", "hamami", "hamam", "carsisi", "carsi",
               "kumbeti", "kumbet", "imareti", "zaviyesi", "tekkesi", "sebili", "cesmesi", "kopru", "koprusu",
               "kervansarayi", "sarayi", "kalesi", "kilisesi", "darussifasi"}
_LEAD_WORDS = {"sultan"}
# Örtüşme denetiminde sayılmayan, her kayıtta geçebilecek genel kökler.
_STOP_STEMS = {"olara", "icin", "gibi", "daha", "olan", "sonra", "once", "kadar", "yili", "yilla", "yilin", "taraf",
               "uzeri", "yapil", "yapti", "kulla", "kayna", "farkl", "bugun", "bulun", "edilm", "birli", "sulta",
               "diye", "deki", "arasi", "bilin", "oglu", "tarih", "ancak", "bunla", "ayrica", "ilk", "ikinc"}


def fold(text: str) -> str:
    """Büyük/küçük harf ve Türkçe harf farkını kaldırır ("İ/I/ı" → "i", "Ş" → "s" …)."""
    text = unicodedata.normalize("NFC", text).replace("İ", "i").replace("I", "ı")
    return text.lower().translate(_FOLD)


def name_forms(m: PublicMonument) -> set[str]:
    """Eserin metinde aranacak adları: tam ad, alternatif adlar ve ayırt edici adları (katlanmış)."""
    forms: set[str] = set()
    for name in (m.name, *m.alternative_names):
        full = " ".join(fold(name).split())
        forms.add(full)
        words = full.split()
        while words and words[-1] in _TYPE_WORDS:
            words.pop()
        while len(words) > 1 and words[0] in _LEAD_WORDS | {fold(m.city)}:
            words.pop(0)
        core = " ".join(words)
        if len(core) >= 3:
            forms.add(core)
    return forms


class NameIndex:
    """Katalogdaki bütün eser adlarını metinde arar. Ad, sözcük başında aranır; sonundaki ekler ("Koza Han'ı") eşleşir."""

    def __init__(self, monuments: Iterable[PublicMonument]):
        forms = sorted({f for m in monuments for f in name_forms(m)}, key=len, reverse=True)
        self._re = re.compile("|".join(r"(?<!\w)" + re.escape(f) for f in forms)) if forms else None

    def mentions(self, text: Optional[str]) -> bool:
        return bool(text) and self._re is not None and self._re.search(fold(text)) is not None


def _stems(text: str) -> set[str]:
    words = re.findall(r"\w+", fold(text))
    return {w[:5] for w in words if (len(w) >= 4 or w.isdigit()) and w[:5] not in _STOP_STEMS}


def _normalized(text: str) -> str:
    return " ".join(re.findall(r"\w+", fold(text)))


# --- Soru havuzları -------------------------------------------------------------------------------------------------

def _fact_view(f: PublicFact) -> dict:
    return {"title": f.title, "text": f.text, "source": f.source.model_dump(mode="json"), "certainty": f.certainty}


def _image_attribution(img: PublicImage) -> str:
    return img.attribution or f"{img.rights_holder}, {img.license}"


def _image_option(img: PublicImage) -> dict:
    return {"file": img.card_file or img.file, "attribution": _image_attribution(img)}


@dataclass(frozen=True)
class _Pools:
    choice: tuple[PublicFact, ...]
    images: tuple[PublicImage, ...]
    # Çeldirici görseli olan diğer eserler: önce aynı yapı topluluğunda olmayanlar, sonra yakındakiler.
    far: tuple[tuple[PublicMonument, tuple[PublicImage, ...]], ...]
    near: tuple[tuple[PublicMonument, tuple[PublicImage, ...]], ...]
    tf_true: tuple[PublicFact, ...]
    tf_false: tuple[tuple[PublicFact, PublicMonument], ...]


def _game_images(m: PublicMonument, names: NameIndex) -> tuple[PublicImage, ...]:
    return tuple(i for i in m.images if i.game_use and not names.mentions(_image_attribution(i)))


def _statement_ok(f: PublicFact, names: NameIndex) -> bool:
    return f.game_use and fold(f.certainty) == "documented" and not names.mentions(f.text)


def _pools(catalog: PublicCatalog, m: PublicMonument) -> _Pools:
    names = NameIndex(catalog.monuments)
    others = [o for o in catalog.monuments if o.monument_id != m.monument_id]
    far, near = [], []
    for o in others:
        imgs = _game_images(o, names)
        if not imgs:
            continue
        apart = (m.location is not None and o.location is not None and haversine_m(
            m.location.latitude, m.location.longitude, o.location.latitude, o.location.longitude) >= SAME_SITE_M)
        (far if apart else near).append((o, imgs))

    owners: dict[str, set[str]] = {}
    for o in catalog.monuments:
        for f in o.facts:
            owners.setdefault(_normalized(f.text), set()).add(o.monument_id)
    target_stems = [_stems(f.text) for f in m.facts]

    def misleading(f: PublicFact) -> bool:
        s = _stems(f.text)
        return any(len(s & t) >= MIN_SHARED_STEMS for t in target_stems)

    tf_false = tuple((f, o) for o in others if fold(o.type) != fold(m.type) for f in o.facts
                     if _statement_ok(f, names) and len(owners[_normalized(f.text)]) == 1 and not misleading(f))
    return _Pools(choice=tuple(quests_of(m)), images=_game_images(m, names), far=tuple(far), near=tuple(near),
                  tf_true=tuple(f for f in m.facts if _statement_ok(f, names)), tf_false=tf_false)


# --- Sınav kurma ----------------------------------------------------------------------------------------------------

def _prefer(cands: Sequence, key, avoid: frozenset[str], rng: random.Random):
    """Rastgele bir aday; önceki sınavda kullanılmamış olanlar önce."""
    pool = list(cands)
    rng.shuffle(pool)
    pool.sort(key=lambda c: key(c) in avoid)
    return pool[0]


class _Builder:
    def __init__(self, catalog: PublicCatalog, m: PublicMonument, rng: random.Random, avoid: frozenset[str]):
        self.m, self.rng, self.avoid = m, rng, avoid
        self.p = _pools(catalog, m)
        self.items: list[dict] = []
        self.used_facts: set[str] = set()  # bu sınavda soru ya da ifade olarak kullanılan bilgiler (cevap sızmasın)
        self.used_images: set[str] = set()
        self.used_distractor_monuments: set[str] = set()

    # Adaylar
    def _choice(self):
        return [f for f in self.p.choice if f.fact_id not in self.used_facts]

    def _tf_true(self):
        return [f for f in self.p.tf_true if f.fact_id not in self.used_facts]

    def _tf_false(self):
        return [(f, o) for f, o in self.p.tf_false if f.fact_id not in self.used_facts]

    def _targets(self):
        return [i for i in self.p.images if i.image_id not in self.used_images]

    def can(self, kind: str) -> bool:
        if kind == "choice":
            return bool(self._choice())
        if kind == "true_false":
            return bool(self._tf_true() or self._tf_false())
        return bool(self._targets()) and len(self.p.far) + len(self.p.near) >= 2

    # Sorular
    def take(self, kind: str):
        getattr(self, "_take_" + kind)()

    def _take_choice(self):
        f = _prefer(self._choice(), lambda f: "f:" + f.fact_id, self.avoid, self.rng)
        self.used_facts.add(f.fact_id)
        q = f.quest
        order = list(range(len(q.choices)))
        self.rng.shuffle(order)
        self.items.append({"kind": "choice", "key": "c:" + f.fact_id, "prompt": q.question,
                           "choices": [q.choices[i] for i in order], "answer": order.index(q.answer_index),
                           "explanation": q.explanation, "fact": _fact_view(f)})

    def _take_true_false(self):
        directions = [d for d, ok in ((TRUE, self._tf_true()), (FALSE, self._tf_false())) if ok]
        direction = self.rng.choice(directions)
        name = self.m.name
        if direction == TRUE:
            f = _prefer(self._tf_true(), lambda f: "f:" + f.fact_id, self.avoid, self.rng)
            explanation = f"Bu bilgi onaylı katalogda {name} kaydında yer alır."
        else:
            f, owner = _prefer(self._tf_false(), lambda fo: "f:" + fo[0].fact_id, self.avoid, self.rng)
            explanation = f"Bu bilgi {name} ile değil, {owner.name} ile ilgilidir; onaylı katalogda o eserin kaydındadır."
        self.used_facts.add(f.fact_id)
        self.items.append({"kind": "true_false", "key": "t:" + f.fact_id, "prompt": f"Bu bilgi {name} ile mi ilgili?",
                           "statement": f.text, "answer": direction, "explanation": explanation, "fact": _fact_view(f)})

    def _take_image_pick(self):
        target = _prefer(self._targets(), lambda i: "i:" + i.image_id, self.avoid, self.rng)
        self.used_images.add(target.image_id)
        distractors = []
        for group in (self.p.far, self.p.near):
            cands = [g for g in group if g[0].monument_id not in {d[0].monument_id for d in distractors}]
            self.rng.shuffle(cands)
            cands.sort(key=lambda g: g[0].monument_id in self.used_distractor_monuments)
            distractors += cands[:2 - len(distractors)]
        options = [(self.m, target)] + [(o, self.rng.choice(imgs)) for o, imgs in distractors]
        self.used_distractor_monuments.update(o.monument_id for o, _ in distractors)
        self.rng.shuffle(options)
        answer = next(i for i, (o, _) in enumerate(options) if o.monument_id == self.m.monument_id)
        listing = ", ".join(o.name for o, _ in options)
        self.items.append({"kind": "image_pick", "key": "i:" + target.image_id, "prompt": f"Hangisi {self.m.name}?",
                           "images": [_image_option(img) for _, img in options], "answer": answer,
                           "explanation": f"Doğru cevap {answer + 1}. görsel. Görseller sırasıyla: {listing}.",
                           "fact": None})

    def build(self) -> list[dict]:
        # Doğru/yanlış sorusu önce seçilir: oyun onaylı bilgilerin hepsi aynı zamanda çoktan seçmeli soru olduğundan,
        # önce sorular seçilseydi "bu esere ait" ifade kalmaz ve cevap hep "Yanlış" olurdu (tahmin edilebilir soru).
        mix = dict(TARGET_MIX)
        for kind in ("true_false", "image_pick", "choice"):
            for _ in range(mix[kind]):
                if self.can(kind):
                    self.take(kind)
        # Eksik kalan sorular türler arasında sırayla tamamlanır (aynı türden üst üste yığılmaz).
        turn = 0
        while len(self.items) < QUIZ_SIZE:
            kinds = [FILL_ORDER[(turn + i) % len(FILL_ORDER)] for i in range(len(FILL_ORDER))]
            step = next((i for i, k in enumerate(kinds) if self.can(k)), None)
            if step is None:
                break
            self.take(kinds[step])
            turn += step + 1
        self.rng.shuffle(self.items)
        return [{"qid": f"q{i}", **item} for i, item in enumerate(self.items, 1)]


def compose_quiz(catalog: PublicCatalog, m: PublicMonument, rng: random.Random,
                 previous: Iterable[dict] = ()) -> list[dict]:
    """Eserin sınav soruları (sunucu görünümü, doğru cevaplarla). `previous`: aynı kullanıcının önceki sınavının
    soruları; onlarda kullanılan kayıtlar (bilgi, soru ya da ifade olarak; görsel) bu sınavda ancak başka seçenek kalmazsa
    yeniden kullanılır. Veri yetmezse `QUIZ_SIZE`'dan az soru döner (çağıran sınavı açmaz)."""
    avoid = frozenset(_record_key(item.get("key", "")) for item in previous)
    return _Builder(catalog, m, rng, avoid).build()


def _record_key(key: str) -> str:
    # "c:<bilgi>" ve "t:<bilgi>" aynı kaydı kullanır: yeniden denemede kayıt düzeyinde kaçınılır.
    return "f:" + key[2:] if key[:2] in ("c:", "t:") else key


def quiz_capacity(catalog: PublicCatalog, m: PublicMonument) -> int:
    """Eserden kurulabilecek soru sayısı (en fazla `QUIZ_SIZE`)."""
    return len(compose_quiz(catalog, m, random.Random(0)))


def public_question(item: dict) -> dict:
    """İstemciye giden soru: beyaz liste. Doğru cevap, kayıt kimliği ve sahiplik bilgisi gönderilmez."""
    out = {"qid": item["qid"], "kind": item["kind"], "prompt": item["prompt"]}
    if item["kind"] == "choice":
        out["choices"] = list(item["choices"])
    elif item["kind"] == "image_pick":
        out["images"] = [{"file": i["file"], "attribution": i["attribution"]} for i in item["images"]]
    else:
        out["statement"] = item["statement"]
    return out


def option_count(item: dict) -> int:
    if item["kind"] == "true_false":
        return 2
    return len(item["choices"] if item["kind"] == "choice" else item["images"])


def grade(items: Sequence[dict], answers: dict[str, int]) -> tuple[int, list[dict]]:
    """`answers`: soru kimliği → seçilen şık (doğru/yanlışta 1 = Doğru, 0 = Yanlış). Puan ve soru başına sonuç."""
    results = []
    for item in items:
        correct = answers[item["qid"]] == item["answer"]
        results.append({"qid": item["qid"], "correct": correct, "correct_choice": item["answer"],
                        "explanation": item["explanation"], "fact": item["fact"]})
    return sum(r["correct"] for r in results), results


# --- Ziyaret --------------------------------------------------------------------------------------------------------

_ON = ("1", "on", "true", "yes")
_OFF = ("0", "off", "false", "no", "")


@dataclass(frozen=True)
class GameSettings:
    visit_radius_m: int = DEFAULT_VISIT_RADIUS_M
    visit_simulation: bool = False

    @classmethod
    def from_env(cls) -> "GameSettings":
        """`VAKIFNAME_VISIT_RADIUS_M` (1–1000 tam sayı, varsayılan 35) ve `VAKIFNAME_VISIT_SIMULATION` (on|off,
        varsayılan off). Geçersiz değer açılışta hata verir; sessizce varsayılana dönülmez."""
        raw = os.environ.get("VAKIFNAME_VISIT_RADIUS_M", "").strip()
        radius = int(raw) if raw else DEFAULT_VISIT_RADIUS_M
        if not 1 <= radius <= MAX_VISIT_RADIUS_M:
            raise ValueError(f"VAKIFNAME_VISIT_RADIUS_M 1 ile {MAX_VISIT_RADIUS_M} arasında olmalı.")
        simulation = os.environ.get("VAKIFNAME_VISIT_SIMULATION", "off").strip().lower()
        if simulation not in _ON + _OFF:
            raise ValueError("VAKIFNAME_VISIT_SIMULATION yalnızca on veya off olabilir.")
        return cls(visit_radius_m=radius, visit_simulation=simulation in _ON)


@dataclass(frozen=True)
class VisitTarget:
    latitude: float
    longitude: float
    radius_m: float


def visit_target(m: PublicMonument, settings: GameSettings) -> Optional[VisitTarget]:
    """Ziyaretin denetlendiği nokta. Katalogda onaylı check-in noktası varsa o nokta ve yarıçapı (yarıçap o noktaya
    göre tanımlıdır), yoksa eserin onaylı harita konumu ve `VAKIFNAME_VISIT_RADIUS_M`. Konumu olmayan eserde `None`."""
    if m.checkin is not None:
        return VisitTarget(m.checkin.latitude, m.checkin.longitude, m.checkin.radius_m)
    if m.location is not None:
        return VisitTarget(m.location.latitude, m.location.longitude, settings.visit_radius_m)
    return None


def visit_radius(m: PublicMonument, settings: GameSettings) -> int:
    return max(1, round(m.checkin.radius_m)) if m.checkin is not None else settings.visit_radius_m


def distance_m(target: VisitTarget, latitude: float, longitude: float) -> float:
    return haversine_m(latitude, longitude, target.latitude, target.longitude)
