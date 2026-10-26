"""Fotoğraf gözlem metninin yan cümle düzeyinde denetimi (Görev 32 gerçek Nemotron testlerinden).

Önceki denetim cümleyi bütün olarak tutuyor ya da atıyordu: tek bir bozuk sözcük ("medallon") veya tek bir malzeme
sözcüğü ("taş levha") yüzünden bir cümledeki bütün doğru gözlemler kayboluyordu. Burada:

1. Yazım: gerçek çıktılarda görülen ve niyeti açık hatalar düzeltilir (`lexicon.correct`). Bozuk bir sözcük sıfat
   dizisindeyse ("geniş, darbelemeli bir kubbe", "kalın ve dikmeşer taşıyıcılar") yalnızca o sözcük çıkarılır; başka
   yerdeyse içinde bulunduğu yan cümle düşer. Sözcük eklenmez, yalnızca çıkarılır.
2. Yan cümleler: cümle ";" ve yüklemden sonraki "ve" ile bölünür ("… kenarlık var ve duvar … tuğladan"). Her yan cümle
   ayrı denetlenir; yalnızca geçemeyen kısım düşer.
3. Bağlam kopması: düşen bir cümleye/yan cümleye gönderme yapan devam ("Üzerinde koyu renkli…", "Bunlar…",
   "Levhanın çevresinde…" — levha yalnızca düşen cümlede geçiyorsa) de gösterilmez. Eksik gönderme yeni sözcükle
   onarılmaz; yalnızca güvenilir gözlemlerle kısa bir açıklama kalır.
4. Malzeme: yapının/duvarın malzemesi yalnızca gerçek bir çekinceyle ("benziyor", "olabilir", "görünüyor") ve modelin
   ayrı malzeme alanlarıyla (material_guess, özellikler) tutarlıysa gösterilir. "Benzeri" çekince sayılmaz ("kesme tahta
   benzeri malzemelerle kaplanmış" bir malzeme hükmüdür). Model aynı fotoğraf için bir yerde "tahta", başka yerde "taş ve
   tuğla" diyorsa malzeme cümlesi gösterilmez. Bu tutarlılık denetimi doğruluğu kanıtlamaz; yalnızca kendisiyle
   çelişen tahmini ayıklar. Malzeme güvenilir değilse o ayrıntı atlanır.

Tarihî bilgi, tarih, kişi/yer adı, üslup ve görülmemiş öğe kuralları (`claims.py`, `service.py`) aynen uygulanır.
"""

import re
from dataclasses import dataclass, field
from typing import Callable, Optional

from ..ask.text import fold
from .claims import _materials
from .lexicon import correct

# Malzeme için gerçek çekince. "benzer/benzeri" yok: "taş benzeri malzeme" malzemeyi söyler, çekince bildirmez.
_MATERIAL_HEDGE = re.compile(r"olabilir|benziyor|benzemekte|gorunuyor|izlenimi|andiriyor|muhtemel")
_DEFINITIVE = re.compile(r"kesin|tamamen|tamamiyla|yapilmistir|insa edilmistir")
# Yan cümleyi bitiren yüklem (sonrasında "ve" yeni bir yan cümle başlatır).
# Geniş zaman ve -mış ekleri ("pencereler", "duvar", "yapılmış kapı") adlarla ve sıfatlarla karıştığı için sayılmaz.
_PREDICATE = re.compile(r"(\bvar|\byok|yor|d[iu]r|t[iu]r)$")
# Önceki cümleye gönderme yapan başlangıçlar: işaret/kişi zamirleri, bağlaçlar ve özne almamış konum sözcükleri
# ("Üzerinde", "İçinde", "Çevresinde": neyin üzerinde?). "Bu yapı/fotoğraf" bütün fotoğrafa gönderme yapar, serbesttir.
_ANAPHOR = re.compile(r"^(bunlar\w*|bunun|bunu|buna|bunda|bundan|onlar\w*|onun|ona|onu|onda|ondan|o|su|sunlar\w*|"
                      r"ayrica|ise|ancak|fakat|ama|diger\w*|oteki\w*|ikisi\w*|her ikisi\w*|"
                      r"(uzer|ust|ic|alt|yan|on|arka|cevre|etraf|orta|kenar|ara|dis|karsi)(ler)?s?[iu]n(de|da|den|dan|e|a)?)$")
