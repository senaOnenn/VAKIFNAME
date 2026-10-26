"""Türkçe soru çözümleme: hangi eser, ne tür bir soru, hangi içerik kavramları.

Burada yalnızca dil kuralları vardır (eser adlarının yazım biçimleri, soru kalıpları, eş anlamlı kökler); tarihî bilgi
yoktur. Cevaplar her zaman katalogdaki onaylı olgulardan gelir.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from .text import fold, stem

# Yazım farkları, eşleştirmeden önce tek biçime indirilir.
_SPELLING = {
    "murat": "murad", "bayezit": "bayezid", "beyazit": "bayezid", "beyazid": "bayezid", "bayazit": "bayezid",
    "bayazid": "bayezid", "ulucamii": "ulucami", "kozahani": "kozahan", "pirinchani": "pirinchan",
    "camisi": "camii", "camiyi": "camii",
}
_FOCUS = {"ne", "neyle", "nelerle", "neler", "kim", "kimler", "neyi", "nereden", "nasil"}
_OVERVIEW_WORDS = {"anlat", "anlatir", "anlatin", "hakkinda", "tanit", "tanitir", "bilgi", "nedir", "ozellikleri", "ozellik"}


def normalize(text: str) -> str:
    t = " ".join(_SPELLING.get(w, w) for w in fold(text).split())
    # "İkinci Murad", "2. Murad" → "ii murad" (yalnızca Murad adıyla; "ikinci bir mescit" değişmez).
    return re.sub(r"\b(ikinci|2) (murad)", r"ii \2", t)


def _alias_regex(alias: str) -> re.Pattern:
    """Ek almış biçimleri (Ulu Cami'nin, Bedestende, Murad'ın türbesi) tanır; kısa kelimeler ek almaz."""
    parts = []
    for w in normalize(alias).split():
        parts.append(re.escape(w) + (r"[a-z]{0,8}" if len(w) >= 3 else ""))
    return re.compile(r"(?<![a-z0-9])" + r" ".join(parts) + r"(?![a-z0-9])")


# Katalog adlarına ek, yaygın kullanılan adlar ve yazımlar (yalnızca eser tanıma için).
EXTRA_ALIASES: dict[str, tuple[str, ...]] = {
    "BUR-0001": ("Ulu Cami", "Ulu Camii", "Ulucami", "Bursa Ulu Camii", "Bursa Ulucamii"),
    "BUR-0003": ("Muradiye Camii", "Muradiye Cami", "II. Murad Camii", "Sultan Murad Camii", "Murad Camii"),
    "BUR-0005": ("Muradiye Medresesi", "Muradiye Medrese", "II. Murad Medresesi", "El Yazmaları Müzesi",
                 "Kur'an ve El Yazmaları Müzesi"),
    "BUR-0007": ("II. Murad Türbesi", "Sultan II. Murad Türbesi", "Sultan Murad Türbesi", "Murad Türbesi",
                 "II. Murad'ın türbesi"),
    "BUR-0008": ("Cem Sultan Türbesi", "Cem Sultan", "Sultan Cem", "Cem Türbesi", "Şehzade Cem"),
    "BUR-0009": ("Koza Han", "Koza Hanı", "Kozahan"),
    "BUR-0013": ("Pirinç Han", "Pirinç Hanı", "Pirinçhan"),
    "BUR-0014": ("Yıldırım Bayezid Bedesteni", "Bedesten", "Bursa Bedesteni", "Bedestan"),
    "BUR-0019": ("Osman Gazi Türbesi", "Osman Gazi", "Osman Bey Türbesi", "Osman Bey"),
    "BUR-0020": ("Orhan Gazi Türbesi", "Orhan Gazi", "Orhan Bey"),
}

# Tek başına hangi esere ait olduğu belli olmayan adlar: kullanıcıya hangi eser sorulur.
AMBIGUOUS: tuple[tuple[str, tuple[str, ...], Optional[str]], ...] = (
    ("Muradiye Külliyesi", ("BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008"), None),
    ("Muradiye", ("BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008"), None),
    ("II. Murad", ("BUR-0003", "BUR-0007", "BUR-0005"), None),
    ("Sultan Murad", ("BUR-0003", "BUR-0007", "BUR-0005"), None),
    ("Yıldırım Bayezid", ("BUR-0001", "BUR-0014"), None),
    ("Şehzade Mustafa Türbesi", ("BUR-0008",),
     "Muradiye'de iki Şehzade Mustafa türbesi bulunur. Katalogdaki yapı, Fatih'in oğlu Şehzade Mustafa için yapılan ve "
     "bugün Cem Sultan Türbesi diye bilinen türbedir; Kanuni'nin oğlu Şehzade Mustafa'nın türbesi katalogda yoktur."),
    ("Hanlar Bölgesi", ("BUR-0009", "BUR-0013"), None),
)

# Katalogda olmayan, sık sorulabilecek Bursa yapıları. Bunlar sorulduğunda katalogdaki başka bir eserin bilgisi verilmez.
OTHER_MONUMENTS: tuple[str, ...] = (
    "Yeşil Cami", "Yeşil Camii", "Yeşil Türbe", "Emir Sultan", "Emirsultan", "Hüdavendigar", "I. Murad", "Murad Hüdavendigar",
    "Yıldırım Camii", "Yıldırım Bayezid Camii", "Yıldırım Külliyesi", "Irgandı", "Cumalıkızık", "Şehzade Ahmed",
    "Hüma Hatun", "Gülşah Hatun", "Mükrime Hatun", "Gülruh Hatun", "Şehzade Mahmud", "Ebe Hatun", "Saraylılar Türbesi",
    "Alaeddin Türbesi", "Alâeddin Türbesi", "Orhan Camii", "Orhan Gazi Camii", "Orhan Gazi Külliyesi", "Orhan Medresesi",
    "Orhan Gazi Medresesi", "Osman Gazi Camii", "Emir Han", "Fidan Han", "Geyve Han", "Bey Han", "Tuz Pazarı",
    "İvaz Paşa", "Saat Kulesi", "Tophane Saat Kulesi", "Bursa Kalesi", "Hisar", "Kapalıçarşı", "Koza Parkı",
    "Ayasofya", "Selimiye", "Süleymaniye", "Şehadet Camii", "Eskikaplıca", "Çekirge", "Kayhan", "Bedesten Camii",
    "Uludağ", "Oylat", "İnkaya", "Hünkar Köşkü", "Atatürk Evi", "Karagöz",
)

_TYPE_RX = (
    (re.compile(r"^camii?([a-z]{0,8})$"), "cami"), (re.compile(r"^turbe[a-z]{0,8}$"), "türbe"),
    (re.compile(r"^medrese[a-z]{0,8}$"), "medrese"), (re.compile(r"^bedesten[a-z]{0,6}$"), "bedesten"),
    (re.compile(r"^han(i|in|da|a|ina|inda|indaki|daki|idir|dir)?$"), "han"),
)


def type_of(word: str) -> Optional[str]:
    """Yapı türü kelimesi ("türbesidir", "caminin", "hanın") → tür; değilse None."""
    for rx, t in _TYPE_RX:
        if rx.match(word):
            return t
    return None

_CAPITAL_NAME = re.compile(
    r"((?:[A-ZÇĞİÖŞÜ][\wçğıöşüâîû.]*\s+){1,3})(Camii|Cami|Camisi|Türbesi|Türbe|Hanı|Han|Medresesi|Hamamı|Külliyesi|"
    r"Köprüsü|Çarşısı|Kervansarayı|Kalesi|Kulesi|Köşkü|Müzesi|Mescidi|Tekkesi)"
)

# Katalogda karşılığı olmayan güncel bilgiler: tahmin edilmez.
_CURRENT = [re.compile(p) for p in (
    r"\b(kacta|kac ta|saat kac|saatleri|saati)\b", r"\b(acilis|kapanis)\b", r"\b(ziyaret saat|ziyarete acik)",
    r"(?<!kubbesi )(?<!kubbe )(?<!ortasi )(?<!tepesi )(?<!ustu )\bacik mi(dir)?\b", r"\b(bugun|yarin|hafta sonu|pazar|pazartesi|bayramda) acik",
    r"(?<!kubbesi )(?<!ustu )(?<!tepesi )(?<!ortasi )\bkapali mi(dir)?\b", r"\b(giris )?(ucret|ucretli|ucretsiz|bilet|fiyat|kac lira|kac tl)", r"\bnasil (gidilir|giderim|gidebilirim|ulasirim|ulasilir)\b",
    r"\b(ulasim|otobus|metro|tramvay|otopark|park yeri|taksi)\b", r"\b(tuvalet|wc|lavabo|kafe|restoran|yemek)\b.*\b(var mi|nerede)\b",
    r"\b(telefon|iletisim|rehberli tur|etkinlik|hava durumu|namaz vakti|namaz vakitleri)\b",
    r"\b(su an|simdi) (acik|kapali|kalabalik)", r"\b(fotograf cekmek|cekim izni|kiyafet)\b",
)]

STOP = {fold(w) for w in (
    "bu şu o bir ve ile de da ki mi mı mu mü midir mıdır mudur müdür nedir ne neler nelerdir kim kimdir kimin kimler "
    "kimlerdir kime nerede nerde neresi neden niçin niye nasıl nasıldır hangi hangisi kaç tane zaman için olarak var "
    "vardır vardı yok mevcut hakkında bilgi ver verir verebilir misin anlat anlatır anlatabilir söyle söyler söyleyebilir "
    "acaba peki en çok daha olan olur oldu olmuş edildi edilmiş edilmiştir eder etti etmiş bana biraz kısaca lütfen merak "
    "ediyorum istiyorum öğrenmek eser eseri eserin yapı yapının yapısı yapıyı bina binası binanın bursa bursadaki burada "
    "orada içinde içindeki hangi yıl yılı yılında yıllarında yılda tarih tarihi tarihinde tarihte tarihli zamanı zamanda "
    "kaçıncı dönem döneminde hala hâlâ bugün günümüzde şimdi şu an mıdır sence diye gibi her "
    "gazi şehzade bey hz hazreti ii i iii kimdi kimlerdi neydi nelerdi mıydı miydi muydu müydü midir mudur "
    "nereye neresidir hangileri hangileriydi hangisidir acaba dır dir tır tir üzerine üzerinde üstüne üstünde "
    "yüzyıl yüzyılda yüzyılın yüzyılı yüzyıla asır asırda kişi kişiler kişidir kimse örnek örneği örnektir örneğidir "
    "kimlerin yapıya yapılara binaya neyle nelerle kadar işe yarar sahip sahiptir sahipti arasında arası "
    "yıllar yıllara yılları yılları döneme dönemine dönemi dönemde bulunan bulunur bulunuyor bulundu bulunmuş "
    "bulunmaktadır biliniyor bilinir yarıyor yarıyordu yarardı tarafından sırasında sırada esnasında malzeme malzemesi "
    "te ta de da den dan ten tan e a ı i u ü in ın un ün nin nın nun nün ye ya yi yı"
).split()}

# Eş anlamlı kökler: soru bir kavramı hangi kelimeyle sorarsa sorsun, olgu metnindeki karşılıkları eşleşir.
_CONCEPT_WORDS: dict[str, str] = {
    "build": "yaptırdı yaptırmış yapıldı yapılmış inşa ettirdi ettiren bani banisi kurdu kuruldu yapım tamamlandı "
             "yaptıran inşası",
    "architect": "mimar mimarı mimarları tasarladı tasarım",
    "craftsman": "usta ustası ustaları imal",
    "burial": "gömülü gömüldü gömülmüş defnedildi defin sanduka sandukası mezar mezarı yatıyor yatan naaşı",
    "restore": "onarım onarıldı onarılmış restorasyon restore tamir",
    "rebuild": "yeniden yenilendi yenilenmiş",
    "quake": "deprem depremi depreminde",
    "fire": "yangın yangını yangında yandı yanmış",
    "occupation": "işgal işgali yunan bayrak bayrağı sancak sancağı",
    "purpose": "amaç amacı amacıyla amaçla gelir vakıf vakfı",
    "use": "kullanıldı kullanılıyor kullanılmıştır kullanılmaktadır işlev işlevi",
    "museum": "müze müzesi",
    "name": "ad adı adıyla isim ismi anılır anıldı bilinir bilinen denir deniyor",
    "decor": "süsleme süslemesi süslü çini çinileri nakış nakışlar kalem bezeme motif motifleri",
    "dome": "kubbe kubbesi kubbeli",
    "minaret": "minare minaresi minareleri",
    "mihrab": "mihrap mihrabı",
    "minber": "minber minberi",
    "fountain": "şadırvan şadırvanı havuz",
    "courtyard": "avlu avlusu",
    "room": "oda odası odaları hücre hücreleri",
    "column": "sütun sütunları sütunlar başlık başlıkları kaide",
    "pier": "paye payeler payeye ayak ayağa ayağı ayakları",
    "wall": "duvar duvarları tuğla taş almaşık örülmüş örgü örgüsü malzeme",
    "plan": "plan planı planlı tip tipi tipinde tipindedir",
    "shape": "şekil şekli şeklinde şekilde biçim biçimi sekizgen altıgen kare yuvarlak dikdörtgen",
    "cover": "örtü örtüsü örtülü örtülmüş örtülüdür çatı çatısı kaplı kaplandı kaplanmış kaplıdır",
    "height": "yükseklik yüksekliği yüksekliğinde yüksek boy boyu",
    "unesco": "unesco dünya mirası",
    "imam": "imam imamı imamlık görev görevi görevini hatip",
    "inscription": "kitabe kitabesi kitabeye kitabeler yazıt",
    "writing": "yazı yazısı yazılı yazılıdır yazılmış yazıyor kuşak kuşağı hat",
    "owner": "ait aittir adına",
    # "öldü/ölmüş" katlanınca "oldu/olmuş" olur; olgu metninde yalnızca karışmayan biçimler aranır.
    "death": "ölen ölümü ölümünden vefat vefatı",
    "birth": "doğdu doğmuş doğum doğduğu doğumu",
    "ruler": "padişah padişahı sultan hükümdar",
    "damage": "zarar hasar yıkıldı yıkılmış yıkım etkiledi",
    "finish": "bitti bitirildi tamamlandı tamamlanmış",
    "start": "başladı başlandı başlamış başlayıp başlangıç başladığını başlanmış",
    "duration": "sürdü süren sürmüş yıllık",
    "will": "vasiyet vasiyeti vasiyetine istedi istemişti",
    "origin": "nereden getirildi getirilip getirilmiş geldi taşıdı taşıtmış taşıtmıştır nakledildi",
    "surround": "etraf etrafı etrafında çevre çevresi çevrili çevrilidir",
    "color": "renk rengi renkli lacivert firuze mavi yeşil",
    "original": "orijinal özgün aslı",
    "sibling": "kardeş kardeşi kardeşleri",
    "parent": "oğlu oğul oğulları baba babası babasının anne annesi",
    "trade": "ticaret çarşı esnaf ipek",
    "stable": "ahır ahırı",
    "mosque_small": "mescit mescidi",
    "dimension": "metre metrelik ölçü ölçüleri boyut boyutu genişlik genişliği genişliğinde uzunluk",
    "byzantine": "bizans devşirme",
}
CONCEPTS: dict[str, frozenset[str]] = {k: frozenset(stem(w) for w in fold(v).split()) for k, v in _CONCEPT_WORDS.items()}
# Yazının içeriğini soran fiil ("ne yazıyor?") kitabeyi de kapsar; "kitabe" kelimesi ise genel yazı kuşağını kapsamaz.
CONCEPTS["writing"] = CONCEPTS["writing"] | CONCEPTS["inscription"]
# "Kaç kişi gömülü?": sayılan kişi şehzade, sultan, hatun veya sanduka olarak geçebilir.
PERSON_COUNT = frozenset(stem(w) for w in fold("kişi şehzade sultan hatun sanduka padişah").split())
_STEM_TO_CONCEPT: dict[str, str] = {}
for _name, _stems in CONCEPTS.items():
    for _s in _stems:
        _STEM_TO_CONCEPT.setdefault(_s, _name)


def concept_of(s: str) -> Optional[str]:
    """Kökün kavramı; ekli biçimler için en az dört harflik ortak başlangıç yeterlidir ("amacl" → amaç)."""
    if s in _STEM_TO_CONCEPT:
        return _STEM_TO_CONCEPT[s]
    if len(s) >= 4:
        for cs, name in _STEM_TO_CONCEPT.items():
            # Kısa kökün uzun kavram köküne genişletilmesi yalnızca beş harfli köklerde: "doğu" (yön) ≠ "doğum".
            if len(cs) >= 4 and (s.startswith(cs) or (len(s) >= 5 and cs.startswith(s))):
                return name
    return None


# Fiil çekimleri ("kalırdı", "geldi", "oturuyor") sorunun konusu değildir; eşleşmeseler de soruyu cevapsız bırakmazlar.
_VERB = re.compile(r"(di|du|ti|tu|dim|tim|mis|mus|misti|mustu|iyor|uyor|yor|ydi|ydu|mek|mak|ecek|acak|abilir|ebilir|"
                   r"irdi|urdu|erdi|ardi|ilir|ulur|unur|inir|dir|tir|dur|tur|sin|sun)$")


def is_weak(word: str) -> bool:
    return len(word) >= 4 and not word.endswith(("lar", "ler")) and bool(_VERB.search(word))


def _softened(s: str) -> set[str]:
    """Ünsüz yumuşaması: "ayak" → "ayag" (ayağa), "kitap" → "kitab"."""
    soft = {"k": "g", "p": "b", "t": "d", "c": "c"}
    return {s, s[:-1] + soft[s[-1]]} if s and s[-1] in soft else {s}


@dataclass
class Term:
    """Sorudaki bir içerik terimi: tek kök ya da bir kavramın bütün kökleri. `weak`: fiil çekimi (düşük ağırlık)."""
    label: str
    stems: frozenset[str]
    weak: bool = False
    focus: bool = False  # soru sözcüğünün doğrudan sorduğu fiil ("nasıl satılırdı", "ne yazıyor")


@dataclass
class Question:
    raw: str
    norm: str
    monuments: list[str] = field(default_factory=list)
    ambiguous: Optional[tuple[str, tuple[str, ...], Optional[str]]] = None
    other_monument: Optional[str] = None
    type_word: Optional[str] = None
    current_info: bool = False
    kind: set[str] = field(default_factory=set)  # who, date, count, where, why, overview, name, century
    count_noun: Optional[Term] = None
    event_verb: Optional[str] = None
    identify: bool = False  # "hangi …" sorusu
    death: bool = False
    negated_selection: bool = False
    instrument: bool = False  # "neyle / ne ile …": malzeme ya da araç soruluyor  # "Hangi eseri Bayezid yaptırmadı?": olmayanı soran seçim
    terms: list[Term] = field(default_factory=list)


class Analyzer:
    def __init__(self, monuments: list[tuple[str, str, tuple[str, ...]]]):
        """`monuments`: (eser kimliği, katalog adı, katalogdaki diğer adlar)."""
        self.alias_patterns: list[tuple[re.Pattern, str, int]] = []
        for mid, name, alts in monuments:
            for alias in {name, *alts, *EXTRA_ALIASES.get(mid, ())}:
                self.alias_patterns.append((_alias_regex(alias), mid, len(normalize(alias))))
        self.alias_patterns.sort(key=lambda x: -x[2])
        self.ambiguous = [(_alias_regex(a), a, mids, note) for a, mids, note in AMBIGUOUS]
        self.others = sorted(((_alias_regex(o), o) for o in OTHER_MONUMENTS), key=lambda x: -len(x[1]))
        self.known = {mid for mid, _, _ in monuments}

    def _match_aliases(self, norm: str) -> tuple[list[str], list[tuple[int, int]]]:
        found, spans = [], []
        for rx, mid, _ in self.alias_patterns:
            for m in rx.finditer(norm):
                if any(s <= m.start() < e or s < m.end() <= e for s, e in spans):
                    continue
                spans.append(m.span())
                if mid not in found:
                    found.append(mid)
        return found, spans

    def analyze(self, question: str) -> Question:
        norm = normalize(question)
        q = Question(raw=question, norm=norm)
        q.current_info = any(p.search(norm) for p in _CURRENT)
        # "öldü" katlanınca "oldu" olur; ölüm ham metinden tanınır.
        q.death = bool(re.search(r"(?<![a-zçğıöşü])(öl(dü|müş|en|ümü|ümünden|dükten)|vefat)", question.lower()))

        # Katalog dışı eserler önce aranır ("Orhan Gazi Camii" türbe değildir).
        other_spans = []
        for rx, name in self.others:
            m = rx.search(norm)
            if m and not any(s <= m.start() < e for s, e in other_spans):
                other_spans.append(m.span())
                q.other_monument = q.other_monument or name
        masked = norm
        for s, e in other_spans:
            masked = masked[:s] + " " * (e - s) + masked[e:]
        q.monuments, spans = self._match_aliases(masked)
        spans += other_spans
        if not q.monuments:
            for rx, alias, mids, note in self.ambiguous:
                m = rx.search(masked)
                if m:
                    q.ambiguous = (alias, tuple(x for x in mids if x in self.known), note)
                    spans.append(m.span())
                    break
        # Büyük harfle yazılmış, katalogda olmayan bir eser adı ("Emir Sultan Camii").
        if q.other_monument is None:
            for m in _CAPITAL_NAME.finditer(question):
                phrase = normalize(m.group(0))
                if not any(rx.fullmatch(phrase) or rx.search(phrase) for rx, _, _ in self.alias_patterns) and \
                        not any(rx.search(phrase) for rx, *_ in self.ambiguous):
                    q.other_monument = m.group(0).strip()
                    break

        # Eser adlarının dışında kalan kelimeler soru türünü ve içerik terimlerini verir.
        rest = norm
        for s, e in sorted(spans, reverse=True):
            rest = rest[:s] + " " + rest[e:]
        ws = rest.split()
        for w in ws:
            if type_of(w):
                q.type_word = type_of(w)
        self._kinds(q, rest, ws)
        q.terms = self._terms(q, ws)
        return q

    @staticmethod
    def _kinds(q: Question, rest: str, ws: list[str]):
        k = q.kind
        q.identify = bool(re.search(r"\bhangi\b", rest))
        q.instrument = bool(re.search(r"\b(neyle|nelerle|ne ile)\b", rest))
        # "Hangi hocalar / hangi usta / hangi sultan" bir kişiyi sorar.
        if re.search(r"\bhangi (hoca|usta|mimar|sultan|padisah|sehzade|kisi|imam|muderris|vezir|pasa)", rest):
            k.add("who")
        # Olumsuz seçim: "hangi/kim/ne ... -madı / olmayan / değildir / hariç" (olumsuz evet-hayır sorusu "değil mi?" hariç).
        q.negated_selection = bool(
            re.search(r"\b(hangi|kim|kimler|ne|neler|nereye|nerede)\b", rest)
            and re.search(r"\b\w+(madi|medi|mamis|memis|mayan|meyen|mamistir|memistir|mamisti|memisti)\b|\b(olmayan|degildir|haric|disinda)\b",
                          rest) and not re.search(r"\bdegil mi\b", rest))
        if re.search(r"\b(kimin|kime|kimlerin)\b", rest):
            k.add("whose")
        elif re.search(r"\b(kim|kimdir|kimler|kimlerdir|kimi|kimdi|kimlerdi|kimmis)\b", rest):
            k.add("who")
        if re.search(r"\bkac (yil|sene|yuzyil|gun|ay)\b(?! ?(inda|nda|da|de)\b)|\bkac (yasinda|yasindaydi|yasina)|"
                     r"\bne kadar (surdu|surmus|zaman)", rest) and not re.search(r"\bkac (yilinda|senesinde)", rest):
            k.add("duration")
        elif re.search(r"\b(ne zaman|hangi (yil|tarih|donem|yuzyil|sene)|kac yilinda|kac tarihinde|kac senesinde|"
                       r"yili ne|tarihi ne|hangi yuzyilda|ne zamandan|ne zamana|yapim yili|yapim tarihi)", rest):
            k.add("date")
        # "1844'te ne yapıldı?": "yapıldı" burada yapımı değil, olan biteni sorar; "ne için yapılmış?" amacı sorar.
        m = re.search(r"\bne (yapildi|yapilmis|oldu|olmus|yasandi|yasadi|yasamis)\b", rest)
        if m:
            k.add("event")
            q.event_verb = m.group(1)
        if re.search(r"\bne (icin|amacla) (yapil|yaptir|insa)", rest):
            k.add("event")
        if re.search(r"\b(hangi yuzyil|yuzyilda mi|kacinci yuzyil)", rest):
            k.add("century")
        m = re.search(r"\bkac (tane )?([a-z]+)", rest)
        if m and not re.match(r"(yil|yilinda|tarih|sene|yas|yuzyil)", m.group(2)) and not k & {"date", "duration"}:
            k.add("count")
            noun = stem(m.group(2))
            concept = concept_of(noun)
            if noun == "kisi":
                q.count_noun = Term("person", PERSON_COUNT)
            else:
                q.count_noun = Term(concept or noun, CONCEPTS[concept] if concept else frozenset(_softened(noun)))
        # "Kubbe sayısı", "minare sayısı nedir": "kaç" olmadan sayı sorusu.
        m2 = re.search(r"\b([a-z]{3,}) sayisi\b", rest)
        if "count" not in k and not k & {"date", "duration"} and m2 and m2.group(1) not in STOP:
            k.add("count")
            noun = stem(m2.group(1))
            concept = concept_of(noun)
            q.count_noun = Term(concept or noun, CONCEPTS[concept] if concept else frozenset(_softened(noun)))
        if re.search(r"\b(nerede|nerde|neresi|neresinde|hangi (semt|ilce|mahalle|cadde|sokak)|adresi|adres|konumu)\b", rest):
            k.add("where")
        if re.search(r"\b(neden|nicin|niye|sebebi|sebep)\b", rest):
            k.add("why")
        if re.search(r"\b(eski ad|diger ad|adi ne|ismi ne|baska ad|ne ad|neden .*(den|den )?(iyor|ir)|nasil anil|olarak bilin)", rest) \
                or re.search(r"\b(ad|adi|adini|adiyla|isim|ismi) (nereden|neden)", rest):
            k.add("name")
        content = [w for w in ws if w not in STOP and type_of(w) is None and w not in _OVERVIEW_WORDS]
        if not content and not k:
            k.add("overview")

    @staticmethod
    def _terms(q: Question, ws: list[str]) -> list[Term]:
        terms: dict[str, Term] = {}
        for i, w in enumerate(ws):
            if w in STOP or type_of(w) is not None or w in _OVERVIEW_WORDS or w == q.event_verb:
                continue
            if w == "sayisi" and "count" in q.kind:
                continue  # "kubbe sayısı": sayılan şey ayrıca terimdir; "sayısı" yalnızca soru kalıbıdır
            s = stem(w)
            if len(s) < 2:
                continue
            concept = concept_of(s)
            if concept == "build" and "event" in q.kind:
                continue
            # "Mimarı kim?", "mimarının adı" mimarı sorar; "mimarisi nasıl?" mimari özellikleri (genel terim, atlanır).
            if concept == "architect" and w.startswith("mimaris"):
                continue
            # Fiil zayıftır; ama sorunun odağıysa güçlüdür: "ne yazıyor", "neyle süslenmiş", "kim yaptırdı",
            # tarih/süre sorularında tarihlenen olay ("ne zaman bitti").
            # "Ne kadar büyük/geniş?" boyut sorar ("en büyük onarım" ise sormaz).
            if w in ("buyuk", "genis", "uzun") and i > 0 and ws[i - 1] == "kadar":
                concept = "dimension"
            focus = is_weak(w) and i > 0 and ws[i - 1] in _FOCUS
            weak = is_weak(w) and not focus and not (concept and q.kind & {"date", "duration", "count"})
            if concept in ("birth", "death"):
                weak = False  # yaşam olayı sorunun konusudur ("mimarı nerede doğdu?")
            if i > 0 and ws[i - 1] == "en" and not concept:
                weak = True
            if concept == "owner" and "whose" not in q.kind:
                continue  # "hangi döneme ait" sahiplik sormaz
            if concept:
                # Fiil biçiminden gelen kavram ("yaptırdı", "kullanılmış") zayıftır; isim biçimi ("restorasyon") güçlü.
                t = terms.get(concept)
                terms[concept] = Term(concept, CONCEPTS[concept], weak=weak and (t is None or t.weak), focus=focus)
            else:
                variants = _softened(s) | ({s[:-1]} if len(s) == 3 and s[-1] in "iu" else set())
                terms.setdefault(s, Term(s, frozenset(variants), weak=weak, focus=focus))
        if q.death:
            terms["death"] = Term("death", CONCEPTS["death"])
        out = list(terms.values())
        # Soru yalnızca fiilden oluşuyorsa ("Bedestende ne satılırdı?") o fiil sorunun konusudur.
        if out and all(t.weak for t in out):
            out = [Term(t.label, t.stems, focus=t.focus) for t in out]
        return out
