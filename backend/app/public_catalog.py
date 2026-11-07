"""Gerçek vakıf eserlerinin genel kataloğu (yalnızca okuma).

Genel uygulama V20 bilgi tabanını, inceleme veritabanını veya dahili paketi (`app.internal`) **okumaz**. Yayın onayından
geçmiş kayıtlar dahili dışa aktarıcıyla (`python -m app.internal.publish`) bir anlık görüntü dosyasına yazılır; bu modül
yalnızca o dosyayı yükler ve şemasını yeniden doğrular. Dosya yoksa katalog boştur. Dosya geçersizse uygulama açılmaz.
Dosya değişince (yeni yayın) katalog yeniden başlatma gerekmeden yenilenir.

Ek arşiv koleksiyonu (`archive_collection.json`, kataloğun yanında, isteğe bağlı): proje ekibinin hazırladığı görsel
arşivinin eser sayfalarında ayrı koleksiyon olarak gösterilen fotoğrafları. Bu fotoğraflar arşivdeki klasör
sınıflandırmasıyla sunulur; doğrulanmış eser kimliği, lisans veya hak sahibi bilgisi taşımaz. Kimliği belgeli biçimde
çelişen fotoğrafta açıklama zorunludur. Koleksiyon tarihî bilgi motoruna ve görsel tanıma indeksine girmez.

İçerik katmanı (`published.json`, isteğe bağlı; `app.content`): yöneticinin onaylayıp yayımladığı eserler ile onaylı
katalog eserlerine eklenen kayıt ve görseller. Anlık görüntünün üstüne eklenir (`apply_overlay`); kimlik çakışması veya
şema hatası olan katman reddedilir ve son geçerli katalog sunulur.

Şemanın kendisi yayın kurallarını taşır: her olgu, görsel, harita konumu ve check-in noktası onu açan kararın kimliğini
içermek zorundadır; check-in noktası doğrulanmış konum olmadan, oyun kullanımı yayın onayı olmadan yazılamaz. Koordinatı
olmayan eserde `location` `null`'dır; asla 0,0 veya tahmini değer yazılmaz.
"""

import json
import logging
import stat
import threading
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

logger = logging.getLogger("vakifname.public_catalog")

# /2: bağımsız kaynak bağlantıları, yayın dayanağı, keşif soruları ve görsel atıfları. /1 dosyaları da okunur.
PUBLIC_CATALOG_SCHEMA = "vakifname.public_catalog/2"

# Eser kimliği: 3 harfli şehir kodu + 4 hane (Bursa = BUR; yeni şehir kendi koduyla eklenir, ör. KUT-0001).
MonumentId = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}-\d{4}$")]
DecisionId = Annotated[str, StringConstraints(pattern=r"^DEC-[0-9a-f]{16}$")]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
MediaFile = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}\.jpe?g$")]


