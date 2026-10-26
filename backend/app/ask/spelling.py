"""Türkçe sorulardaki yazım hatalarına dayanıklı arama için sorgu düzeltme.

Ziyaretçinin sorusu değiştirilmez ve saklanmaz; burada yalnızca arama için düzeltilmiş bir alternatif üretilir. Sözlük
yalnızca onaylı katalogdaki sözcüklerden, eser adlarından (katalog dışı bilinen eserler dahil) ve soru çözümlemesinin
kendi sözcüklerinden kurulur; tarihî bilgi yoktur. Bir sözcük ancak sözlükte (ya da sözlükteki bir sözcük + Türkçe ek
olarak) bulunmuyorsa düzeltilir, yani doğru yazılmış sözcükler olduğu gibi kalır.

Benzerlik, ağırlıklı bir düzenleme uzaklığıdır (Damerau-Levenshtein, bitişik harf yer değiştirmesi dahil):
- Ünlü atlama ucuzdur ("zmn" → "zaman", "kza" → "koza", "yaptrdı" → "yaptırdı"): ünlüsüz kısaltma yaygındır.
- Türkçe Q klavyede komşu tuşlar ucuz yer değiştirir ("kubne" → "kubbe", "nmari" → "mimari").
- Bitişik harf yer değiştirmesi ucuzdur ("ahnn" → "hanın", "kubeb" → "kubbe").
Sözcük sonundaki Türkçe ek korunur ("deprmde" → "deprem" + "de"). Eser adları ayrıca çok sözcüklü ad olarak da bulanık
eşleştirilir ("muradiye medreswsi" → "muradiye medresesi").

Türkçe karakter (ı/i, ş/s, ç/c, ğ/g, ö/o, ü/u) ve büyük/küçük harf farkları `fold` ile zaten ortadan kalkar.
"""

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

from .text import fold

STEM_LEN = 5
SAFE_COST = 0.5  # bu maliyete kadar (tek ünlü eksikliği, komşu tuş, yer değiştirme) düzeltme güvenli sayılır
VOWELS = frozenset("aeiou")
# Türkçe Q klavye (katlanmış harflerle: ı→i, ğ→g, ü→u, ş→s, ö→o, ç→c).
_ROWS = ("qwertyuıopğü", "asdfghjklşi", "zxcvbnmöç")


def _neighbours() -> dict[str, frozenset[str]]:
    """Komşu tuşlar: aynı sırada sağ/sol; sıralar sağa kaydığı için üst sırada aynı ve sağdaki, alt sırada soldaki ve
    aynı sütun ("n": b, m, h, j)."""
    grid = [[fold(c) or c for c in row] for row in _ROWS]
    out: dict[str, set[str]] = {}
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            cells = [(r, c - 1), (r, c + 1), (r - 1, c), (r - 1, c + 1), (r + 1, c - 1), (r + 1, c)]
            near = {grid[rr][cc] for rr, cc in cells if 0 <= rr < len(grid) and 0 <= cc < len(grid[rr])}
            out.setdefault(ch, set()).update(near - {ch})
    return {k: frozenset(v) for k, v in out.items()}


NEAR = _neighbours()

# Sözcük sonunda korunacak yaygın Türkçe ekler (katlanmış). Uzun ekler önce denenir.
SUFFIXES = tuple(sorted({
    "i", "u", "a", "e", "in", "un", "nin", "nun", "si", "su", "sini", "sinin", "sinde", "sindeki", "sine", "ni", "nu",
    "de", "da", "te", "ta", "den", "dan", "ten", "tan", "nde", "nda", "ndeki", "ndaki", "ndan", "nden", "deki", "daki",
    "ki", "ye", "ya", "yi", "yu", "le", "la", "yle", "yla", "ler", "lar", "leri", "lari", "lerin", "larin", "lerinde",
    "larinda", "dir", "dur", "tir", "tur", "mi", "mu", "li", "lu", "ini", "unu", "ina", "ine", "inda", "inde", "indeki",
    "indaki", "inin", "unun", "yi", "ydi", "ymis",
}, key=len, reverse=True))

