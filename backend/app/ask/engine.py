"""Yayımlanmış olgular üzerinde arama ve cevap seçimi.

Güvenlik kuralı: bir olgunun cevap sayılabilmesi için sorudaki içerik terimlerinin en az yarısını (ağırlıklı) gerçekten
içermesi gerekir; "kaç" sorularında sayı, "ne zaman" sorularında yıl bulunmalıdır. Anlamsal benzerlik (embedding)
yalnızca bu koşulu geçen olgular arasında sıralamayı iyileştirir; tek başına cevap üretmez. Böylece model yüklenemese de
cevaplanabilirlik kararı değişmez, yalnızca sıralama kelime aramasına kalır.
"""

import hashlib
import json
import logging
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from ..public_catalog import PublicCatalog
from .nlu import AMBIGUOUS, EXTRA_ALIASES, OTHER_MONUMENTS, STOP, Analyzer, Question, Term, CONCEPTS, _CONCEPT_WORDS, _FOCUS, _OVERVIEW_WORDS
from .spelling import Correction, Speller
from .verifier import TOP_K, Verifier

CE_POOL = 10
logger = logging.getLogger("vakifname.ask")
from .text import YEAR, counted_stems, fold, has_number, has_year, stem, stems, words

ANSWER_METHOD = "approved_text_retrieval"
# Yazım düzeltmesiyle yeniden denenecek sonuçlar ve düzeltilmiş soru cevap vermese de ham sonuçtan daha bilgilendirici
# sayılanlar (ör. "yeşil cmi" → katalogda olmayan eser).
_RETRY_STATUSES = frozenset({"not_found", "monument_not_identified", "clarification_required"})
_BETTER_THAN_NOTHING = frozenset({"monument_not_in_catalog", "current_info_unavailable"})
RELATED_MARGIN = 0.12
WEAK_WEIGHT = 0.25
# Anlamsal kurtarma (yalnızca model yüklüyken): kelime kapsaması eşiğin altında kalsa da embedding tek bir olguyu açık
# farkla öne çıkarıyorsa ve en az bir güçlü terim o olguda geçiyorsa cevap verilir. Eşikler geliştirme setlerinde,
# cevabı olmayan hiçbir soruyu cevaplamayacak biçimde seçildi (cevapsız sorularda en yüksek fark 0,035 idi).
RESCUE_MIN_COSINE = 0.87
RESCUE_MIN_MARGIN = 0.045
RESCUE_MIN_COVERAGE = 0.34
TITLE_BONUS = 0.12
# "Ne zaman" sorusunda yıl yoksa dönem bildiren ifade de tarih kanıtıdır ("Çelebi Mehmed döneminde", "14. yüzyıl").
_ERA = re.compile(r"\b(donem|devri|devrinde|yuzyil|asir|cag)")
_DURATION = re.compile(r"\b(basla|surd|sure|surmu|yillik)")
_PRESENT = re.compile(r"\b(bugun|gunumuz|halen|hala|simdi)|(maktadir|mektedir|kullaniliyor)\b")
_PRESENT_Q = re.compile(r"\b(bugun|gunumuzde|simdi|hala|halen|artik)\b")
# Kavramın konu edildiği olgu kategorileri. Soru bu kavramlardan birini soruyorsa olgu da o kategoride olmalı:
# restorasyon sorusuna restorasyon kaydı, amaç sorusuna vakıf/amaç kaydı. Başka bir kayıtta kelimenin geçmesi yetmez
# ("belgeden gelir" ≠ vakfın geliri; "Yönetim Planı" ≠ yapının planı).
_ARCH = frozenset({"architecture"})
_CONCEPT_CATEGORY: dict[str, frozenset[str]] = {
    "plan": _ARCH, "shape": _ARCH, "wall": _ARCH, "column": _ARCH, "pier": _ARCH, "courtyard": _ARCH, "room": _ARCH | {"function"},
    "dimension": _ARCH, "height": _ARCH, "cover": _ARCH | {"restoration"},
    "decor": frozenset({"artistic_feature", "inscription"}), "color": frozenset({"artistic_feature"}),
    "writing": frozenset({"inscription", "artistic_feature"}), "inscription": frozenset({"inscription", "construction"}),
    "burial": frozenset({"burial_practice", "historical_person", "historical_event"}), "restore": frozenset({"restoration", "function"}),
    "purpose": frozenset({"foundation_purpose"}), "use": frozenset({"function", "architecture"}),
    "museum": frozenset({"function"}), "architect": frozenset({"historical_person"}), "imam": frozenset({"historical_person"}),
    "quake": frozenset({"historical_event", "restoration"}), "damage": frozenset({"historical_event", "restoration"}),
    "fire": frozenset({"historical_event", "restoration"}), "unesco": frozenset({"historical_event"}),
}
# Eserin kendisinin yapımını soran sorularda (parça adı yok) kabul edilen kategoriler.
_BUILD_CATEGORIES = frozenset({"construction", "foundation_purpose"})
# Başlığı bir yapı parçasını konu alan olgu, eserin kendisinin yapımını anlatmaz ("İki minare, iki dönem").
_PART_TITLE = re.compile(r"\b(minare|minber|mihrap|mahfil|sadirvan|mescit|ahir|tabhane|galeri|kubbe|cini|sanduka)")
# Başlığı eserin içindeki ayrı bir yapıyı (ahır, mescit) konu alan olgu ("İç Koza Han: ahır bölümü"), soru o başlıkla hiç örtüşmüyorsa eserin
# kendisi hakkındaki soruya cevap sayılmaz ("Koza Han kaç katlı?" ≠ ahırın tek katlı oluşu).
_SUBPART_TITLE = re.compile(r"\b(ahir|mescit)")


