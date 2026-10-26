"""Görsel gözlemde bozuk Türkçe sözcük denetimi.

Model zaman zaman Türkçe olmayan sözcükler üretir (gerçek testlerde "okşu", "duşarlı", "kesmeköprüsü", "kaminler").
Bu sözcükleri taşıyan gözlem cümlesi veya özellik gösterilmez. Denetim, Zemberek sözlüğünün Python uyarlaması `zeyrek`
ile biçimbilimsel çözümleme yapar: kök ve ekleriyle çözümlenemeyen sözcük bilinmeyen sayılır. Onaylı katalog
metinlerindeki sözcükler ve mimari terimler (ör. "mukarnas", "şerefe") sözlükte olmasa da geçerlidir.

Sınırlar: gerçek ama yanlış yerde kullanılan sözcükleri ("tipler", "kirişli") yakalayamaz; anlam denetimi yapmaz.
`zeyrek` kurulu değilse veya henüz yüklenmediyse denetim yapılmaz (hiçbir cümle bu nedenle silinmez) — bu bir kalite
denetimidir, güvenlik denetimi değil; tarihî iddia denetimi `claims.py`'dedir.
"""

import logging
import re
import threading
from typing import Iterable

logger = logging.getLogger("vakifname.guide")

# Sözlükte bulunmayabilen mimari ve tarihî terimler (ekli biçimleri de geçerli sayılır: önek eşleşmesi).
DOMAIN_TERMS = ("mukarnas", "şerefe", "kündekâri", "kündekari", "revak", "şadırvan", "mihrap", "mihrab", "minber", "kasnak",
                "tonoz", "pandantif", "tromp", "payanda", "çörten", "kitabe", "alem", "külah", "almaşık", "sebil", "imaret",
                "eyvan", "mahfil", "hünkâr", "son cemaat", "pencereli", "kemerli", "kubbeli", "minareli", "revaklı",
                "medrese", "türbe", "külliye", "bedesten", "kervansaray", "hamam", "çeşme", "selsebil", "rozet", "silme",
                "kornişli", "korniş", "saçak", "çatı", "kiremit", "kurşun", "levha", "pano", "kemer", "sütun", "başlık")

_LOOSE = {"Abbreviation", "ProperNoun"}
_WORD = re.compile(r"[A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû]+")


def _lower_tr(w: str) -> str:
    return w.replace("I", "ı").replace("İ", "i").lower()


def _plain(w: str) -> str:
    return _lower_tr(w).replace("â", "a").replace("î", "i").replace("û", "u")


class TurkishLexicon:
    def __init__(self, extra_words: Iterable[str] = (), background: bool = True, analyzer=None):
        self._known = {_plain(w) for t in extra_words for w in _WORD.findall(t)}
        self._domain = tuple(_plain(t) for t in DOMAIN_TERMS)
        self._analyzer = analyzer
        self.state = "ready" if analyzer is not None else "loading"
        self._lock = threading.Lock()
        if analyzer is None:
            if background:
                threading.Thread(target=self._load, name="guide-lexicon", daemon=True).start()
            else:
                self._load()

    def add_words(self, texts: Iterable[str]):
        with self._lock:
            self._known |= {_plain(w) for t in texts for w in _WORD.findall(t)}

    def _load(self):
        try:
            logging.getLogger("zeyrek").setLevel(logging.ERROR)
            import zeyrek  # noqa: PLC0415 — ağır sözlük, uygulama açılışını geciktirmesin

            analyzer = zeyrek.MorphAnalyzer()
        except Exception as e:  # kurulu değil veya sözlük okunamadı: denetim kapalı
            self.state = "unavailable"
            logger.warning("guide lexicon unavailable (%s); broken-word check disabled", type(e).__name__)
            return
        with self._lock:
            self._analyzer, self.state = analyzer, "ready"

    def _parses(self, w: str) -> bool:
        try:
            return any(a is not None for a in self._analyzer._parse(w))
        except Exception:  # çözümleyici iç hatası: sözcüğü bilinmeyen saymayız
            return True

    def is_word(self, w: str) -> bool:
        """Yalnızca biçimbilimsel çözümleme: geçerli bir Türkçe sözcük mü ("nereli", "şehirden")? Katalog sözcükleri
        sayılmaz. Yazım düzeltmesi, doğru yazılmış ama katalogda geçmeyen sözcüğü değiştirmesin diye kullanır.
        Kısaltma ve tahmin edilmiş özel ad çözümlemeleri sayılmaz: "hnin" ("H" + "nin") veya "sehirden" ("Sehir") bir
        yazım hatasını geçerli gösterebilir. Denetim hazır değilse False (düzeltme eskisi gibi çalışır)."""
        if self.state != "ready" or len(w) < 3:
            return False
        try:
            return any(a is not None and str(a.dict_item.secondary_pos).rsplit(".", 1)[-1] not in _LOOSE
                       for a in self._analyzer._parse(_lower_tr(w)))
        except Exception:  # çözümleyici iç hatası: sözcük geçerli sayılmaz, düzeltme denenir
            return False

    def unknown_words(self, text: str, allowed: str = "") -> list[str]:
        """Metindeki çözümlenemeyen sözcükler. `allowed`: fotoğrafta okunan yazı gibi her zaman serbest metin.
        Denetim hazır değilse boş liste döner."""
        if self.state != "ready":
            return []
        free = {_plain(w) for w in _WORD.findall(allowed)}
        out = []
        for raw in _WORD.findall(text):
            if len(raw) < 3 or raw.isupper():  # kısaltma veya levhadaki büyük harfli yazı
                continue
            w = _plain(raw)
            if w in self._known or w in free or w.startswith(self._domain):
                continue
            if not self._parses(_lower_tr(raw)) and not self._parses(w):
                out.append(raw)
        return out

    def ok(self, text: str, allowed: str = "") -> bool:
        return not self.unknown_words(text, allowed)

