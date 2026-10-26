"""Türkçe soru ve olgu metinleri için normalleştirme, kelime ayırma ve kök kısaltma.

Kökler için Türkçe bilgi erişiminde yaygın "ilk beş harf" (F5) kısaltması kullanılır: "kubbeyle" → "kubbe",
"yaptırmıştır" → "yapti". Böylece ekli biçimler ek sözlüğü olmadan eşleşir.
"""

import re
import unicodedata

STEM_LEN = 5

_TR_UPPER = str.maketrans({"İ": "i", "I": "ı"})
_APOSTROPHES = re.compile(r"[’'`´ʼ]")


def fold(text: str) -> str:
    """Küçük harf, Türkçe İ/ı, aksan ve şapka temizliği; harf ve rakam dışı her şey boşluk olur."""
    t = str(text).translate(_TR_UPPER).lower().replace("ı", "i")
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    # Kesme işaretinden sonraki ek kelimeye bitişir: "Camii'ni" → "camiini" (ek ayrı bir kelime sayılmaz).
    t = _APOSTROPHES.sub("", t)
    # "1801de" → "1801 de": yıl, aldığı ekten ayrılır.
    t = re.sub(r"(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)", " ", t)
    return " ".join(re.findall(r"[a-z0-9]+", t))


def words(text: str) -> list[str]:
    return fold(text).split()


def stem(word: str) -> str:
    return word if word.isdigit() else word[:STEM_LEN]


def stems(text: str) -> list[str]:
    return [stem(w) for w in words(text)]


YEAR = re.compile(r"(?<!\d)(1[0-9]{3}|20[0-9]{2})(?!\d)")
NUMBER_WORDS = {
    "bir", "iki", "uc", "dort", "bes", "alti", "yedi", "sekiz", "dokuz", "on", "yirmi", "otuz", "kirk", "elli",
    "altmis", "yetmis", "seksen", "doksan", "yuz", "bin", "tek",
}
# Sayı ile isim arasında bulunabilen sıfatlar ("altı kalın paye"). Liste dışı kelime araya girerse sayı o isme ait sayılmaz
# ("iki katlı odalar" iki oda demek değildir).
COUNT_ADJECTIVES = {"kalin", "buyuk", "kucuk", "sade", "ana", "yeni", "eski", "ayri", "ince", "genis", "yuksek", "mermer", "ahsap"}


def has_year(text: str) -> bool:
    return bool(YEAR.search(text))


def _is_number(w: str) -> bool:
    return w.isdigit() or w in NUMBER_WORDS


def has_number(text: str) -> bool:
    return any(_is_number(w) for w in words(text))


_POLYGON = re.compile(r"(uc|dort|bes|alti|yedi|sekiz|dokuz|on|oniki|onalti)gen")


def counted_stems(text: str) -> frozenset[str]:
    """Sayısı belirtilen şeylerin kökleri: "yirmi kubbeyle" → {"kubbe"}, "öğrenci sayısı 14" → {"ogren"};
    "sekizgen" köşe ve kenar sayısını da bildirir."""
    ws = words(text)
    out = set()
    for i, w in enumerate(ws):
        if w == "bir":
            continue  # "bir sultan camisi": belirsizlik edatı, sayı değil
        # "sekizgen planlı" yapının köşe sayısını bildirir; "altıgen çiniler" bildirmez.
        if _POLYGON.match(w) and i + 1 < len(ws) and ws[i + 1].startswith("plan"):
            out.update({"kose", "kosel", "kenar"})
        if w.startswith("sayisi") and i > 0 and any(_is_number(x) for x in ws[i + 1:i + 3]):
            out.add(stem(ws[i - 1]))
        if not _is_number(w) and i > 0 and _is_number(ws[i - 1]) and ws[i - 1] != "bir":
            out.add(stem(w))
        elif not _is_number(w) and i > 1 and _is_number(ws[i - 2]) and ws[i - 1] in COUNT_ADJECTIVES:
            out.add(stem(w))
    return frozenset(out)