class _Public(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PublicSourceCitation(_Public):
    title: Text
    # Fiziksel PDF sayfası (1 tabanlı); basılı sayfa numarası değildir.
    pdf_physical_page: int = Field(ge=1)
    page_kind: Literal["physical"] = "physical"


class PublicLink(_Public):
    """Olguyu destekleyen bağımsız kaynak (resmî portal, belediye, ansiklopedi)."""

    title: Text
    publisher: Text
    url: Annotated[str, StringConstraints(pattern=r"^https://")]


class PublicQuest(_Public):
    """Olgudan üretilen keşif sorusu. `answer_index` yalnızca sunucuda kalır; API soruyu cevapsız sunar."""

    question: Text
    choices: tuple[Text, ...] = Field(min_length=2, max_length=4)
    answer_index: int = Field(ge=0)
    explanation: Text
    decision_id: DecisionId
    # İngilizce (Faz 11): kitabın İngilizce bölümünden, yönetici onaylı. Şık sırası Türkçe ile aynıdır.
    question_en: Optional[Text] = None
    choices_en: Optional[tuple[Text, ...]] = None
    explanation_en: Optional[Text] = None

    @model_validator(mode="after")
    def _answer(self):
        if self.answer_index >= len(self.choices):
            raise ValueError("Doğru cevap seçeneklerden biri olmalı.")
        en = (self.question_en, self.choices_en, self.explanation_en)
        if any(v is not None for v in en) and (None in en or len(self.choices_en) != len(self.choices)):
            raise ValueError("İngilizce soru, şıklar (aynı sayıda) ve açıklama birlikte verilmeli.")
        return self


class PublicFact(_Public):
    fact_id: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}-\d{4}-F\d{3}$")]
    title: Text
    text: Text
    category: Text
    certainty: Text
    source: PublicSourceCitation
    editorial_decision_id: DecisionId
    publication_decision_id: DecisionId
    game_use: bool
    game_use_decision_id: Optional[DecisionId] = None
    # `independent_corroboration`: metin özgündür ve bağımsız kaynaklara dayanır; kaynak kitap yalnızca kaynakçadır.
    basis: Literal["licensed_source", "independent_corroboration"] = "licensed_source"
    sources: tuple[PublicLink, ...] = ()
    quest: Optional[PublicQuest] = None
    # İngilizce (Faz 11): kitabın İngilizce bölümünden alıntı doğrulamalı ve onaylı; makine çevirisi yoktur.
    title_en: Optional[Text] = None
    text_en: Optional[Text] = None
    en_page: Optional[int] = Field(default=None, ge=1)
    en_decision_id: Optional[DecisionId] = None

    @model_validator(mode="after")
    def _game(self):
        if (self.title_en is None) != (self.text_en is None) or (self.text_en is None) != (self.en_decision_id is None):
            raise ValueError(f"{self.fact_id}: İngilizce başlık, metin ve onay kararı birlikte verilmeli.")
        if self.game_use != (self.game_use_decision_id is not None):
            raise ValueError(f"{self.fact_id}: oyun kullanımı yalnızca karar kimliğiyle açılabilir.")
        if self.quest is not None and not self.game_use:
            raise ValueError(f"{self.fact_id}: keşif sorusu yalnızca oyun kullanımı onaylı olguda olabilir.")
        if self.basis == "independent_corroboration" and not self.sources:
            raise ValueError(f"{self.fact_id}: bağımsız kaynaklı olguda kaynak bağlantısı zorunlu.")
        return self


class PublicImage(_Public):
    image_id: Text
    file: MediaFile
    rights_holder: Text
    license: Text
    attribution: Optional[Text] = None
    rights_decision_id: DecisionId
    publication_decision_id: DecisionId
    game_use: bool
    game_use_decision_id: Optional[DecisionId] = None
    # Kart görünümü için küçültülmüş dosya (yoksa `file` kullanılır).
    card_file: Optional[MediaFile] = None
    title: Optional[Text] = None
    license_url: Optional[Annotated[str, StringConstraints(pattern=r"^https?://")]] = None
    source_url: Optional[Annotated[str, StringConstraints(pattern=r"^https://")]] = None
    width: Optional[int] = Field(default=None, gt=0)
    height: Optional[int] = Field(default=None, gt=0)
    # Kaynak adı (ör. "Wikimedia Commons", "Vakıf Katılım — Bursa Vakıf Eserleri Envanteri"); eski anlık görüntülerde yok.
    source_label: Optional[Text] = None

    @model_validator(mode="after")
    def _game(self):
        if self.game_use != (self.game_use_decision_id is not None):
            raise ValueError(f"{self.image_id}: oyun kullanımı yalnızca karar kimliğiyle açılabilir.")
        if self.license.startswith("CC-BY") and not self.attribution:
            raise ValueError(f"{self.image_id}: CC BY lisanslı görselde atıf zorunlu.")
        return self