# Soru kalıplarının sözcükleri: kısa kısaltmalar ("kc", "vr") yalnızca bunlara düzeltilir.
_QUESTION_RAW = (
    "kim kimdir kimin kimler kimdi ne neden nedir neler nerede nerde nasıl hangi kaç zaman var yok mı mi mu mü midir "
    "yapıldı yapılmış yaptırdı yaptırmış yaptı yapti inşa edildi kuruldu ne zaman sayısı tane yılında yüzyıl "
    "kullanılıyor kullanıldı gömülü gömüldü yatıyor olarak bugün hâlâ adı isim mimarı mimari ustası kubbe minare "
    "avlu türbe türbesi cami camii camisi camiyi caminin camide han hanı hanın hanında medrese medresesi bedesten "
    "bedesteni restore restorasyon onarım deprem yangın yeniden")
QUESTION_WORDS = frozenset(fold(_QUESTION_RAW).split())

# Eser türü sözcüklerinin sık kullanılan ekli biçimleri (katalog metninde geçmeyebilir).
_TYPE_RAW = (
    "cami camii camisi camiyi caminin camiine camiinin camide camideki camiye türbe türbesi türbesini türbesinin "
    "türbesinde türbeyi türbenin türbede han hanı hanın hanını hanında hana handa medrese medresesi medresesinin "
    "medresesini medresede bedesten bedesteni bedestenin bedestende kubbe kubbesi kubbeyi kubbesinin minare minaresi "
    "minber minberi mihrap mihrabı avlu avlusu avlusunda mimar mimarı camisini camisinin")
TYPE_FORMS = frozenset(fold(_TYPE_RAW).split())


def _lower_tr(w: str) -> str:
    return w.replace("I", "ı").replace("İ", "i").lower()


def _skeleton_insert_cost(a: str, b: str) -> float | None:
    """`a`, `b`'den yalnızca ünlüler atılarak elde edilmişse ("zmn" ← "zaman") ucuz maliyet; değilse None."""
    if len(a) >= len(b):
        return None
    i = 0
    missing = 0
    for ch in b:
        if i < len(a) and a[i] == ch:
            i += 1
        elif ch in VOWELS:
            missing += 1
        else:
            return None
    return 0.35 * missing if i == len(a) else None


def wdist(a: str, b: str, limit: float = 9.0) -> float:
    """`a` (sorgudaki sözcük) ile `b` (sözlük sözcüğü) arasındaki ağırlıklı düzenleme uzaklığı."""
    if a == b:
        return 0.0
    sk = _skeleton_insert_cost(a, b)
    if sk is not None:
        return sk
    la, lb = len(a), len(b)
    if abs(la - lb) * 0.5 > limit:
        return limit + 1
    prev2 = None
    prev = [0.0] * (lb + 1)
    for j in range(1, lb + 1):
        prev[j] = prev[j - 1] + _ins(b, j - 1)
    for i in range(1, la + 1):
        cur = [prev[0] + _del(a, i - 1)] + [0.0] * lb
        for j in range(1, lb + 1):
            ca, cb = a[i - 1], b[j - 1]
            sub = 0.0 if ca == cb else (0.5 if cb in NEAR.get(ca, ()) else (0.75 if ca in VOWELS and cb in VOWELS else 1.0))
            v = min(prev[j] + _del(a, i - 1), cur[j - 1] + _ins(b, j - 1), prev[j - 1] + sub)
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb and ca != cb:
                v = min(v, prev2[j - 2] + 0.5)
            cur[j] = v
        if min(cur) > limit:
            return limit + 1
        prev2, prev = prev, cur
    return prev[lb]