def _title_overlap(terms: list[Term], title_stems: frozenset[str]) -> bool:
    return any(_matches_stems(t, title_stems, soft=True) or any(len(x) >= 4 and any(len(y) >= 4 and x[:4] == y[:4]
               for y in title_stems) for x in t.stems) for t in terms)
CERTAINTY_LABELS = {
    "documented": "Kaynaklarda belgelenmiş bilgi",
    "reported": "Kaynaklarda aktarılan bilgi; kesinleşmiş değil",
    "uncertain": "Kesin olmayan veya tartışmalı bilgi",
}
NOTICE = ("Cevaplar yalnızca yayın onayı verilmiş tarihî kayıtlardan olduğu gibi alınır; yapay zekâ yeni metin üretmez. "
          "Bu bir tarihî kişinin sözü değildir.")
_PREFERRED = {
    "build": ("construction", "foundation_purpose"),
    "who": ("construction", "foundation_purpose", "historical_person"),
    "overview": ("construction", "foundation_purpose", "architecture", "function"),
}


_TITLE = r"(?:Sultan|Paşa|Bey|Gazi|Çelebi|Hatun|Şehzade|Efendi|Ağa|Hacı|Fatih|Yavuz|Yıldırım)"
_NOT_PERSON = {
    "Cami", "Camii", "Han", "Hanı", "Türbe", "Türbesi", "Medrese", "Medresesi", "Bedesten", "Bedesteni", "Bursa",
    "Kültür", "Portalı", "Dünya", "Mirası", "Miras", "Alan", "Yönetim", "Planı", "Büyükşehir", "Belediyesi", "Osmanlı",
    "Bizans", "Avrupa", "İstanbul", "UNESCO", "Hicrî", "Verem", "Savaş", "Dispanseri", "Kur'an", "El", "Yazmaları",
    "Müzesi", "Kapalıçarşı", "Hamidiye", "Caddesi", "Söğüt", "Gümüşlü", "Kümbet", "Mevlid", "İç", "Koza", "Pirinç",
    "Hân-ı", "Cedîd-i", "Sânî", "Yunan", "Fransız", "Timur", "Ulu", "Muradiye", "Listesi", "Cumalıkızık", "İmparatorluğu",
    "Doğuşu", "Kaynak", "Kitabın", "Bugün", "Ancak", "Resmî",
}
_CAP = r"[A-ZÇĞİÖŞÜÂÉ][\wçğıöşüâîûé'’-]+"


_PART_CONCEPTS = {"minber", "mihrab", "minaret", "dome", "fountain", "courtyard", "room", "column", "pier", "mosque_small",
                  "stable", "inscription"}


def _instrumentals(text: str) -> set[str]:
    """Araç/malzeme hâlindeki kelimelerin kökleri: "kurşunla" → "kursu", "çinilerle" → "ciniler"."""
    return {stem(w[: -len(m.group(1))]) for w in words(text) if (m := re.search(r"(y?la|y?le)$", w)) and len(w) > 5}


def _strip_names(text: str, monument) -> str:
    """Türbede yatan kişinin adını (türbenin adını) metinden çıkarır: "II. Murad Türbesi" ayrı bir kişi anılması
    sayılmaz. Diğer eser türlerinde ad bânîyi anabilir ("Yıldırım Bayezid Bedesteni"), çıkarılmaz."""
    if monument.type != "türbe":
        return text
    for name in sorted({monument.name, *monument.alternative_names}, key=len, reverse=True):
        base = re.sub(r"\s+(Türbesi|Camii|Cami|Han|Hanı|Medresesi|Bedesteni)$", "", name)
        for form in (base, re.sub(r"^(Sultan|Şehzade)\s+", "", base)):
            text = re.sub(re.escape(form) + r"[\wçğıöşü'’]*", " ", text)
        text = re.sub(re.escape(name) + r"[\wçğıöşü'’]*", " ", text)
    return text


def _has_person(text: str) -> bool:
    """Metinde bir kişi adı var mı: unvanlı ad, "oğlu", Roma rakamlı sultan ya da yer/kurum adı olmayan iki büyük harfli kelime."""
    if re.search(_TITLE + r"\b|\boğlu\b|\b[IVX]+\. " + _CAP, text):
        return True
    for m in re.finditer(r"(?<![.!?]\s)(?<!^)\b(" + _CAP + r")\s+(" + _CAP + r")", text):
        if m.group(1) not in _NOT_PERSON and m.group(2) not in _NOT_PERSON:
            return True
    return False


# Hükümdar: unvanla ya da yalnızca hükümdar için kullanılan adla ("Abdülaziz oğlu Hacı Mehmed" bir ustadır).
_RULER = re.compile(r"\b(Sultan|padişah|Yıldırım Bayezid|II\. Bayezid|[I]+\. Murad|Fatih|Çelebi Mehmed|Kanuni|Yavuz|"
                    r"Orhan Gazi|Osman Gazi)")
# İyelikli "mimarı/mimarın" ya da "tasarla-": yapının mimarı. Yalın "mimar" (meslek) bir onarımcıyı da anlatabilir.
_ARCHITECT_OF = re.compile(r"mimar(ı|ın|ları|larından)\b|tasarla")