class PublicLocation(_Public):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: float = Field(gt=0, allow_inf_nan=False)
    represents: Text
    verification_decision_id: DecisionId
    map_decision_id: DecisionId

    @model_validator(mode="after")
    def _not_null_island(self):
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError("0,0 geçerli bir eser konumu değildir.")
        return self


class PublicCheckIn(_Public):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    radius_m: float = Field(gt=0, le=150, allow_inf_nan=False)
    point_kind: Text
    access_hours_note: Text
    safety_note: Text
    decision_id: DecisionId


class PublicMonument(_Public):
    monument_id: MonumentId
    name: Text
    alternative_names: tuple[Text, ...] = ()
    type: Text
    city: Text
    district: Text
    address: Text
    catalog_decision_id: DecisionId
    facts: tuple[PublicFact, ...] = ()
    images: tuple[PublicImage, ...] = ()
    location: Optional[PublicLocation] = None
    checkin: Optional[PublicCheckIn] = None
    site_notice: Optional[Text] = None
    # İngilizce ad ve ziyaret uyarısı (Faz 11, yönetici onaylı).
    name_en: Optional[Text] = None
    site_notice_en: Optional[Text] = None
    # R6.17: diğer adlar ve adresin İngilizcesi (yönetici onaylı). Yer adları özgün kalır; yalnızca açıklama çevrilir.
    alternative_names_en: tuple[Text, ...] = ()
    address_en: Optional[Text] = None
    # Onaylı fotoğraf yoksa arayüz, açıkça temsilî diye etiketlenmiş çizim gösterir.
    illustration: Literal["representative_drawing"] = "representative_drawing"

    @model_validator(mode="after")
    def _consistent(self):
        if self.checkin is not None and self.location is None:
            raise ValueError(f"{self.monument_id}: harita konumu doğrulanmadan check-in açılamaz.")
        for f in self.facts:
            if not f.fact_id.startswith(self.monument_id + "-"):
                raise ValueError(f"{f.fact_id}: başka bir esere ait olgu.")
        return self


class PublicCatalog(_Public):
    schema_: Literal["vakifname.public_catalog/1", "vakifname.public_catalog/2"] = Field(alias="schema")
    generated_at: Optional[datetime] = None
    data_version: Optional[Text] = None
    monuments: tuple[PublicMonument, ...] = ()

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    @model_validator(mode="after")
    def _unique(self):
        ids = [m.monument_id for m in self.monuments]
        if len(set(ids)) != len(ids):
            raise ValueError("Yinelenen eser kimliği.")
        return self


EMPTY_CATALOG = PublicCatalog(schema=PUBLIC_CATALOG_SCHEMA)
OVERLAY_SCHEMA = "vakifname.content_overlay/1"