def _ins(b: str, j: int) -> float:
    """Sorguda eksik kalan harf: ünlü ucuz, çift harfin eksiği ("kube" → "kubbe") ucuz."""
    if j > 0 and b[j] == b[j - 1]:
        return 0.5
    return 0.5 if b[j] in VOWELS else 1.0


def _del(a: str, i: int) -> float:
    """Sorguda fazla olan harf: aynı harfin tekrarı ("kubbbe") ucuz."""
    return 0.25 if i > 0 and a[i] == a[i - 1] else 0.75


def _same_start(a: str, b: str) -> bool:
    """Ön eleme: ilk harf aynı, komşu tuş ya da ilk iki harf yer değiştirmiş ("ahnn" ~ "han")."""
    return a[0] == b[0] or b[0] in NEAR.get(a[0], ()) or (len(a) > 1 and len(b) > 1 and (a[1] == b[0] or a[0] == b[1]))


def max_cost(length: int) -> float:
    if length <= 2:
        return 0.35
    if length <= 4:
        return 0.75
    if length == 5:
        return 1.0
    if length <= 7:
        return 1.25
    return 1.5


@dataclass(frozen=True)
class Change:
    original: str
    corrected: str
    cost: float
    ambiguous: bool = False


@dataclass
class Correction:
    original: str
    text: str  # katlanmış, düzeltilmiş arama metni
    display: str  # ziyaretçiye gösterilecek okunur biçim
    changes: list[Change] = field(default_factory=list)
    content_tokens: int = 0

    @property
    def changed(self) -> bool:
        return bool(self.changes)

    @property
    def max_cost(self) -> float:
        return max((c.cost for c in self.changes), default=0.0)

    @property
    def ambiguous(self) -> bool:
        return any(c.ambiguous for c in self.changes)

    @property
    def changed_ratio(self) -> float:
        """İçerik sözcüklerinden harf değiştirerek/ekleyerek düzeltilenlerin oranı. Yalnızca ünlü eklenen düzeltmeler
        ("yaptrdı", "mimrı") neredeyse kesin olduğu için sayılmaz."""
        costly = [c for c in self.changes if c.cost > SAFE_COST]
        return len(costly) / self.content_tokens if self.content_tokens else 0.0

    def confident(self) -> bool:
        """Düzeltme, cevabı doğrudan göstermek için yeterince güvenli mi? Değilse ziyaretçiye açıklama sorusu sorulur.
        Bir düzeltme belirsizse, pahalıysa ya da içerik sözcüklerinin yarısından fazlası harf değiştirilerek
        düzeltildiyse ("kza ahnn nmari") güvenli sayılmaz."""
        every = self.content_tokens >= 2 and len(self.changes) >= self.content_tokens  # "kza hn": sorunun tamamı tahmin
        return not self.ambiguous and self.max_cost <= 1.0 and self.changed_ratio <= 0.5 and not every