def _doc_stems(text: str, vocab: frozenset[str] = frozenset()) -> frozenset[str]:
    """Olgu metninin kökleri.

    - "mimari" (mimarlık) ile "mimarı" (mimar) katlanınca aynı yazılır; köken metinde ayrılır.
    - Bileşik kelimeler, korpusta ayrıca geçen bir kelimeyle bitiyorsa o kelime de eklenir ("Kapalıçarşı" → "çarşı").
    """
    text = re.sub(r"\b([Mm])imari", r"\1imri", text)
    # "kitabında" (kitap) ile "kitabesi" (kitabe) aynı köke düşer; kitap biçimi ayrılır.
    text = re.sub(r"\b([Kk])itab(?!e)", r"\1itap", text)
    out = set(stems(text))
    for w in words(text):
        for i in range(3, len(w) - 4):
            tail = stem(w[i:])
            if len(tail) == 5 and tail in vocab:
                out.add(tail)
    return frozenset(out)


_VERIFIER: Optional[Verifier] = None


def _default_verifier() -> Verifier:
    global _VERIFIER
    if _VERIFIER is None:
        # Deneysel model dosyası yalnızca açıkça verilirse kullanılır (ör. yalıtılmış ölçüm örneği).
        path = os.environ.get("VAKIFNAME_ASK_VERIFIER_FILE")
        _VERIFIER = Verifier.load(Path(path)) if path else Verifier.load()
    return _VERIFIER


