"""Üretilen cevabın kaynak denetimi: her cümle, atıf yaptığı onaylı kayıtlarla desteklenmeli.

Model cevabı cümle başına kaynak kimliği taşıyan JSON olarak verir. Bu modül modele güvenmeden her cümleyi denetler:

1. Atıf yapılan kimliklerin hepsi bu istekte modele verilen kanıtlar arasında olmalı (uydurma veya başka kayıt yok).
2. Cümledeki her rakam, sayı sözcüğü, Roma rakamı ve özel ad (büyük harfle başlayan ad, katalogda geçen kişi adları)
   atıf yapılan kayıtların metninde (ve ilgili eserlerin adlarında) bulunmalı.
3. Yalnızca fotoğrafa (`FOTOGRAF`) dayanan cümle tarih, yüzyıl, kişi adı, yapı malzemesi veya yapım/onarım gibi tarihî
   olay içeremez; fotoğrafa bakarak tarihî bilgi kesinmiş gibi söylenemez. (Gerçek testte model Koza Han'ın tuğla ve
   taş cephesini "tuğla ve tahta" diye tanımladı: malzeme fotoğraftan güvenilir okunamaz.)
4. Cümledeki yapı malzemesi (taş, tuğla, ahşap, mermer, kurşun, çini…) atıf yapılan kayıtlarda geçmeli; fotoğraf
   atfı malzemeye kanıt sayılmaz. Fotoğrafa dayanmayan cümledeki mimari bölüm (minare, kubbe, şadırvan, mihrap, avlu,
   mescit…) atıf yapılan kayıtlarda geçmeli. Böylece geçerli bir kayıt kimliği gösterip başka bir yapının bölümünü veya
   malzemesini anlatan cümle de çıkarılır.
5. Kaynaksız cümle gösterilmez.

Denetimi geçemeyen cümle cevaptan çıkarılır ve sayılır; hiç cümle kalmazsa cevap "kanıt yok" olur. Bu denetim anlam
kaymasını (ör. "yaptırdı" yerine "yıktırdı") tümüyle yakalayamaz; o yüzden kaynak kayıtlar cevabın yanında gösterilir.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Optional

from ..ask.text import fold, stem

PHOTO_ID = "FOTOGRAF"
MAX_SENTENCES = 8
MAX_SENTENCE_CHARS = 600

_NUM_WORDS = {"iki": 2, "uc": 3, "dort": 4, "bes": 5, "alti": 6, "yedi": 7, "sekiz": 8, "dokuz": 9, "on": 10,
              "yirmi": 20, "otuz": 30, "kirk": 40, "elli": 50, "altmis": 60, "yetmis": 70, "seksen": 80, "doksan": 90,
              "yuz": 100, "bin": 1000}
_DIGITS = re.compile(r"\d+")
_ROMAN = re.compile(r"(?<![A-Za-zÇĞİÖŞÜçğıöşü])([IVX]{1,5})\.?(?![A-Za-zÇĞİÖŞÜçğıöşü])")
_TOKEN = re.compile(r"[A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû]+(?:['’][a-zçğıöşüâîû]+)?")
_UPPER = set("ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZÂÎÛQWX")
# Yalnızca fotoğrafa dayanan cümlede bulunamayacak tarihî anlatım kökleri.
_HISTORICAL = ("yaptir", "insa", "kurul", "kurdu", "onari", "onarim", "resto", "yikil", "yikti", "defne", "gomul", "vakfi",
               "vakif", "bani", "mimar", "tamamla", "yuzyi", "hicri", "milad", "donem", "sulta", "padis", "hukum", "fethet",
               "yandi", "yangi", "deprem", "tarih", "yilin", "yilda")
_SUFFIX = r"(lar|ler)?(i|in|ini|a|e|ta|te|tan|ten|da|de|dan|den|la|le|li|lu|dir|tir|si|sini|siyla|yla|yle|n|nin|ndan|nden)?"
# Katlanmış (fold) biçimler; kök → tek ad ("tahta" ve "ahşap" aynı malzeme).
_MATERIALS = {"tas": "tas", "tugla": "tugla", "ahsap": "ahsap", "tahta": "ahsap", "mermer": "mermer", "kursun": "kursun",
              "kerpic": "kerpic", "cini": "cini", "demir": "demir", "moloz": "moloz", "kiremit": "kiremit", "alci": "alci"}
_MATERIAL = re.compile(rf"^({'|'.join(_MATERIALS)}){_SUFFIX}$")
# Mimari bölüm kökleri (katlanmış biçimin başı); "mihrap/mihrab", "mescit/mescid" aynı kökte buluşur.
_PARTS = ("minare", "kubbe", "sadirvan", "avlu", "revak", "mihra", "minber", "mesci", "turbe", "medrese", "hamam", "cesme",
          "kitabe", "imaret", "sebil", "kasnak", "sanduka")
# Her bağlamda kullanılabilen genel adlar.
_GENERIC = {"bursa", "turki"}


@dataclass
class Sentence:
    text: str
    sources: list[str]


@dataclass
class Checked:
    status: str  # answered | insufficient_evidence
    sentences: list[Sentence] = field(default_factory=list)
    removed: list[dict] = field(default_factory=list)  # {"text":..., "reason":...} yalnızca iç ölçüm için
    missing: str = ""
    parse_error: bool = False

    @property
    def cited(self) -> list[str]:
        return list(dict.fromkeys(s for x in self.sentences for s in x.sources if s != PHOTO_ID))


def parse(text: str) -> Optional[dict]:
    """Modelin JSON çıktısını okur (kod bloğu çitlerini ve baştaki/sondaki metni tolere eder)."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", t)
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(t[start:end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _proper_tokens(text: str) -> list[tuple[str, bool]]:
    """(kök, cümle başı mı) — büyük harfle başlayan sözcükler; kesme işaretinden sonraki ek atılır."""
    out = []
    for m in re.finditer(r"[^.!?]+", text):
        for i, tok in enumerate(_TOKEN.findall(m.group(0))):
            if tok[0] in _UPPER and not _ROMAN.fullmatch(tok):
                base = re.split(r"['’]", tok)[0]
                out.append((stem(fold(base)), i == 0 and "'" not in tok and "’" not in tok))
    return out


def _materials(text: str) -> set[str]:
    return {_MATERIALS[m.group(1)] for w in fold(text).split() if (m := _MATERIAL.match(w.strip(".,;:!?()\"'“”‘’")))}


def _parts(text: str, skip_names: bool = False) -> set[str]:
    """Metindeki mimari bölüm kökleri. `skip_names`: büyük harfle başlayan sözcükler (ör. "Orhan Gazi Türbesi" adı)
    bölüm sayılmaz."""
    out = set()
    for tok in _TOKEN.findall(text):
        if skip_names and tok[0] in _UPPER:
            continue
        w = fold(tok)
        out.update(p for p in _PARTS if w.startswith(p))
    return out


def _numbers(text: str) -> set[int]:
    nums = {int(x) for x in _DIGITS.findall(text)}
    for w in fold(text).split():
        if w in _NUM_WORDS:
            nums.add(_NUM_WORDS[w])
    return nums


class Checker:
    def __init__(self, support: dict[str, str], corpus_texts: list[str], always_allowed: list[str] = (),
                 photo_allowed: bool = True):
        """`support`: kanıt kimliği → metin (bu istekte modele verilenler). `corpus_texts`: bütün katalog (kişi adlarını
        tanımak için). `always_allowed`: ilgili eserlerin adları gibi her cümlede kullanılabilecek adlar."""
        self.support = support
        # Bu istekte fotoğraf yoksa (ör. önceki gözlem yalnızca geçmişte) "FOTOGRAF" atfı kabul edilmez.
        self.photo_allowed = photo_allowed
        self.allowed_stems = {stem(w) for t in always_allowed for w in fold(t).split()} | _GENERIC
        self.allowed_roman = set(_ROMAN.findall(" ".join(always_allowed)))
        # Katalogda küçük harfle de geçen sözcük özel ad değildir ("Büyük", "Han" bazen büyük harfle yazılır); yalnızca
        # hep büyük harfle geçen sözcükler kişi/yer adı sayılır.
        common = {stem(fold(re.split(r"['’]", w)[0])) for t in corpus_texts for w in _TOKEN.findall(t) if w[0] not in _UPPER}
        self.corpus_proper = ({s for t in corpus_texts for s, initial in _proper_tokens(t) if not initial}
                              - self.allowed_stems - common)

    def _support_of(self, ids: list[str]) -> tuple[str, set[str], set[int], set[str]]:
        text = " ".join(self.support[i] for i in ids if i in self.support)
        # Cümle tarafında özel adın kesme işaretinden sonraki eki atılır ("Paşa'nın" → "paşa"); kayıt tarafında da aynı
        # biçim eklenir, yoksa kayıtta ekli geçen ad cümlede desteksiz sayılır.
        stems_ = {stem(w) for w in fold(text).split()} | {stem(fold(re.split(r"['’]", t)[0])) for t in _TOKEN.findall(text)}
        return text, stems_, _numbers(text), set(_ROMAN.findall(text))

    def _check(self, s: Sentence) -> Optional[str]:
        if not s.sources:
            return "kaynaksız cümle"
        if PHOTO_ID in s.sources and not self.photo_allowed:
            return "bu istekte fotoğraf yok"
        unknown = [i for i in s.sources if i != PHOTO_ID and i not in self.support]
        if unknown:
            return "verilmeyen kayıt kimliği"
        fact_ids = [i for i in s.sources if i != PHOTO_ID]
        photo = PHOTO_ID in s.sources
        text, sup_stems, sup_nums, sup_roman = self._support_of(fact_ids)
        f = fold(s.text)
        if photo and not fact_ids:
            if any(len(x) >= 3 for x in _DIGITS.findall(s.text)):
                return "fotoğraftan tarih/sayı"
            # "mimar"/"mimarı" (yapının mimarı) tarihî bilgidir; "mimari" (mimari özellik) görsel betimlemedir. Katlama
            # ı'yı i'ye çevirdiği için ayrım katlamadan önceki küçük harfli sözcükte yapılır.
            low = s.text.replace("I", "ı").replace("İ", "i").lower()
            architectural = {fold(w) for w in re.findall(r"\w+", low) if re.match(r"mimar[iî]", w)}
            if any(w.startswith(h) and w not in architectural for w in f.split() for h in _HISTORICAL):
                return "fotoğraftan tarihî bilgi"
            if _materials(s.text):
                return "fotoğraftan malzeme"
            for st, initial in _proper_tokens(s.text):
                if not initial and st in self.corpus_proper:  # cümle başındaki büyük harf ad sayılmaz
                    return "fotoğraftan kişi/özel ad"
            return None
        for n in _numbers(s.text):
            if n not in sup_nums and not (photo and n < 100):
                return f"kayıtta olmayan sayı: {n}"
        for r in _ROMAN.findall(s.text):
            if r not in sup_roman and r not in self.allowed_roman:
                return f"kayıtta olmayan Roma rakamı: {r}"
        for st, initial in _proper_tokens(s.text):
            if st in sup_stems or st in self.allowed_stems:
                continue
            if not initial or st in self.corpus_proper:
                return "kayıtta olmayan özel ad"
        if _materials(s.text) - _materials(text):
            return "kayıtta olmayan malzeme"
        if not photo and _parts(s.text, skip_names=True) - _parts(text):
            return "kayıtta olmayan mimari bölüm"
        return None

    def check(self, data: Optional[dict]) -> Checked:
        if data is None:
            return Checked("insufficient_evidence", parse_error=True)
        raw = data.get("sentences")
        sentences: list[Sentence] = []
        if isinstance(raw, list):
            for item in raw[:MAX_SENTENCES]:
                if not isinstance(item, dict) or not isinstance(item.get("text"), str):
                    continue
                src = item.get("sources")
                ids = [str(x).strip() for x in src if isinstance(x, (str, int))] if isinstance(src, list) else []
                text = " ".join(item["text"].split())[:MAX_SENTENCE_CHARS]
                if text:
                    sentences.append(Sentence(text, list(dict.fromkeys(ids))))
        kept, removed = [], []
        for s in sentences:
            reason = self._check(s)
            if reason is None:
                kept.append(s)
            else:
                removed.append({"text": s.text, "reason": reason, "sources": s.sources})
        missing = data.get("missing") if isinstance(data.get("missing"), str) else ""
        missing = " ".join(missing.split())[:300]
        # "Eksik" notu da kanıt değildir: rakam veya katalog dışı özel ad taşıyorsa gösterilmez.
        if missing and (_DIGITS.search(missing) or any(st in self.corpus_proper for st, _ in _proper_tokens(missing))):
            missing = ""
        return Checked("answered" if kept else "insufficient_evidence", kept, removed, missing)