class Speller:
    def __init__(self, texts: Iterable[str], names: Iterable[str] = (), function_words: Iterable[str] = (),
                 is_word: Optional[Callable[[str], bool]] = None):
        """`texts`: onaylı katalog metinleri; `names`: eser adları (katalogdaki ve katalog dışı bilinen eserler);
        `function_words`: soru çözümlemesinin sözcükleri (soru kalıpları, durak sözcükler, kavramlar);
        `is_word`: genel Türkçe sözcük denetimi (Zemberek/`zeyrek`, bkz. `guide.lexicon`). Katalogda geçmeyen ama doğru
        yazılmış sözcükler ("nereli", "şehirden") başka bir katalog sözcüğüne çevrilmez; yoksa yalnızca katalog
        sözlüğü kullanılır."""
        self.is_word = is_word
        freq: Counter = Counter()
        surface: dict[str, Counter] = {}
        for t in texts:
            for k, raw in enumerate(re.findall(r"[\wÂÎÛâîû'’]+", t)):
                w = fold(raw)
                if not w or " " in w or w.isdigit():
                    continue
                freq[w] += 1
                # Cümle başındaki büyük harf ad değildir; okunur biçim için cümle içi kullanım tercih edilir.
                surface.setdefault(w, Counter())[raw.replace("’", "'")] += 1 if k else 0.5
        self.alias_words: set[str] = set()
        self.aliases: list[tuple[str, ...]] = []
        for n in names:
            toks = tuple(fold(n).split())
            if toks:
                self.aliases.append(toks)
                self.alias_words.update(toks)
                for w in toks:
                    freq[w] += 30
        # Türkçe karakterli biçimler önce gelir: okunur biçim ("nasıl") katlanmış biçimden ("nasil") önce kaydedilir.
        for w in dict.fromkeys([*_QUESTION_RAW.split(), *_TYPE_RAW.split(), *function_words]):
            for x in fold(w).split():
                freq[x] += 20
                if " " not in w and x not in surface:
                    surface[x] = Counter({w: 1})
        self.freq = freq
        self.vocab = frozenset(w for w in freq if len(w) >= 2 or w in QUESTION_WORDS)
        self.stems = frozenset(w[:STEM_LEN] for w in self.vocab if len(w) >= STEM_LEN)
        self._by_len: dict[int, list[str]] = {}
        for w in self.vocab:
            self._by_len.setdefault(len(w), []).append(w)
        # Okunur biçim: katalogdaki en sık yazım; eser adı sözcüğü değilse küçük harfle.
        self._surface = {w: (v if w in self.alias_words else _lower_tr(v))
                         for w, c in surface.items() for v in [c.most_common(1)[0][0]]}
        self.aliases.sort(key=lambda t: -len(t))
        self._cache: dict[str, tuple[str, float, bool] | None] = {}

    # --- Sözcük düzeyi ----------------------------------------------------------------------------------------------

    def known_form(self, w: str) -> bool:
        """Sözlükte ya da sözlükteki bir sözcük + Türkçe ek ("türbeyi", "muradiyedeki")."""
        if w in self.vocab or w.isdigit() or len(w) <= 1:
            return True
        return any(w.endswith(s) and len(w) - len(s) >= 3 and w[: -len(s)] in self.vocab for s in SUFFIXES)

    def known(self, w: str) -> bool:
        if self.known_form(w):
            return True
        # Uzun ekli biçim: arama zaten ilk beş harfle eşleşir ("kullanılmakta" ~ "kullanılmaktadır").
        return len(w) >= 6 and w[:STEM_LEN] in self.stems

    def _score(self, cost: float, cand: str) -> float:
        return cost - 0.06 * math.log1p(self.freq[cand])

    def suggest(self, w: str) -> tuple[str, float, bool] | None:
        """(düzeltilmiş sözcük, maliyet, belirsiz mi) ya da düzeltme yoksa None."""
        if w not in self._cache:
            if len(self._cache) > 4096:
                self._cache.clear()
            self._cache[w] = self._suggest(w)
        return self._cache[w]

    def _name_vowel(self, w: str) -> str | None:
        """Bir eser adı sözcüğünden yalnızca bir ünlüsü eksik sözcük ("muradye" → "muradiye"). Ekli biçim sayılmasına
        ("murad" + "ye") rağmen ad tercih edilir: adın kendisi daha olası, yanlış eser seçimi daha zararlıdır."""
        if len(w) < 5:
            return None
        hits = [a for a in self.alias_words if len(a) == len(w) + 1 and _skeleton_insert_cost(w, a) is not None]
        return hits[0] if len(hits) == 1 else None

    def _split(self, w: str) -> str | None:
        """Bitişik yazılmış eser adı ("osmangazi" → "osman gazi"): ilk parça bir eser adı sözcüğü, ikincisi bilinen bir
        sözcük olmalı."""
        if len(w) < 7:
            return None
        for i in range(3, len(w) - 2):
            if w[:i] in self.alias_words and len(w[:i]) >= 3 and self.known(w[i:]) and len(w[i:]) >= 3:
                return f"{w[:i]} {w[i:]}"
        return None

    def _suggest(self, w: str) -> tuple[str, float, bool] | None:
        best: dict[str, tuple[float, str]] = {}  # düzeltilmiş sözcük → (maliyet, sözlükteki gövde)
        # Sözcüğün tamamı ve ek ayrılmış gövdesi ayrı ayrı denenir ("deprmde" → "deprm" + "de").
        splits = [(w, "")] + [(w[: -len(s)], s) for s in SUFFIXES if w.endswith(s) and len(w) - len(s) >= 3]
        for base, suf in splits:
            # Sınır gövdenin uzunluğuna göredir: kısa gövdede tek harf değişikliği anlamı değiştirir ("ağaç" ≠ "amaç").
            limit = max_cost(len(base))
            for n in range(max(2, len(base) - 3), len(base) + 4):
                for cand in self._by_len.get(n, ()):
                    if len(w) <= 2 and cand not in QUESTION_WORDS:
                        continue  # "kc", "vr" gibi kısaltmalar yalnızca soru sözcüklerine düzeltilir
                    if not _same_start(base, cand):
                        continue
                    c = wdist(base, cand, limit)
                    out = cand + suf
                    if c <= limit and (out not in best or self._score(c, cand) < self._score(*best[out])):
                        best[out] = (c, cand)
        if not best:
            return None
        ranked = sorted(best.items(), key=lambda kv: (self._score(kv[1][0], kv[1][1]), kv[0]))
        (word, (cost, stem_word)) = ranked[0]
        # Belirsiz: başka bir sözcüğe giden ikinci aday neredeyse aynı derecede yakın ("kc" → "kac" / "koc").
        # İlk dört harfi aynı adaylar ("cami'yi" / "camii'yi") aynı sözcüğün biçimleri sayılır.
        ambiguous = any(o[:4] != word[:4] and self._score(oc, ob) - self._score(cost, stem_word) < 0.2
                        for o, (oc, ob) in ranked[1:3])
        return word, cost, ambiguous

    # --- Eser adı düzeyi ----------------------------------------------------------------------------------------------

    def _alias_token_cost(self, q: str, a: str) -> tuple[float, str] | None:
        """Sorgu sözcüğü ad sözcüğüne (ekiyle) karşılık geliyorsa (maliyet, düzeltilmiş sözcük)."""
        if q.startswith(a) and len(q) - len(a) <= 8:
            # "muradiyedeki" "Murad" adının ekli biçimi değildir: daha uzun bir ad sözcüğüyle başlıyor.
            if any(len(b) > len(a) and b.startswith(a) and q.startswith(b) for b in self.alias_words):
                return None
            return 0.0, q
        limit = max_cost(len(a))
        best = None
        for base, suf in [(q, "")] + [(q[: -len(s)], s) for s in SUFFIXES if q.endswith(s) and len(q) - len(s) >= 3]:
            c = wdist(base, a, limit)
            if c <= limit and (best is None or c < best[0]):
                best = (c, a + suf)
        return best

    def _fix_aliases(self, toks: list[str], words: frozenset[str] = frozenset()) -> list[tuple[int, float]]:
        """Çok sözcüklü eser adlarını bulanık eşleştirir; `toks` yerinde düzeltilir. (sözcük sırası, maliyet) döner.
        Bir sözcük dizisi bir ada zaten tam uyuyorsa ("muradiye camisini" ~ "Muradiye Cami") başka bir ada çevrilmez.
        `words`: sorudaki genel Türkçe sözlükte bulunan sözcükler (bilinen sayılır)."""
        found = []  # (başlangıç, uzunluk, toplam maliyet, düzeltilmiş sözcükler)
        for alias in self.aliases:
            k = len(alias)
            if k == 1 and len(alias[0]) < 6:
                continue  # tek ve kısa ad sözcükleri ("han", "hisar") bulanık eşleştirilmez
            for i in range(len(toks) - k + 1):
                res = [self._alias_token_cost(t, a) for t, a in zip(toks[i:i + k], alias)]
                if all(r is not None for r in res):
                    found.append((i, k, sum(r[0] for r in res), [r[1] for r in res]))
        exact = {(i, k) for i, k, c, _ in found if c == 0}
        out, taken = [], set()
        for i, k, c, new in sorted(found, key=lambda f: (-f[1], f[2])):
            span = set(range(i, i + k))
            if c == 0 or span & taken or any(s <= i and i + k <= s + n for s, n in exact):
                taken |= span if c == 0 else set()
                continue
            # Bütün sözcükleri (ekleriyle) bilinen dizi ("hasar", "muradiyedeki türbeyi") başka bir ada çevrilmez.
            if all(self.known_form(t) or t in words for t in toks[i:i + k]):
                continue
            taken |= span
            for j, (old_t, new_t) in enumerate(zip(toks[i:i + k], new)):
                if old_t != new_t:
                    toks[i + j] = new_t
                    out.append((i + j, wdist(old_t, new_t)))
        return out

    # --- Soru düzeyi --------------------------------------------------------------------------------------------------

    def _turkish_words(self, question: str) -> frozenset[str]:
        """Sorudaki, katalog sözlüğünde olmayan ama genel Türkçe sözlükte bulunan sözcükler (katlanmış biçimleriyle).
        Denetim Türkçe karakterli özgün yazımla yapılır ("şehirden"); kesme işaretinden sonraki ek sözcüğe bitişir."""
        if self.is_word is None:
            return frozenset()
        out: set[str] = set()
        for raw in re.findall(r"[\wÂÎÛâîû'’]+", question):
            w = fold(raw)
            if w and " " not in w and not w.isdigit() and not self.known(w) and self.is_word(re.sub(r"['’]", "", raw)):
                out.add(w)
        return frozenset(out)

    def correct(self, question: str, stop: frozenset[str] = frozenset()) -> Correction:
        orig = fold(question).split()
        toks = list(orig)
        words = self._turkish_words(question)
        cost: dict[int, float] = {}
        amb: set[int] = set()
        for i, w in enumerate(toks):
            if w not in self.vocab and (sp := self._split(w)):
                toks[i], cost[i] = sp, 0.35
                continue
            if w not in self.vocab and (name := self._name_vowel(w)):
                toks[i], cost[i] = name, 0.35
                continue
            if self.known(w):
                continue
            s = self.suggest(w)
            # Genel Türkçe sözlükteki sözcük yalnızca bir eser adı sözcüğüne veya soru sözcüğüne tek ucuz düzenlemeyle
            # gidiyorsa düzeltilir ("sutlan" → "sultan", "hab" → "han", "kin" → "kim"); "nereli", "şehirden" kalır.
            if w in words and not (s and s[1] <= SAFE_COST and (s[0] in self.alias_words or s[0] in QUESTION_WORDS)):
                continue
            if s is not None and s[0] != w:
                toks[i] = s[0]
                cost[i] = s[1]
                if s[2]:
                    amb.add(i)
        for i, c in self._fix_aliases(toks, words):
            cost[i] = cost.get(i, 0.0) + c
        changes = [Change(orig[i], toks[i], round(cost[i], 3), i in amb) for i in sorted(cost) if toks[i] != orig[i]]
        content = [w for w in orig if w not in stop and not w.isdigit()]
        toks = " ".join(toks).split()  # bitişik yazımdan ayrılan sözcükler
        return Correction(question, " ".join(toks), self.display(toks) if changes else question, changes,
                          content_tokens=len(content))

    def display(self, toks: list[str]) -> str:
        out = " ".join(self._surface.get(t, t) for t in toks)
        return out[:1].upper() + out[1:]