def apply_overlay(base: PublicCatalog, overlay: dict) -> PublicCatalog:
    """Yayın katmanını anlık görüntünün üstüne ekler. Katman eseri katalog eseriyle, eklenen kayıt/görsel mevcut olanla
    aynı kimliği taşıyamaz; aksi halde `ValueError`. Sonuç baştan doğrulanır."""
    if overlay.get("schema") != OVERLAY_SCHEMA:
        raise ValueError("Bilinmeyen içerik katmanı şeması.")
    data = base.model_dump(mode="json", by_alias=True)
    by_id = {m["monument_id"]: m for m in data["monuments"]}
    for item in overlay.get("facts", ()):
        m = by_id.get(item["monument_id"])
        if m is None:
            raise ValueError(f"{item['monument_id']}: katalogda olmayan esere kayıt eklenemez.")
        if any(f["fact_id"] == item["fact"]["fact_id"] for f in m["facts"]):
            raise ValueError(f"{item['fact']['fact_id']}: kayıt kimliği katalogda var.")
        m["facts"].append(item["fact"])
    for item in overlay.get("images", ()):
        m = by_id.get(item["monument_id"])
        if m is None:
            raise ValueError(f"{item['monument_id']}: katalogda olmayan esere görsel eklenemez.")
        m["images"].append(item["image"])
    data["monuments"].extend(overlay.get("monuments", ()))
    # İngilizce katman: Türkçe kaydı (artık) yayında olmayan çeviri sessizce atlanır.
    facts = {f["fact_id"]: f for m in data["monuments"] for f in m["facts"]}
    for t in overlay.get("translations", ()):
        f = facts.get(t["fact_id"])
        if f is not None:
            f.update(title_en=t["title_en"], text_en=t["text_en"], en_page=t.get("en_page"), en_decision_id=t["decision_id"])
            q, qe = f.get("quest"), t.get("quest_en")
            # Soru çevirisi yalnızca şık sayısı tutuyorsa uygulanır; doğru cevap (`answer_index`) Türkçe sorudan gelir.
            if q and qe and len(qe["choices"]) == len(q["choices"]):
                q.update(question_en=qe["question"], choices_en=list(qe["choices"]), explanation_en=qe["explanation"])
    names = {m["monument_id"]: m for m in data["monuments"]}
    for t in overlay.get("monument_en", ()):
        m = names.get(t["monument_id"])
        if m is not None:
            m.update(name_en=t.get("name_en"), site_notice_en=t.get("site_notice_en"),
                     alternative_names_en=list(t.get("alternative_names_en") or ()), address_en=t.get("address_en"))
    return PublicCatalog.model_validate(data)


def overlay_media_files(overlay: Optional[dict]) -> set[str]:
    if not overlay:
        return set()
    images = [i["image"] for i in overlay.get("images", ())] + [i for m in overlay.get("monuments", ()) for i in m["images"]]
    return {f for img in images for f in (img.get("file"), img.get("card_file")) if f}

ARCHIVE_COLLECTION_SCHEMA = "vakifname.archive_collection/1"
ARCHIVE_COLLECTION_FILE = "archive_collection.json"


class ArchiveImage(_Public):
    """Arşiv koleksiyonundaki fotoğraf. `archive_folder` arşivdeki sınıflandırmadır, doğrulanmış eser kimliği değildir."""

    image_id: Text
    monument_id: MonumentId
    file: MediaFile
    card_file: Optional[MediaFile] = None
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    archive_folder: Text
    identity: Literal["celiski_yok", "belgelenmis_celiski"]
    identity_note: Optional[Text] = None

    @model_validator(mode="after")
    def _note(self):
        if self.identity == "belgelenmis_celiski" and not self.identity_note:
            raise ValueError(f"{self.image_id}: kimlik çelişkisi açıklamasız gösterilemez.")
        return self


class ArchiveCollection(_Public):
    schema_: Literal["vakifname.archive_collection/1"] = Field(alias="schema")
    collection_id: Text
    source_label: Text
    note: Text
    images: tuple[ArchiveImage, ...] = ()

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    @model_validator(mode="after")
    def _unique(self):
        ids = [i.image_id for i in self.images]
        if len(set(ids)) != len(ids):
            raise ValueError("Yinelenen arşiv görseli.")
        return self


def quests_of(m: PublicMonument) -> list[PublicFact]:
    return [f for f in m.facts if f.quest is not None]


def _image_view(img: PublicImage) -> dict:
    return img.model_dump(mode="json", exclude={"rights_decision_id", "publication_decision_id", "game_use_decision_id"})


def _cover(m: PublicMonument) -> Optional[dict]:
    if not m.images:
        return None
    img = m.images[0]
    return {"file": img.card_file or img.file, "attribution": img.attribution, "license": img.license,
            "title": img.title, "source_url": img.source_url}