_DEMONSTRATIVE = re.compile(r"^(bu|su|o) (?!yapi|bina|fotograf|goruntu|cami|mekan)")
_GENITIVE = re.compile(r"(n[iu]n|[iu]n|s[iu]n[iu]n|ler[iu]n|lar[iu]n)$")
# Bütün fotoğrafa/yapıya gönderme yapan adlar ("Yapının tamamı görünmediği için…") düşen bir cümleye bağlı değildir.
_WHOLE = ("yapi", "bina", "cami", "fotograf", "goruntu", "mekan", "duvar", "cephe")


@dataclass
class Filtered:
    text: str
    removed: list[dict] = field(default_factory=list)  # {"text", "reason"} — yalnızca iç ölçüm ve test için


def material_hedged(text: str) -> bool:
    f = fold(text)
    return bool(_MATERIAL_HEDGE.search(f)) and not _DEFINITIVE.search(f)


def clauses(sentence: str) -> list[str]:
    """Cümleyi bağımsız yan cümlelere böler: ";" ve yüklemle biten parçadan sonraki "ve"."""
    out = []
    for part in re.split(r"\s*;\s+", sentence):
        words, cur = part.split(" "), []
        for i, w in enumerate(words):
            if w == "ve" and cur and i + 1 < len(words) and _PREDICATE.search(fold(cur[-1])) and len(cur) >= 3:
                out.append(" ".join(cur))
                cur = []
                continue
            cur.append(w)
        if cur:
            out.append(" ".join(cur))
    return [c.strip() for c in out if c.strip()]


def _finish(clause: str) -> str:
    c = clause.strip().rstrip(",;")
    c = (c[0].replace("i", "İ").upper() if c[0] in "iı" else c[0].upper()) + c[1:]
    return c if c[-1] in ".!?" else c + "."


def drop_word(text: str, word: str) -> Optional[str]:
    """Bozuk sözcüğü yalnızca sıfat dizisinden çıkarır ("geniş, X bir kubbe" → "geniş bir kubbe"; "kalın ve X
    taşıyıcılar" → "kalın taşıyıcılar"). Dizide değilse None: sözcüğün işlevi bilinmeden çıkarılırsa cümle bozulur."""
    w = re.escape(word)
    for pat in (rf",\s*{w}(?=\s)", rf"\s+(?:ve|veya)\s+{w}(?=\s)", rf"(?<=\s){w},?\s+(?:ve|veya)\s+(?=\w)",
                rf"(?<=\s){w},\s+(?=\w)"):
        new, n = re.subn(pat, "", text, count=1)
        if n:
            return new
    return None


def _first_word(text: str) -> str:
    ws = fold(text).split()
    return ws[0] if ws else ""


def dangling(unit: str, removed_text: str, kept_text: str, after_removed: bool = True) -> bool:
    """Düşen bir birime gönderme yapan devam mı? `removed_text`: o ana kadar düşen bütün birimler; `after_removed`:
    hemen önceki birim düştü mü (zamir ve konum sözcüğüyle başlayan devam yalnızca o zaman sahipsiz kalır)."""
    f = fold(unit)
    first = _first_word(unit)
    if after_removed and (_ANAPHOR.match(first) or _DEMONSTRATIVE.match(f)):
        return True
    # "Levhanın çevresinde…": belirli ad yalnızca düşen birimde geçmişse gönderme boşa düşer.
    root = _GENITIVE.sub("", first)
    if len(root) >= 4 and first != root and not root.startswith(_WHOLE):
        in_removed = any(w.startswith(root) for w in fold(removed_text).split())
        in_kept = any(w.startswith(root) for w in fold(kept_text).split())
        return in_removed and not in_kept
    return False