def catalog_sha256(catalog: PublicCatalog) -> str:
    return hashlib.sha256(json.dumps(catalog.model_dump(mode="json"), ensure_ascii=False, sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True)
class Doc:
    fact_id: str
    monument_id: str
    monument_name: str
    title: str
    text: str
    category: str
    certainty: str
    sources: tuple[dict, ...]
    publication_decision_id: str
    stems: frozenset[str]
    title_stems: frozenset[str]
    year: bool
    years: tuple[int, ...]
    era: bool
    present: bool
    number: bool
    counted: frozenset[str]
    person: bool
    ruler: bool
    architect_of: bool

    @property
    def passage(self) -> str:
        """Embedding için olgu metni (eser adı ve başlıkla)."""
        return f"{self.monument_name}. {self.title}. {self.text}"

    def view(self) -> dict:
        return {
            "fact_id": self.fact_id, "monument_id": self.monument_id, "monument_name": self.monument_name,
            "title": self.title, "text": self.text, "category": self.category, "certainty": self.certainty,
            "certainty_label": CERTAINTY_LABELS.get(self.certainty, self.certainty),
            "sources": list(self.sources), "publication_decision_id": self.publication_decision_id,
        }


class Corpus:
    """Genel katalogdaki yayımlanmış olgular. Başka hiçbir veri kaynağı kullanılmaz."""

    def __init__(self, catalog: PublicCatalog, word_check: Optional[Callable[[str], bool]] = None):
        """`word_check`: genel Türkçe sözcük denetimi (yazım düzeltmesi doğru sözcükleri değiştirmesin diye)."""
        self.catalog = catalog
        self.sha256 = catalog_sha256(catalog)
        self.generated_at = None
        self.monuments = {m.monument_id: m for m in catalog.monuments}
        docs = []
        vocab = frozenset(st for m in catalog.monuments for f in m.facts for st in stems(f"{f.title} {f.text}"))
        for m in catalog.monuments:
            for f in m.facts:
                body = f"{f.title} {f.text}"
                docs.append(Doc(
                    fact_id=f.fact_id, monument_id=m.monument_id, monument_name=m.name, title=f.title, text=f.text,
                    category=f.category, certainty=f.certainty,
                    sources=tuple({"title": s.title, "publisher": s.publisher, "url": s.url} for s in f.sources),
                    publication_decision_id=f.publication_decision_id, stems=_doc_stems(body, vocab),
                    title_stems=_doc_stems(f.title), year=has_year(body),
                    years=tuple(sorted({int(y) for y in YEAR.findall(body)})), era=bool(_ERA.search(fold(body))),
                    present=bool(_PRESENT.search(fold(body))),
                    number=has_number(body), counted=counted_stems(body), person=_has_person(f.text),
                    ruler=bool(_RULER.search(body)), architect_of=bool(_ARCHITECT_OF.search(body)),
                ))
        self.docs: tuple[Doc, ...] = tuple(docs)
        self.analyzer = Analyzer([(m.monument_id, m.name, tuple(m.alternative_names)) for m in catalog.monuments])
        # Yazım düzeltme sözlüğü: katalog metinleri, eser adları (katalog dışı bilinen eserler dahil) ve soru sözcükleri.
        names = [n for m in catalog.monuments for n in (m.name, *m.alternative_names, *EXTRA_ALIASES.get(m.monument_id, ()))]
        names += [a for a, _, _ in AMBIGUOUS] + list(OTHER_MONUMENTS)
        self.speller = Speller([f"{d.title}. {d.text}" for d in docs] + names, names,
                               [*_FOCUS, *_OVERVIEW_WORDS, *(w for v in _CONCEPT_WORDS.values() for w in v.split()), *STOP],
                               is_word=word_check)

    def correct(self, question: str) -> Correction:
        return self.speller.correct(question, frozenset(STOP))


def _matches_stems(term: Term, doc_stems: frozenset[str], soft: bool = False) -> bool:
    """Tam kök eşleşmesi ya da sorudaki kısa kelimenin olgudaki ekli biçimin başı olması ("oda" → "odala").

    Ters yön (olgudaki kısa kelimenin sorudaki uzun kelimenin başı olması) kullanılmaz: "yapı" ile "yapıldı" gibi
    farklı kelimeler karışır. `soft`: kavram olmayan terimlerde, iki uzun kök ilk dört harfte uyuşursa da eşleşir
    ("ortasındaki" ~ "ortadaki", "ağaçtan" ~ "ağacından").
    """
    if term.stems & doc_stems:
        return True
    if any(len(t) >= 3 and any(d.startswith(t) for d in doc_stems) for t in term.stems):
        return True
    # Kavram olmayan terimlerde iki kök ilk dört harfte uyuşuyorsa ("batısındaki" ~ "batı") da eşleşir.
    return soft and any(len(t) >= 5 and any(len(d) >= 4 and d[:4] == t[:4] for d in doc_stems) for t in term.stems)


def _matches(term: Term, doc: Doc) -> bool:
    if term.label == "ruler" and doc.ruler:
        return True
    return _matches_stems(term, doc.stems, soft=term.label not in CONCEPTS)


_PERSON = (Term("architect", CONCEPTS["architect"]), Term("craftsman", CONCEPTS["craftsman"]))
# Yapı parçası sayılmayan terimler ("kim yeniden yaptırdı", "yaptıran padişah").
_NOT_PART = {"build", "rebuild", "ruler", "architect", "craftsman", "restore", "parent", "sibling", "owner"}


@dataclass
class Scored:
    doc: Doc
    score: float
    coverage: float
    eligible: bool
    cosine: Optional[float] = None
    # Cevap türü koşulları (sayı, tarih, süre, kişi, yapının mimarı, sorudaki yıl) ve en az bir güçlü terim.
    constraints_ok: bool = False
    features: dict = field(default_factory=dict)


class Engine:
    def __init__(self, corpus: Corpus, query_vectors: Optional[Callable[[str], object]] = None, doc_vectors=None,
                 verifier: Optional[Verifier] = None, cross_encoder=None):
        """`query_vectors` ve `doc_vectors` verilirse (aynı model, aynı katalog) sıralamada anlamsal benzerlik kullanılır.
        `verifier`: yanıt uygunluğu denetleyicisi (verilmezse paketteki model yüklenir)."""
        self.corpus = corpus
        self.verifier = verifier if verifier is not None else _default_verifier()
        # Cross-encoder (isteğe bağlı): adayların soruya doğrudan karşılık verip vermediğini puanlar; tek başına karar vermez.
        self.cross_encoder = cross_encoder
        self._encode = query_vectors
        self._vectors = doc_vectors
        n = len(corpus.docs)
        self._idf_cache: dict[frozenset, float] = {}
        self._n = n

    @property
    def retrieval(self) -> str:
        return "hybrid" if self._vectors is not None else "lexical"

    def _df(self, term: Term) -> int:
        key = (term.label, term.stems)
        if key not in self._idf_cache:
            self._idf_cache[key] = sum(_matches(term, d) for d in self.corpus.docs)
        return self._idf_cache[key]

    def _strong(self, term: Term, q: Optional[Question] = None) -> bool:
        """Fiil çekimi zayıftır. "Hangi …" sorularında hiçbir olguda geçmeyen fiil, tanımlanması istenen şeyin
        parçasıdır ("hangi dersler okutulurdu"); sayı/tarih soruları ise kendi kanıt denetimine sahiptir."""
        if not term.weak:
            return True
        return bool(q and q.identify and not q.kind & {"count", "date", "duration"} and self._df(term) == 0)

    def _idf(self, term: Term) -> float:
        idf = math.log((self._n + 1) / (self._df(term) + 1)) + 1.0
        return idf * (1.0 if self._strong(term) else WEAK_WEIGHT)

    def _cosines(self, question: str) -> Optional[dict[str, float]]:
        if self._vectors is None or self._encode is None:
            return None
        try:
            qv = self._encode(question)
        except Exception:  # noqa: BLE001 — model hatası sıralamayı kelime aramasına bırakır
            return None
        sims = self._vectors @ qv
        return {d.fact_id: float(s) for d, s in zip(self.corpus.docs, sims)}

    def _score(self, q: Question, docs: list[Doc], cos: Optional[dict[str, float]]) -> list[Scored]:
        terms = list(q.terms)
        if not terms and "whose" in q.kind:
            terms = [Term("owner", CONCEPTS["owner"])]
        elif not terms and (q.kind & {"date", "who"}):
            terms = [Term("build", CONCEPTS["build"])]
        strong = [t for t in terms if self._strong(t, q)]
        total = sum(self._idf(t) for t in terms)
        present_q = bool(_PRESENT_Q.search(q.norm))
        q_years = set(YEAR.findall(q.raw))
        weak_terms = [t for t in terms if not self._strong(t, q)]
        # Sorulan nesne: kavram olmayan güçlü terimler ve yapı parçası kavramları (minber, mihrap, kubbe…).
        objects_q = [t for t in strong if t.label not in CONCEPTS or t.label in _PART_CONCEPTS]
        out = []
        for d in docs:
            matched = [t for t in terms if _matches(t, d)
                       # "Kaç köşeli?": sayılan şey olguda sayıyla (sekizgen planlı) geçiyorsa terim karşılanmıştır.
                       or (q.count_noun is not None and t.stems <= q.count_noun.stems | t.stems
                           and t.stems & q.count_noun.stems and _matches_stems(q.count_noun, d.counted))]
            coverage = (sum(self._idf(t) for t in matched) / total) if total else 0.0
            strong_matched = [t for t in strong if t in matched]

            # --- Sert koşullar: cevap türü (bunları geçmeyen olgu soruyu yanıtlayamaz) ---------------------------
            hard = bool(strong_matched) or (not strong and bool(matched))
            # Sorudaki her güçlü kavram (yükseklik, restorasyon, kubbe…) olguda geçmeli; kavram olmayan kelimeler
            # biçim farkı yüzünden kaçabileceği için doğrulayıcıya bırakılır.
            hard = hard and all(t in matched for t in strong if t.label in CONCEPTS)
            # Soru sözcüğünün doğrudan sorduğu eylem ("nasıl satılırdı?") olguda geçmeli.
            hard = hard and all(t in matched for t in terms if t.focus)
            # "Hangi … okutulurdu?": tanımlanması istenen şeyin yüklemi hiçbir olguda yoksa katalog bunu bilmiyordur.
            if q.identify and any(t.weak and self._df(t) == 0 for t in terms):
                hard = False
            if q.kind & {"who", "whose"}:
                hard = hard and d.person  # "kim" sorusunun cevabı bir kişidir
            if "who" in q.kind and not _has_person(_strip_names(d.text, self.corpus.monuments[d.monument_id])):
                hard = False  # türbenin sahibinin anılması, "restorasyonu kim yaptı?" sorusunun cevabı değildir
            # "Minberi kaç yılında yapıldı?": eserin kendi yapım kaydı, başlığında o parçayı anmıyorsa parçanın cevabı değildir.
            part_terms = [t for t in strong if t.label in _PART_CONCEPTS]
            if part_terms and d.category in _BUILD_CATEGORIES and not any(_title_overlap([t], d.title_stems) for t in part_terms):
                hard = False
            if q.instrument and not (_instrumentals(d.text) - {t2 for t in terms for t2 in t.stems}):
                hard = False  # "neyle kaplı?": olguda soruda geçmeyen bir malzeme/araç ("kurşunla") olmalı
            if any(t.label == "architect" for t in terms) and (q.kind & {"who", "whose"} or q.identify):
                hard = hard and d.architect_of  # "hangi mimar yaptı" yapının mimarını sorar, onarımcıyı değil
            if "count" in q.kind:
                # Sayı, sorulan şeyin hemen önünde olmalı ("yirmi kubbe"); metnin başka yerindeki sayı yetmez.
                hard = hard and q.count_noun is not None and _matches_stems(q.count_noun, d.counted)
            if "date" in q.kind:
                hard = hard and (d.year or d.era)
            if "duration" in q.kind:
                # Süre: "yirmi yıllık" gibi açık bir süre ya da başlangıcı ve bitişi yazılı bir dönem gerekir.
                hard = hard and (bool({"yil", "yilli", "sene"} & d.counted)
                                 or (len(d.years) >= 2 and bool(_DURATION.search(fold(d.text)))))
            # Soruda geçen yıl olguda yoksa olgu o tarih hakkında bir şey söylemez ("1781'de onarıldı mı?").
            if q_years and not q_years <= {str(y) for y in d.years}:
                hard = False

            # --- Uygunluk özellikleri (doğrulayıcı tartar) ---------------------------------------------------------
            mapped = [_CONCEPT_CATEGORY[t.label] for t in strong if t.label in _CONCEPT_CATEGORY]
            category_ok = not (mapped and len(mapped) == len(strong)) or any(d.category in cats for cats in mapped)
            labels_all = {t.label for t in terms if self._strong(t, q) or t.label in CONCEPTS}
            build_ok = True
            if labels_all & {"build", "finish"} and labels_all <= {"build", "rebuild", "ruler", "owner", "finish", "start"}:
                cats = {"foundation_purpose"} if "why" in q.kind else _BUILD_CATEGORIES
                build_ok = d.category in cats and not _PART_TITLE.search(fold(d.title))
            subpart_ok = not (_SUBPART_TITLE.search(fold(d.title)) and not _title_overlap(
                terms + ([q.count_noun] if q.count_noun else []), d.title_stems))
            parts = [t for t in terms if t.label not in _NOT_PART]
            part_maker_ok = True
            if q.kind & {"who", "whose"} and (any(t.label == "build" for t in terms) or "whose" in q.kind) and parts:
                part_maker_ok = (any(_matches_stems(t, d.title_stems) for t in parts) or any(_matches(p, d) for p in _PERSON))
                hard = hard and part_maker_ok  # "kapısını kim yaptı?" eserin bânîsini sormaz
            present_ok = not present_q or d.present or (bool(d.years) and max(d.years) >= 1990)
            title_overlap = any(_matches_stems(t, d.title_stems) for t in matched if not t.weak)
            strong_all = all(t in matched for t in strong)
            eligible = (hard and strong_all and category_ok and build_ok and subpart_ok and part_maker_ok
                        and present_ok)

            # --- Sıralama puanı (aday seçimi için) ---------------------------------------------------------------
            score = coverage
            labels = {t.label for t in matched}
            if "date" in q.kind and d.year:
                score += 0.1
            if "count" in q.kind and d.number:
                score += 0.1
            objects = [t for t in terms if t.label not in ("build", "rebuild", "who")]
            if not objects and ("build" in labels or "who" in q.kind) and d.category in _PREFERRED["who"]:
                score += 0.08
            elif objects and q.kind & {"who", "whose"} and any(_matches(p, d) for p in _PERSON):
                score += 0.08
            if "name" in q.kind and "name" in labels:
                score += 0.1
            if any(d.category in _CONCEPT_CATEGORY.get(t.label, ()) for t in matched):
                score += 0.05
            if present_q:
                score += (0.04 if d.present else 0.0) + (0.08 * max(0, min(1, (max(d.years) - 1900) / 120)) if d.years else 0)
            if title_overlap:
                score += TITLE_BONUS
            score -= 0.002 * len(d.stems)
            score += 0.15 * sum((category_ok, build_ok, subpart_ok, part_maker_ok, present_ok, strong_all)) / 6
            c = cos[d.fact_id] if cos is not None else None
            feats = {
                "coverage": coverage, "strong_all": float(strong_all),
                "strong_frac": len(strong_matched) / len(strong) if strong else float(bool(matched)),
                "category_ok": float(category_ok), "build_ok": float(build_ok), "subpart_ok": float(subpart_ok),
                "part_maker_ok": float(part_maker_ok), "present_ok": float(present_ok), "title_overlap": float(title_overlap),
                "lex_rank1": 0.0, "cos": c or 0.0, "cos_margin": 0.0, "cos_rank1": 0.0, "has_cos": float(c is not None),
                "n_strong_inv": 1.0 / (len(strong) + 1),
                "weak_cov": (sum(1 for t in weak_terms if t in matched) / len(weak_terms)) if weak_terms else 1.0,
                "oov_verb": float(any(self._df(t) == 0 for t in weak_terms)),
                "obj_title": (sum(1 for t in objects_q if _title_overlap([t], d.title_stems)) / len(objects_q)) if objects_q else 1.0,
                "person_other": float(_has_person(_strip_names(d.text, self.corpus.monuments[d.monument_id]))),
                "who_q": float(bool(q.kind & {"who", "whose"})),
            }
            out.append(Scored(d, score, coverage, eligible, c, hard, feats))
        if out:
            best_lex = max(out, key=lambda s: s.score)
            best_lex.features["lex_rank1"] = 1.0
            if cos is not None:
                ranked = sorted(out, key=lambda s: -s.cosine)
                for i, s in enumerate(ranked):
                    other = ranked[1].cosine if i == 0 and len(ranked) > 1 else ranked[0].cosine
                    s.features["cos_margin"] = s.cosine - other if len(ranked) > 1 else 0.0
                    s.features["cos_rank1"] = float(i == 0)
                cmax = ranked[0].cosine
                for s in out:
                    s.score += 1.5 * (s.cosine - cmax)
        out.sort(key=lambda s: (-s.score, s.doc.fact_id))
        return out

    # --- Cevap -------------------------------------------------------------------------

    def _base(self, status: str, message: str, monument=None, **extra) -> dict:
        return {
            "status": status, "message": message,
            "monument": {"monument_id": monument.monument_id, "name": monument.name} if monument else None,
            "answer": None, "related": [], "options": [], "answer_method": ANSWER_METHOD, "retrieval": self.retrieval,
            "catalog_sha256": self.corpus.sha256, "notice": NOTICE, **extra,
        }

    def _options(self, mids) -> list[dict]:
        return [{"monument_id": mid, "name": self.corpus.monuments[mid].name} for mid in mids if mid in self.corpus.monuments]

    def ask(self, question: str, monument_id: Optional[str] = None, debug: bool = False) -> dict:
        """Önce soru olduğu gibi aranır (doğru yazılmış sorularda davranış değişmez). Cevap çıkmazsa ve soruda sözlükte
        olmayan sözcükler varsa, yazımı düzeltilmiş alternatifle yeniden aranır. Düzeltme güvenliyse cevap "sorunuzu
        şöyle anladım" notuyla gösterilir; değilse olgu cevap diye gösterilmez, ziyaretçiye "bunu mu demek
        istediniz?" diye sorulur."""
        fix = self.corpus.correct(question)
        if fix.changed and self._names_monument(question, fix):
            # Eser adı yalnızca düzeltilmiş soruda tanınıyor ("murad türbesni"): ham soru başka bir esere gidebilir.
            return self._corrected(question, monument_id, debug, fix, None)
        res = self._ask(question, monument_id, debug)
        if not fix.changed:
            return res
        if res["status"] == "answered" and fix.confident():
            # Ham soru, bozuk sözcüğün kısmi eşleşmesiyle başka bir olguya gidebilir ("depremde ykıldı mı" → onarım
            # kaydı). Güvenli düzeltmeyle aynı soru başka bir olguyla cevaplanıyorsa düzeltilmiş okuma tercih edilir.
            alt = self._ask(fix.display, monument_id, debug)
            fid = lambda r: (r.get("answer") or {}).get("fact_id")
            if alt["status"] == "answered" and fid(alt) != fid(res):
                logger.info("ask spelling changes=%d max_cost=%.2f confident=True answered->corrected", len(fix.changes),
                            fix.max_cost)
                return self._interpreted(alt, fix)
            return res
        if res["status"] not in _RETRY_STATUSES:
            return res
        return self._corrected(question, monument_id, debug, fix, res)

    def _names_monument(self, question: str, fix: Correction) -> bool:
        a = self.corpus.analyzer
        raw, alt = a.analyze(question), a.analyze(fix.text)
        return not raw.monuments and not raw.other_monument and bool(alt.monuments or alt.other_monument)

    def _corrected(self, question: str, monument_id: Optional[str], debug: bool, fix: Correction, res: Optional[dict]) -> dict:
        # Alternatif okunur biçimle aranır ("Depremde yıkıldı mı"): kelime araması zaten katlar, anlamsal model ise
        # Türkçe karakterli metinde daha isabetlidir.
        alt = self._ask(fix.display, monument_id, debug)
        # Yalnızca sayılar loglanır; soru metni loglanmaz.
        logger.info("ask spelling changes=%d max_cost=%.2f ratio=%.2f confident=%s status=%s->%s", len(fix.changes),
                    fix.max_cost, fix.changed_ratio, fix.confident(), res["status"] if res else "-", alt["status"])
        if alt["status"] == "answered":
            if fix.confident():
                return self._interpreted(alt, fix)
            return self._did_you_mean(fix, alt)
        if res is None or (alt["status"] in _BETTER_THAN_NOTHING and res["status"] in ("not_found", "monument_not_identified")):
            return self._interpreted(alt, fix)
        return res

    @staticmethod
    def _interpreted(res: dict, fix: Correction) -> dict:
        res["message"] = f"Sorunuzu “{fix.display}” olarak anladım. " + res["message"]
        res["interpreted_question"] = fix.display
        return res

    def _did_you_mean(self, fix: Correction, alt: dict) -> dict:
        """Düzeltme zayıf: bulunan olgu cevap olarak gösterilmez, yalnızca öneri olarak adı ve başlığıyla anılır."""
        a = alt["answer"]
        m = self.corpus.monuments.get(a.get("monument_id")) if a else None
        res = self._base("clarification_required", f"Sorunuzu tam anlayamadım. “{fix.display}” mı demek istediniz?", m)
        if a and a.get("fact_id"):
            res["suggestions"] = [{"question": fix.display, "fact_id": a["fact_id"], "title": a["title"],
                                   "monument_id": a["monument_id"], "monument_name": a["monument_name"]}]
        res["interpreted_question"] = fix.display
        return res

    def _ask(self, question: str, monument_id: Optional[str] = None, debug: bool = False) -> dict:
        c = self.corpus
        if not c.docs:
            return self._base("unavailable", "Henüz yayımlanmış tarihî kayıt yok.")
        q = c.analyzer.analyze(question)
        context = c.monuments.get(monument_id) if monument_id else None
        if q.negated_selection:
            return self._base("not_found", "Bir şeyin olmadığını ya da yapılmadığını soran sorulara, onaylı kayıtlar yalnızca "
                              "olanı anlattığı için güvenilir cevap veremiyorum. Soruyu olumlu biçimde sormayı deneyin.", context)

        mid: Optional[str] = None
        if len(q.monuments) > 1 and context and context.monument_id in q.monuments:
            # Açıklama sorusuna kullanıcı bir eser seçerek cevap verdi.
            q.monuments = [context.monument_id]
        if len(q.monuments) > 1:
            return {**self._base("clarification_required", "Sorunuz birden fazla esere değiniyor. Hangi eseri soruyorsunuz?"),
                    "options": self._options(q.monuments)}
        if q.monuments:
            mid = q.monuments[0]
        elif q.other_monument:
            return self._base("monument_not_in_catalog",
                              f"“{q.other_monument}” henüz VAKIFNAME kataloğunda yayımlanmış eserler arasında değil. "
                              "Başka bir eserin bilgisiyle cevap vermiyorum.")
        elif q.ambiguous:
            alias, mids, note = q.ambiguous
            if context and context.monument_id in mids:
                mid = context.monument_id
            else:
                msg = note or f"“{alias}” adı birden fazla esere karşılık geliyor. Hangisini soruyorsunuz?"
                return {**self._base("clarification_required", msg), "options": self._options(mids)}
        elif context:
            if q.type_word and q.type_word != context.type:
                same_type = [m.monument_id for m in c.catalog.monuments if m.type == q.type_word]
                return {**self._base("clarification_required",
                                     f"Sorunuz bir {q.type_word} hakkında görünüyor; açık olan eser ise {context.name}. "
                                     "Hangi eseri soruyorsunuz?", context), "options": self._options(same_type)}
            mid = context.monument_id

        if q.current_info:
            m = c.monuments.get(mid) if mid else None
            res = self._base("current_info_unavailable",
                             "Ziyaret saatleri, ücretler, ulaşım veya anlık durum gibi güncel bilgiler katalogda yok; "
                             "tahmin etmiyorum. Lütfen eserin yönetiminden veya resmî kaynaklardan kontrol edin.", m)
            if m and m.site_notice:
                res["site_notice"] = m.site_notice
            return res

        if mid is None:
            return self._global(q, question, debug)
        return self._answer_for(q, question, c.monuments[mid], debug)

    def _answer_for(self, q: Question, question: str, m, debug: bool) -> dict:
        docs = [d for d in self.corpus.docs if d.monument_id == m.monument_id]
        if "where" in q.kind and not q.terms:
            res = self._base("answered", "Eserin onaylı kimlik kaydındaki adresi:", m)
            res["answer"] = {
                "kind": "identity", "monument_id": m.monument_id, "monument_name": m.name, "title": "Adres",
                "text": m.address, "certainty": "documented", "certainty_label": "Onaylı eser kimliği kaydı",
                "sources": [], "catalog_decision_id": m.catalog_decision_id,
                "map": ({"latitude": m.location.latitude, "longitude": m.location.longitude} if m.location else None),
            }
            return res
        if "overview" in q.kind:
            ranked = sorted(docs, key=lambda d: (
                _PREFERRED["overview"].index(d.category) if d.category in _PREFERRED["overview"] else 9, d.fact_id))
            res = self._base("answered", f"{m.name} hakkında onaylı kayıtlardan öne çıkanlar:", m)
            res["answer"] = ranked[0].view()
            res["related"] = [d.view() for d in ranked[1:3]]
            return res
        scored = self._score(q, docs, self._cosines(question))
        # Doğrulayıcıya yalnızca cevap türü koşullarını geçen adaylar gider (cross-encoder varsa en çok CE_POOL, yoksa TOP_K).
        candidates = [s for s in scored if s.constraints_ok][:CE_POOL if self.cross_encoder else TOP_K]
        mode = self._cross_encode(question, candidates)
        decision = self.verifier.decide([(s.doc.fact_id, s.features) for s in candidates], mode)
        if not decision.answerable:
            res = self._base("not_found",
                             f"{m.name} için bu soruyu doğrudan cevaplayan onaylı bir tarihî kayıt bulamadım. Yanlış bilgi "
                             "vermemek için tahmin etmiyorum.", m)
            res["verification"] = decision.to_dict()
            if debug:
                res["_debug"] = self._debug(q, scored)
            return res
        top = next(s for s in candidates if s.doc.fact_id == decision.selected_fact_id)
        res = self._base("answered", f"{m.name} hakkında onaylı kayıt:", m)
        res["answer"] = top.doc.view()
        # İlgili kayıtlar yalnızca katı kapıyı da geçen ve puanı yakın olanlardır; cevap sayılmaz.
        res["related"] = [s.doc.view() for s in candidates if s is not top and s.eligible
                          and s.score >= top.score - RELATED_MARGIN][:2]
        res["verification"] = decision.to_dict()
        if debug:
            res["_debug"] = self._debug(q, scored)
        return res

    def _cross_encode(self, question: str, candidates: list[Scored]) -> str:
        """Cross-encoder puanlarını aday özelliklerine ekler; hata olursa CE'siz moda düşer."""
        for s in candidates:
            s.features.update({"ce": 0.0, "ce_margin": 0.0, "ce_rank1": 0.0, "has_ce": 0.0})
        if self.cross_encoder is None or not candidates:
            return self.retrieval
        try:
            scores = self.cross_encoder.scores(question, [f"{s.doc.title}. {s.doc.text}" for s in candidates])
        except Exception:  # noqa: BLE001 — model hatası cevabı CE'siz doğrulamaya bırakır
            logger.exception("Cross-encoder çalışmadı; CE'siz doğrulama kullanılıyor.")
            return self.retrieval
        best = max(range(len(scores)), key=lambda i: scores[i])
        for i, (s, sc) in enumerate(zip(candidates, scores)):
            other = max((x for j, x in enumerate(scores) if j != i), default=sc)
            s.features.update({"ce": sc, "ce_margin": sc - other if len(scores) > 1 else 0.0,
                               "ce_rank1": float(i == best), "has_ce": 1.0})
        return "hybrid_ce" if self.retrieval == "hybrid" else "lexical"

    @staticmethod
    def _rescue(scored: list[Scored]) -> Optional[Scored]:
        with_cos = sorted((s for s in scored if s.cosine is not None), key=lambda s: -s.cosine)
        if len(with_cos) < 2:
            return None
        best, second = with_cos[0], with_cos[1]
        if (best.constraints_ok and best.coverage >= RESCUE_MIN_COVERAGE and best.cosine >= RESCUE_MIN_COSINE
                and best.cosine - second.cosine >= RESCUE_MIN_MARGIN):
            return best
        return None

    def _global(self, q: Question, question: str, debug: bool) -> dict:
        """Eser adı geçmeyen sorular: yalnızca tek bir esere açıkça işaret ediyorsa cevaplanır."""
        if not q.terms or "overview" in q.kind:
            return {**self._base("monument_not_identified", "Hangi eseri soruyorsunuz? Bir eser seçin veya adını yazın."),
                    "options": self._options(self.corpus.monuments)}
        scored = [s for s in self._score(q, list(self.corpus.docs), self._cosines(question)) if s.eligible]
        by_monument: dict[str, Scored] = {}
        for s in scored:
            by_monument.setdefault(s.doc.monument_id, s)
        full = [s for s in by_monument.values() if s.coverage >= 0.999]
        if len(full) == 1 and len(by_monument) <= 2:
            m = self.corpus.monuments[full[0].doc.monument_id]
            res = self._base("answered", f"Sorunuz {m.name} ile ilgili onaylı bir kayıtla eşleşti:", m)
            res["answer"] = full[0].doc.view()
            return res
        if by_monument:
            return {**self._base("clarification_required", "Bu soru birden fazla eserle ilgili olabilir. Hangisini soruyorsunuz?"),
                    "options": self._options(list(by_monument)[:5])}
        return {**self._base("monument_not_identified",
                             "Soruyu katalogdaki bir eserle eşleştiremedim. Hangi eseri soruyorsunuz?"),
                "options": self._options(self.corpus.monuments)}

    @staticmethod
    def _debug(q: Question, scored: list[Scored]) -> dict:  # noqa: D401
        return {"candidates": [(s.doc.fact_id, dict(s.features)) for s in scored if s.constraints_ok and "has_ce" in s.features],
                "terms": [t.label for t in q.terms], "kind": sorted(q.kind),
                "top": [(s.doc.fact_id, round(s.score, 3), round(s.coverage, 2), s.eligible,
                         None if s.cosine is None else round(s.cosine, 3)) for s in scored[:5]]}