def monument_summary(m: PublicMonument) -> dict:
    lead = next((f for f in m.facts if f.category in ("construction", "historical_person", "foundation_purpose")),
                m.facts[0] if m.facts else None)
    return {
        "monument_id": m.monument_id,
        "name": m.name,
        "name_en": m.name_en,
        "alternative_names": list(m.alternative_names),
        "type": m.type,
        "city": m.city,
        "district": m.district,
        "address": m.address,
        "location": m.location.model_dump(include={"latitude", "longitude", "accuracy_m"}) if m.location else None,
        "checkin_available": m.checkin is not None,
        "fact_count": len(m.facts),
        "game_fact_count": sum(f.game_use for f in m.facts),
        "quest_count": len(quests_of(m)),
        "image_count": len(m.images),
        "cover": _cover(m),
        "lead": lead.text if lead else None,
        "lead_en": lead.text_en if lead else None,
        "illustration": m.illustration,
    }


def quest_view(f: PublicFact) -> dict:
    """Soru, cevapsız: doğru seçenek yalnızca sunucuda denetlenir."""
    return {"quest_id": f.fact_id, "fact_title": f.title, "question": f.quest.question, "choices": list(f.quest.choices)}


def archive_view(collection: Optional[ArchiveCollection], images: tuple[ArchiveImage, ...]) -> Optional[dict]:
    if collection is None or not images:
        return None
    return {"collection_id": collection.collection_id, "source_label": collection.source_label, "note": collection.note,
            "images": [i.model_dump(mode="json", exclude={"monument_id"}) for i in images]}


def monument_detail(m: PublicMonument, archive: Optional[dict] = None) -> dict:
    data = m.model_dump(mode="json", exclude={"checkin", "facts", "images"})
    data["facts"] = [{**f.model_dump(mode="json", exclude={"quest"}), "has_quest": f.quest is not None} for f in m.facts]
    data["images"] = [_image_view(i) for i in m.images]
    data["archive_collection"] = archive
    data["quests"] = [quest_view(f) for f in quests_of(m)]
    data["checkin_available"] = m.checkin is not None
    data["checkin"] = (m.checkin.model_dump(mode="json", include={"radius_m", "point_kind", "access_hours_note",
                                                                   "safety_note"}) if m.checkin else None)
    return data


