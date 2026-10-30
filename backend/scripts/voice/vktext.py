"""Seslendirme metni (30 Ekim, ses klonu): yazılı anlatım cümlesini modelin doğru okuyacağı biçime çevirir ve üretilen sesin
yazıya dökümünü metinle karşılaştırır. Saf Python; model gerektirmez (backend testleri de kullanır).

Yalnızca **okunuş** değişir (rakam → sözcük, "II." → "İkinci", "×" → "çarpı"); anlam ve sözcükler aynı kalır. Dosya adı
her zaman özgün metinden hesaplanır (sunucunun aradığı ad).
"""

import re
import unicodedata
from difflib import SequenceMatcher

# --- Türkçe sayılar -------------------------------------------------------------------------------------------------
_TR_ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"]
_TR_TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"]
_TR_ORD = {"bir": "birinci", "iki": "ikinci", "üç": "üçüncü", "dört": "dördüncü", "beş": "beşinci", "altı": "altıncı",
           "yedi": "yedinci", "sekiz": "sekizinci", "dokuz": "dokuzuncu", "on": "onuncu", "yirmi": "yirminci",
           "otuz": "otuzuncu", "kırk": "kırkıncı", "elli": "ellinci", "altmış": "altmışıncı", "yetmiş": "yetmişinci",
           "seksen": "sekseninci", "doksan": "doksanıncı", "yüz": "yüzüncü", "bin": "bininci", "milyon": "milyonuncu",
           "sıfır": "sıfırıncı"}
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}


def _tr_below_1000(n: int) -> list[str]:
    h, rest = divmod(n, 100)
    words = ([] if h == 0 else (["yüz"] if h == 1 else [_TR_ONES[h], "yüz"]))
    t, o = divmod(rest, 10)
    return words + [w for w in (_TR_TENS[t], _TR_ONES[o]) if w]


def tr_number(n: int) -> str:
    """1399 → "bin üç yüz doksan dokuz" (Türkçede "bir bin" denmez)."""
    if n == 0:
        return "sıfır"
    words: list[str] = []
    millions, rest = divmod(n, 1_000_000)
    if millions:
        words += _tr_below_1000(millions) + ["milyon"]
    thousands, rest = divmod(rest, 1000)
    if thousands:
        words += (["bin"] if thousands == 1 else _tr_below_1000(thousands) + ["bin"])
    return " ".join(words + _tr_below_1000(rest))


def tr_ordinal(n: int) -> str:
    """19 → "on dokuzuncu"."""
    words = tr_number(n).split()
    words[-1] = _TR_ORD[words[-1]]
    return " ".join(words)


# --- İngilizce sayılar ----------------------------------------------------------------------------------------------
_EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
            "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
_EN_ORD = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth",
           "twelve": "twelfth"}


def _en_below_100(n: int) -> str:
    if n < 20:
        return _EN_ONES[n]
    t, o = divmod(n, 10)
    return _EN_TENS[t] + (f"-{_EN_ONES[o]}" if o else "")


def en_number(n: int, year: bool = False) -> str:
    """1399 → "thirteen ninety-nine" (yıl), 55 → "fifty-five"."""
    if year and 1100 <= n <= 1999 and n % 100 == 0:
        return f"{_en_below_100(n // 100)} hundred"
    if year and 1100 <= n <= 1999:
        return f"{_en_below_100(n // 100)} {_en_below_100(n % 100)}" if n % 100 >= 10 else \
            f"{_en_below_100(n // 100)} oh {_EN_ONES[n % 100]}"
    if n < 100:
        return _en_below_100(n)
    parts = []
    thousands, rest = divmod(n, 1000)
    if thousands:
        parts.append(en_number(thousands) + " thousand")
    h, rest = divmod(rest, 100)
    if h:
        parts.append(_EN_ONES[h] + " hundred")
    if rest:
        parts.append(("and " if parts else "") + _en_below_100(rest))
    return " ".join(parts)


def en_ordinal(n: int) -> str:
    words = en_number(n)
    head, _, last = words.rpartition(" ")
    last_head, dash, last_tail = last.rpartition("-")
    base = last_tail if dash else last
    if base in _EN_ORD:
        ordinal = _EN_ORD[base]
    elif base.endswith("y"):
        ordinal = base[:-1] + "ieth"
    else:
        ordinal = base + "th"
    last = f"{last_head}-{ordinal}" if dash else ordinal
    return f"{head} {last}".strip()