class ObservationFilter:
    """`reason(text)` → None (gösterilebilir) veya düşme nedeni. Malzeme ve dil kuralları bu sınıftadır; tarihî
    bilgi ve ad kuralları dışarıdan `base_reason` ile verilir."""

    def __init__(self, base_reason: Callable[[str, bool], Optional[str]], lexicon=None, visible: str = "",
                 material_reference: str = ""):
        self.base_reason = base_reason
        self.lexicon = lexicon
        self.visible = visible
        # Modelin ayrı malzeme alanlarında söylediği malzemeler (material_guess + özellikler): açıklamadaki malzeme
        # bunlarla çelişirse gösterilmez. Boşsa yalnızca çekince aranır.
        self.material_ref = _materials(material_reference)

    def _broken(self, text: str) -> list[str]:
        if self.lexicon is None:
            return []
        return list(self.lexicon.unknown_words(text, self.visible))

    def _grammar(self, text: str) -> list[str]:
        fn = getattr(self.lexicon, "grammar_issues", None)
        return list(fn(text)) if fn else []

    def material_reason(self, text: str) -> Optional[str]:
        mats = _materials(text, objects_ok=True)
        if not mats:
            return None
        if not material_hedged(text):
            return "çekincesiz malzeme"
        if self.material_ref and not mats <= self.material_ref:
            return "modelin kendi malzeme tahminiyle çelişen malzeme"
        return None

    def reason(self, text: str, phrase: bool = False) -> Optional[str]:
        r = self.base_reason(text, phrase)
        if r == "fotoğraftan malzeme":
            r = "çekincesiz malzeme" if phrase else self.material_reason(text)
        if r:
            return r
        if self._broken(text):
            return "bozuk sözcük"
        if self._grammar(text):
            return "bozuk tamlama"
        return None

    def repair(self, text: str) -> str:
        """Yazım düzeltmesi ve sıfat dizisindeki bozuk sözcüğün çıkarılması."""
        t = correct(text)
        for _ in range(3):
            bad = self._broken(t)
            if not bad:
                break
            fixed = drop_word(t, bad[0])
            if fixed is None:
                break
            t = fixed
        return t

    def phrase(self, text: str) -> Optional[str]:
        """Kısa özellik etiketi: düzeltilmiş hâli gösterilebiliyorsa döner."""
        t = self.repair(text)
        return t if self.reason(t, phrase=True) is None else None

    def paragraph(self, sentences: list[str], extra: Callable[[str], Optional[str]] = lambda t: None) -> Filtered:
        """Cümleleri yan cümle düzeyinde süzer. `extra`: ek kural (ör. görülmemiş öğe) → neden ya da None."""
        kept, removed, removed_text, after_removed = [], [], "", False
        for s in sentences:
            units = clauses(s)
            good = []
            for u in units:
                fixed = self.repair(u)
                why = self.reason(fixed) or extra(fixed)
                if why is None and removed_text and dangling(fixed, removed_text, " ".join(kept + good), after_removed):
                    why = "bağlam kopması"
                after_removed = why is not None
                if why is None:
                    good.append(fixed)
                else:
                    removed.append({"text": u, "reason": why})
                    removed_text += " " + u
            if not good:
                continue
            if len(good) == len(units) and all(g == u for g, u in zip(good, units)):
                kept.append(s)  # hiçbir şey değişmediyse özgün cümle (noktalama ve bağlaçlarıyla) korunur
            elif len(good) == len(units) and len(units) == 1:
                kept.append(_finish(good[0]))
            else:
                kept.extend(_finish(g) for g in good)
        return Filtered(" ".join(kept), removed)


def _words(text: str) -> set[str]:
    return {w[:5] for w in fold(text).split() if len(w) > 2}


def repeats(sentence: str, previous: list[str], threshold: float = 0.6) -> bool:
    """Takip cevabındaki cümle önceki analizdeki bir cümlenin neredeyse aynısı mı (sözcük köklerinin örtüşmesi)?"""
    a = _words(sentence)
    if not a:
        return False
    return any(len(a & (b := _words(p))) / max(1, len(a | b)) >= threshold or (a <= b and len(a) >= 4) for p in previous)
