"""Görsel gözlemde bozuk Türkçe sözcük denetimi.

Model zaman zaman Türkçe olmayan sözcükler üretir (gerçek testlerde "okşu", "duşarlı", "kesmeköprüsü", "kaminler").
Bu sözcükleri taşıyan gözlem cümlesi veya özellik gösterilmez. Denetim, Zemberek sözlüğünün Python uyarlaması `zeyrek`
ile biçimbilimsel çözümleme yapar: kök ve ekleriyle çözümlenemeyen sözcük bilinmeyen sayılır. Onaylı katalog
metinlerindeki sözcükler ve mimari terimler (ör. "mukarnas", "şerefe") sözlükte olmasa da geçerlidir.

Görev 32 gerçek testlerinde çözümleyicinin geçerli saydığı ama mimari betimlemede yanlış olan sözcükler de çıktı
("darbelemeli" — sözlükte "darbelemek" fiili var; "avla" — "avlamak" fiilinin emri; "medallon"). Bunlar için yalnızca
gerçek çıktılarda görülen küçük bir liste tutulur: niyet açıksa düzeltilir ("medallon" → "madalyon", "avla" → "avlu"),
değilse sözcük bozuk sayılır. Ayrıca tamlama uyumu denetlenir: ilgi ekli adın hemen ardından iyeliksiz ama hâl ekli bir ad
gelirse ("duvarın dokuyu"; doğrusu "duvarın dokusunu") ifade bozuk sayılır. Arada ortaçlı yan cümle varsa ("caminin
avluya açılan kapısı") tamlamanın başı sonra geldiği için denetlenmez.

Sınırlar: gerçek ama yanlış yerde kullanılan sözcüklerin çoğunu ("tipler", "kirişli", "tekerlek şeklinde") yakalayamaz;
anlam denetimi yapmaz. Doğal Türkçe için asıl önlem istemdir (`prompts.py`); bu denetim son bir süzgeçtir.
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
                "kornişli", "korniş", "saçak", "çatı", "kiremit", "kurşun", "levha", "pano", "kemer", "sütun", "başlık",
                "paye", "kaligrafi", "kaligrafik", "madalyon", "palmet", "rumi", "kaburga", "dilimli", "istiridye", "ajur",
                "zencerek", "kabara", "bordür", "friz", "kartuş", "niş", "lento", "söve", "hatıl")

# Gerçek model çıktılarında görülen, çözümleyicinin geçerli saydığı ya da sözlükte bulunmayan hatalı sözcükler.
# Değer: niyet açıksa doğru yazım (yalnızca yazım düzeltilir, yeni ayrıntı eklenmez); None: bozuk sözcük (ifade düşer).
MODEL_ERRORS = {"medallon": "madalyon", "medallonu": "madalyonu", "medallonlu": "madalyonlu", "medallonlar": "madalyonlar",
                "avla": "avlu", "avlası": "avlusu", "avlaya": "avluya", "avlada": "avluda", "avladan": "avludan",
                "darbelemeli": None, "dikmeşer": None, "okşu": None, "okşulu": None, "duşarlı": None,
                "kesmeköprüsü": None, "kaminler": None}
_POSSESSIVE = {"P1sg", "P2sg", "P3sg", "P1pl", "P2pl", "P3pl"}
_CASES = {"Acc", "Dat", "Loc", "Abl", "Ins"}
_PARTICIPLES = ("PresPart", "PastPart", "FutPart", "AorPart", "NarrPart")
_TENSES = {"Aor", "Past", "Narr", "Prog1", "Prog2", "Fut", "Pres"}

_LOOSE = {"Abbreviation", "ProperNoun"}
_WORD = re.compile(r"[A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû]+")


def _lower_tr(w: str) -> str:
    return w.replace("I", "ı").replace("İ", "i").lower()


def _plain(w: str) -> str:
    return _lower_tr(w).replace("â", "a").replace("î", "i").replace("û", "u")


def correct(text: str) -> str:
    """Gerçek çıktılarda görülen ve niyeti açık yazım hatalarını düzeltir ("medallon" → "madalyon"). Sözlük gerekmez."""
    def fix(m):
        w = m.group(0)
        to = MODEL_ERRORS.get(_lower_tr(w))
        if not to:
            return w
        return to[0].upper() + to[1:] if w[0].isupper() else to
    return _WORD.sub(fix, text)


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
            if _lower_tr(raw) in MODEL_ERRORS and MODEL_ERRORS[_lower_tr(raw)] is None:
                out.append(raw)  # çözümleyici kabul etse de gerçek çıktıda bozuk olduğu görülmüş sözcük
                continue
            if w in self._known or w in free or w.startswith(self._domain):
                continue
            if not self._parses(_lower_tr(raw)) and not self._parses(w):
                out.append(raw)
        return out

    def ok(self, text: str, allowed: str = "") -> bool:
        return not self.unknown_words(text, allowed) and not self.grammar_issues(text)

    def _analyses(self, w: str) -> list[list[str]]:
        try:
            return [[m[0].id_ for m in a.morphemes] + [f"pos:{a.pos.value}", f"root:{a.dict_item.primary_pos.value}"]
                    for a in self._analyzer._parse(_lower_tr(w)) if a is not None]
        except Exception:  # çözümleyici iç hatası: bu sözcük için denetim yapılmaz
            return []

    def grammar_issues(self, text: str) -> list[str]:
        """Bozuk ad tamlamaları ("duvarın dokuyu"). Yalnızca kesin biçimbilimsel uyumsuzluk: ilk sözcüğün ilgi ekli ad
        çözümlemesi var ve sıfat okuması yok; ikinci sözcüğün bütün çözümlemeleri iyeliksiz, hâl ekli addır; ardından gelen sözcük tamlamanın
        başını sonraya taşıyan bir ortaç değildir. Denetim hazır değilse boş liste."""
        if self.state != "ready":
            return []
        out = []
        for seg in re.split(r"[,.;:!?()\"“”‘’]", text):
            ws = _WORD.findall(seg)
            for i in range(len(ws) - 1):
                a, b = self._analyses(ws[i]), self._analyses(ws[i + 1])
                # Sıfat okuması olan sözcük ("kalın" — "kal" adının ilgi hâli de olabilir) ilgi eki adayı sayılmaz.
                if not any(x[-3] == "Gen" and "pos:Noun" in x and "root:Noun" in x for x in a) \
                        or any("pos:Adj" in x or "root:Adj" in x for x in a):
                    continue
                if not b or not all("pos:Noun" in x and not _POSSESSIVE & set(x) and x[-3] in _CASES for x in b):
                    continue
                nxt = self._analyses(ws[i + 2]) if i + 2 < len(ws) else []
                participle = any(any(m in _PARTICIPLES for m in x) for x in nxt)
                finite = any(_TENSES & set(x) and not any(m in _PARTICIPLES for m in x) for x in nxt)
                if participle and not finite:
                    continue
                out.append(f"{ws[i]} {ws[i + 1]}")
        return out