def _tr_cap(w: str) -> str:
    """Türkçe büyük harf: ikinci → İkinci, ılıca → Ilıca."""
    return {"i": "İ", "ı": "I"}.get(w[:1], w[:1].upper()) + w[1:]


# --- Okunuş ---------------------------------------------------------------------------------------------------------
def speakable(text: str, lang: str) -> str:
    """Yazılı cümleyi okunacak biçime çevirir."""
    s = text.replace(" ", " ")
    if lang == "tr":
        s = re.sub(r"\b(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\.\s+(?=[A-ZÇĞİÖŞÜ])",
                   lambda m: _tr_cap(tr_ordinal(_ROMAN[m.group(1)])) + " ", s)
        s = re.sub(r"%\s?(\d+)", lambda m: "yüzde " + m.group(1), s)
        s = re.sub(r"(\d+)\s*×\s*(\d+)", r"\1 çarpı \2", s)
        s = re.sub(r"(\d+)\s*[–—-]\s*(?=\d)", r"\1 ile ", s)
        s = re.sub(r"\b(\d+)\.\s+(?=[a-zçğıöşü])", lambda m: tr_ordinal(int(m.group(1))) + " ", s)
        s = re.sub(r"\b(\d+)['’]([a-zçğıöşü]+)", lambda m: tr_number(int(m.group(1))) + m.group(2), s)
        s = re.sub(r"\b\d+\b", lambda m: tr_number(int(m.group(0))), s)
    else:
        s = re.sub(r"\b([A-Z][a-z]+) (II|III|IV|V|VI)\b", lambda m: f"{m.group(1)} the {en_ordinal(_ROMAN[m.group(2)]).capitalize()}", s)
        s = re.sub(r"(\d+)\s?%", lambda m: m.group(1) + " percent", s)
        s = re.sub(r"(\d+)\s*×\s*(\d+)", r"\1 by \2", s)
        s = re.sub(r"(\d+)\s*[–—-]\s*(?=\d)", r"\1 to ", s)
        s = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: en_ordinal(int(m.group(1))), s)
        s = re.sub(r"\b\d{4}\b", lambda m: en_number(int(m.group(0)), year=True), s)
        s = re.sub(r"\b\d+\b", lambda m: en_number(int(m.group(0))), s)
    s = re.sub(r"\s+", " ", s).strip()
    # Rakamla başlayan cümle sözcükle başlar: büyük harf.
    cap = _tr_cap if lang == "tr" else (lambda w: w[:1].upper() + w[1:])
    return re.sub(r"(^|[.!?…]\s+)([a-zçğıöşü])", lambda m: m.group(1) + cap(m.group(2)), s)


def sentences(text: str, max_len: int = 260) -> list[str]:
    """Cümlelere böler (model uzun metinde bozulur). Çok uzun cümle noktalı virgül / iki nokta / virgülden ikiye ayrılır."""
    parts = [p.strip() for p in re.split(r"(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ\"'“])", text) if p.strip()]
    out: list[str] = []
    for p in parts:
        while len(p) > max_len:
            cut = max((p.rfind(sep, 0, max_len) for sep in ("; ", ": ", ", ")), default=-1)
            if cut < max_len // 3:
                break
            out.append(p[: cut + 1].strip())
            p = p[cut + 1:].strip()
        out.append(p)
    return out


def _fold(s: str, lang: str) -> str:
    if lang == "tr":
        s = s.replace("I", "ı").replace("İ", "i")
    s = s.lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn" or ch in "̇")  # â î û → a i u
    s = s.replace("̇", "")
    return re.sub(r"[^\w]+", "", s)


def compare(expected: str, heard: str, lang: str) -> tuple[float, float]:
    """(benzerlik 0–1, duyulan/ beklenen uzunluk oranı). İkisi de okunuşa çevrilip boşluk ve noktalama atılarak karşılaştırılır."""
    a, b = _fold(speakable(expected, lang), lang), _fold(speakable(heard, lang), lang)
    if not a:
        return 0.0, 0.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio(), len(b) / len(a)


def best_cut(expected: str, words: list[tuple[str, float]], lang: str) -> tuple[int, float]:
    """Sona eklenen uydurma için: beklenen metni en iyi karşılayan ilk k kelime (k, benzerlik). `words` = (kelime, bitiş sn)."""
    best_k, best_r = len(words), -1.0
    for k in range(1, len(words) + 1):
        r, _ = compare(expected, " ".join(w for w, _ in words[:k]), lang)
        if r > best_r + 1e-9:
            best_k, best_r = k, r
    return best_k, best_r
