"""Kaynak PDF'lerinden sayfa metni ve alıntı denetimi.

Sayfa numarası her yerde **fiziksel PDF sayfasıdır** (1 tabanlı); basılı sayfa numarası türetilmez (V20 kuralıyla aynı).
Alıntı denetimi, PDF metin çıkarımındaki boşluk, satır sonu ve heceleme farklarını yok sayan `squash` biçimiyle yapılır
(`scripts/build_internal_manifests.py` ile aynı kural).
"""

import logging
import re
import unicodedata
from io import BytesIO
from typing import Optional

logging.getLogger("pypdf").setLevel(logging.ERROR)  # yazı tipi kodlama uyarıları sayfa metnini etkilemez, günlüğü boğar


class PdfError(ValueError):
    pass


def squash(text: str) -> str:
    """Karşılaştırma biçimi: NFKC, tırnak birliği, küçük harf; harf ve rakam dışı her şey (boşluk, tire, satır sonu) atılır."""
    text = unicodedata.normalize("NFKC", text or "").replace("’", "'").replace("‘", "'").casefold()
    return re.sub(r"[\W_]+", "", text)


def extract_pages(data: bytes) -> list[str]:
    """PDF'in her fiziksel sayfasının metni (sıra = sayfa - 1). Metin katmanı olmayan sayfa boş metindir."""
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError as e:  # pragma: no cover - requirements.txt'de var
        raise PdfError("PDF okuyucu (pypdf) kurulu değil.") from e
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            raise PdfError("Şifreli PDF okunamaz.")
        return [_clean(p.extract_text() or "") for p in reader.pages]
    except PdfReadError as e:
        raise PdfError("PDF okunamadı.") from e


def _clean(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("\x00", "")
    return re.sub(r"[ \t]+\n", "\n", text).strip()


def quote_page(pages: list[str], page: int, quote: str) -> Optional[int]:
    """Alıntının bulunduğu sayfa: önce belirtilen sayfa, sonra bitişik sayfalar. Bulunamazsa `None`."""
    q = squash(quote)
    if not q:
        return None
    for p in (page, page - 1, page + 1):
        if 1 <= p <= len(pages) and q in squash(pages[p - 1]):
            return p
    return None


_FOLD = str.maketrans({"İ": "i", "I": "i", "ı": "i", "Ş": "s", "ş": "s", "Ğ": "g", "ğ": "g", "Ü": "u", "ü": "u",
                       "Ö": "o", "ö": "o", "Ç": "c", "ç": "c", "Â": "a", "â": "a", "Î": "i", "î": "i", "Û": "u", "û": "u"})


def fold(text: str) -> str:
    """Harf sayısını koruyan arama biçimi: Türkçe harfler ve şapkalar katlanır, küçük harfe çevrilir (kesit konumu bozulmaz)."""
    return "".join(c if len(c.lower()) != 1 else c.lower() for c in text.translate(_FOLD))


def search(pages: list[str], query: str, limit: int = 30) -> list[dict]:
    """Sorgunun geçtiği sayfalar ve kısa bir kesit (büyük/küçük harf ve Türkçe harf duyarsız)."""
    q = query.strip()
    if len(q) < 2:
        return []
    needle = fold(q)
    hits = []
    for i, text in enumerate(pages, start=1):
        low = fold(text)
        at = low.find(needle)
        if at < 0:
            continue
        start, end = max(0, at - 80), min(len(text), at + len(q) + 80)
        snippet = re.sub(r"\s+", " ", text[start:end]).strip()
        hits.append({"page": i, "snippet": ("…" if start else "") + snippet + ("…" if end < len(text) else "")})
        if len(hits) >= limit:
            break
    return hits