class PublicCatalogRepository:
    """Yayın anlık görüntüsünü okur ve dosya değişince yeniden yükler; yeni yayın için sunucu yeniden başlatılmaz.

    - Dışa aktarıcı dosyayı atomik olarak değiştirir (`os.replace`); her istekte yalnızca `stat` yapılır.
    - Açılışta dosya geçersizse uygulama açılmaz. Çalışırken gelen geçersiz dosya reddedilir ve son geçerli katalog
      sunulmaya devam eder (yarım veya bozuk yayın genel API'ye geçmez).
    - Dosya silinirse katalog boşalır: yayından kaldırma.
    - Yandaki arşiv koleksiyonu aynı kurallarla birlikte yüklenir; silinirse yalnızca koleksiyon kalkar. Koleksiyon yalnızca
      katalogda yayımlanmış eserlere bağlanır.
    """

    def __init__(self, path: Optional[Path], media_dir: Optional[Path] = None, overlay_path: Optional[Path] = None,
                 overlay_media_dir: Optional[Path] = None):
        self.path = Path(path) if path else None
        self._media_dir_override = Path(media_dir) if media_dir else None
        self.archive_path = self.path.parent / ARCHIVE_COLLECTION_FILE if self.path else None
        self.overlay_path = Path(overlay_path) if overlay_path else None
        self.overlay_media_dir = Path(overlay_media_dir) if overlay_media_dir else None
        self._base: PublicCatalog = EMPTY_CATALOG
        self._overlay_files: set[str] = set()
        self._lock = threading.Lock()
        self._stamp = self._stamps()
        self._rejected_stamp = None
        self._set(*self._load())

    @staticmethod
    def _file_stamp(path: Optional[Path]):
        if path is None:
            return None
        try:
            st = path.stat()
        except FileNotFoundError:
            return None
        return (st.st_mtime_ns, st.st_size, st.st_ino) if stat.S_ISREG(st.st_mode) else None

    def _stamps(self):
        return self._file_stamp(self.path), self._file_stamp(self.archive_path), self._file_stamp(self.overlay_path)

    def _load(self) -> tuple[PublicCatalog, Optional[ArchiveCollection]]:
        base = (PublicCatalog.model_validate(json.loads(self.path.read_text(encoding="utf-8")))
                if self._file_stamp(self.path) else EMPTY_CATALOG)
        archive = None
        if self._file_stamp(self.archive_path):
            archive = ArchiveCollection.model_validate(json.loads(self.archive_path.read_text(encoding="utf-8")))
        overlay = None
        if self._file_stamp(self.overlay_path):
            overlay = json.loads(self.overlay_path.read_text(encoding="utf-8"))
        catalog = apply_overlay(base, overlay) if overlay else base
        self._base, self._overlay_files = base, overlay_media_files(overlay)
        return catalog, archive

    def _set(self, catalog: PublicCatalog, archive: Optional[ArchiveCollection]):
        media_dir = self._media_dir_override or (self.path.parent / "media" if self.path else None)
        by_id = {m.monument_id: m for m in catalog.monuments}
        archive_images: dict[str, tuple[ArchiveImage, ...]] = {}
        for img in archive.images if archive else ():
            if img.monument_id in by_id:
                archive_images[img.monument_id] = archive_images.get(img.monument_id, ()) + (img,)
        files = {f for m in catalog.monuments for img in m.images for f in (img.file, img.card_file) if f}
        files |= {f for imgs in archive_images.values() for img in imgs for f in (img.file, img.card_file) if f}
        self._state = (catalog, by_id, files, media_dir, archive, archive_images)

    def _refresh(self):
        stamp = self._stamps()
        if stamp == self._stamp or stamp == self._rejected_stamp:
            return
        with self._lock:
            if stamp == self._stamp:
                return
            if stamp[0] is None and stamp[2] is None:
                self._base, self._overlay_files = EMPTY_CATALOG, set()
                self._set(EMPTY_CATALOG, None)
                self._stamp = stamp
                logger.warning("Genel katalog dosyası kaldırıldı; katalog boş.")
                return
            try:
                catalog, archive = self._load()
            except (OSError, ValueError, KeyError, TypeError) as e:
                self._rejected_stamp = stamp
                logger.error("Yeni genel katalog veya arşiv koleksiyonu dosyası geçersiz, son geçerli sürüm sunuluyor: %s", e)
                return
            self._set(catalog, archive)
            self._stamp, self._rejected_stamp = stamp, None
            logger.info("Genel katalog yeniden yüklendi: %d eser, %d arşiv fotoğrafı.", len(catalog.monuments),
                        sum(len(v) for v in self._state[5].values()))

    @property
    def catalog(self) -> PublicCatalog:
        self._refresh()
        return self._state[0]

    @property
    def media_dir(self) -> Optional[Path]:
        return self._state[3]

    @property
    def base_catalog(self) -> PublicCatalog:
        """Yayın katmanı eklenmemiş onaylı anlık görüntü (içerik yönetimi bunu salt okunur temel olarak kullanır)."""
        self._refresh()
        return self._base

    def archive(self, monument_id: str) -> Optional[dict]:
        """Eserin arşiv koleksiyonu görünümü (yoksa `None`)."""
        self._refresh()
        state = self._state
        return archive_view(state[4], state[5].get(monument_id, ()))

    def list(self) -> list[PublicMonument]:
        return list(self.catalog.monuments)

    def get(self, monument_id: str) -> Optional[PublicMonument]:
        self._refresh()
        return self._state[1].get(monument_id)

    def media_path(self, file: str) -> Optional[Path]:
        self._refresh()
        _, _, files, media_dir, _, _ = self._state
        if file not in files:
            return None
        folder = self.overlay_media_dir if file in self._overlay_files else media_dir
        if folder is None:
            return None
        path = folder / file
        return path if path.is_file() else None
