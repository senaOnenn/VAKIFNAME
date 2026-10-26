"""Görsel envanteri: JPEG dosyalarını BUR-xxxx kimliklerine bağlar, yayın iznini ayrı tutar.

Bir görselin bir esere klasör üzerinden bağlanması, görselin o eseri gösterdiğinin doğrulandığı veya
yayımlanabileceği anlamına gelmez. Bu modül dosya içeriği sunmaz; yalnızca meta veri döndürür.

İki koleksiyon vardır (ikincisi iki dosyadan yüklenebilir):
- `v20_archive`: V20 paketiyle gelen 325 dosya. Kaynağı ve hak sahibi belgelenmemiştir.
- `wikimedia_commons`: Wikimedia Commons'tan alınan, yazar ve lisans bilgisi kayıtlı dosyalar
  (`data/real_catalog/commons_images.json`). Kaynak bilgisi (`provenance`) konunun içeriğine dahildir; hak kararı
  verildikten sonra değişirse karar geçersiz olur.
  İnsan onayı bekleyen yeni adaylar ayrı bir dosyadan (`commons_images_candidates.json`) ve yalnızca açıkça
  yapılandırıldığında yüklenir; kayıtlarında masa başı inceleme özeti (`provenance.review`) ve aday partisi bulunur.
- Görsel tanıma test kümesindeki (`HoldoutSet`) fotoğraflar hiçbir koleksiyona alınamaz.
"""

import json
from pathlib import Path
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from .catalog import CatalogError, MonumentId

Collection = Literal["v20_archive", "wikimedia_commons"]


class ImageVariant(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    relative_path: Annotated[str, StringConstraints(pattern=r"^BUR-\d{4}/[^/\\]+\.jpe?g$")]
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    size_bytes: int = Field(gt=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ImageRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    image_id: str
    monument_id: MonumentId
    relative_path: Annotated[str, StringConstraints(pattern=r"^BUR-\d{4}/[^/\\]+\.jpe?g$")]
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    size_bytes: int = Field(gt=0)
    jpeg_valid: bool
    width: Optional[int] = None
    height: Optional[int] = None
    monument_known_in_v20: bool
    filename_prefix_matches_folder: bool
    # Eşleştirme durumu ile yayın izni ayrı alanlardır.
    monument_link_status: Literal["folder_assigned_unverified", "editor_confirmed", "rejected"]
    content_verification_status: str
    license_status: str
    publication_status: str
    public_serving_allowed: bool
    duplicate_of: tuple[str, ...] = ()
    collection: Collection = "v20_archive"
    # Kart görünümü için küçültülmüş sürüm (yalnızca Commons koleksiyonunda).
    card: Optional[ImageVariant] = None
    # Commons kaynak kaydı: dosya sayfası, yazar, lisans, açıklama ve masa başı eşleşme notu.
    provenance: Optional[dict] = None
    # Commons kaydının önerdiği hak bilgisi; `image_rights` formunu önceden doldurur, onay değildir.
    proposed_rights: Optional[dict] = None
    # Hackathon ZIP kaynağı, belgelenmiş kimlik durumu ve kalite (yalnızca ek katman yüklüyse; arşiv kaydına eklenir).
    zip_import: Optional[dict] = None
    # Görüntüleme kopyaları (`detail`, `card`; HACKATHON_ZIP_DISPLAY_DIR altında). Özgün dosya değişmez.
    display: Optional[dict[str, ImageVariant]] = None

    @property
    def zip_identity_conflict(self) -> bool:
        return bool(self.zip_import) and self.zip_import["identity"]["status"] != "celiski_yok"

    @property
    def publishable(self) -> bool:
        return (
            self.public_serving_allowed
            and self.publication_status == "published"
            and self.license_status == "approved"
            and self.monument_link_status == "editor_confirmed"
        )


def commons_records(data: dict, candidate_batch: Optional[str] = None) -> list[dict]:
    """Commons manifest kaydını envanter kaydına çevirir. Hiçbir alan yayın izni veya doğrulanmış eşleşme yazmaz."""
    out = []
    for c in data.get("images", []):
        provenance = {**c["commons"], "rank": c.get("rank"), "verification": c.get("verification")}
        # Eski (onaylı 60) kayıtların özeti değişmesin diye ek alanlar yalnızca varsa eklenir.
        if c.get("review") is not None:
            provenance["review"] = c["review"]
        if candidate_batch is not None:
            provenance["candidate_batch"] = candidate_batch
        out.append({
            "image_id": c["image_id"], "monument_id": c["monument_id"], "relative_path": c["relative_path"],
            "sha256": c["sha256"], "size_bytes": c["size_bytes"], "jpeg_valid": True, "width": c["width"],
            "height": c["height"], "monument_known_in_v20": True, "filename_prefix_matches_folder": True,
            "monument_link_status": "folder_assigned_unverified", "content_verification_status": "desk_matched",
            "license_status": "proposed", "publication_status": "blocked", "public_serving_allowed": False,
            "collection": "wikimedia_commons", "card": c.get("card"),
            "provenance": provenance,
            "proposed_rights": c.get("proposed_rights"),
        })
    return out


class ImageInventory:
    def __init__(self, manifest: dict, monument_ids: set[str], extra: Optional[list[dict]] = None):
        try:
            self.images = [ImageRecord(**i) for i in [*manifest["images"], *(extra or [])]]
        except (KeyError, TypeError, ValidationError) as e:
            raise CatalogError(f"Görsel manifesti geçersiz: {e}") from e
        ids = [i.image_id for i in self.images]
        if len(set(ids)) != len(ids):
            raise CatalogError("Görsel manifestinde yinelenen kimlik var.")
        for img in self.images:
            if img.monument_id not in monument_ids:
                raise CatalogError(f"{img.image_id}: V20'de bulunmayan esere bağlı.")
            if not img.relative_path.startswith(img.monument_id + "/"):
                raise CatalogError(f"{img.image_id}: klasör ile eser kimliği uyuşmuyor.")

    def for_monument(self, monument_id: str) -> list[ImageRecord]:
        return [i for i in self.images if i.monument_id == monument_id]

    def publishable(self) -> list[ImageRecord]:
        return [i for i in self.images if i.publishable]


class HoldoutSet:
    """Dondurulmuş görsel tanıma test kümesi: kimlik, dosya özeti ve Commons dosyası üzerinden eşleşme."""

    def __init__(self, data: Optional[dict] = None):
        data = data or {}
        items = data.get("items", [])
        self.test_set_id: Optional[str] = data.get("test_set_id")
        self.manifest_sha256: Optional[str] = data.get("manifest_sha256")
        self.image_ids = frozenset(i["image_id"] for i in items)
        self.sha256 = frozenset(v["sha256"] for i in items for v in (i.get("detail"), i.get("card")) if v)
        self.commons = frozenset(x for i in items for x in (i.get("commons_title"), i.get("commons_sha1")) if x)

    def __len__(self) -> int:
        return len(self.image_ids)

    def contains(self, img: "ImageRecord") -> bool:
        p = img.provenance or {}
        return (img.image_id in self.image_ids or img.sha256 in self.sha256
                or (img.card is not None and img.card.sha256 in self.sha256)
                or p.get("title") in self.commons or p.get("commons_sha1") in self.commons)


EMPTY_HOLDOUT = HoldoutSet()


def load_holdout(path: Optional[Path]) -> HoldoutSet:
    if path is None or not Path(path).exists():
        return EMPTY_HOLDOUT
    return HoldoutSet(json.loads(Path(path).read_text(encoding="utf-8")))


def apply_zip_overlay(inv: ImageInventory, overlay: dict) -> None:
    """ZIP ek katmanını aynı kimlik ve aynı SHA-256'lı arşiv kayıtlarına ekler; yeni kayıt açmaz."""
    by_id = {i.image_id: k for k, i in enumerate(inv.images)}
    meta = {k: overlay[k] for k in ("zip", "source", "rights")}
    for item in overlay.get("items", []):
        k = by_id.get(item["image_id"])
        img = inv.images[k] if k is not None else None
        if img is None or img.collection != "v20_archive" or img.sha256 != item["zip"]["sha256"] \
                or img.monument_id != item["monument_id"]:
            raise CatalogError(f"ZIP ek katmanı arşiv kaydıyla eşleşmiyor: {item['image_id']}")
        try:
            display = {n: ImageVariant(**v) for n, v in item["display"].items()}
        except (TypeError, ValidationError) as e:
            raise CatalogError(f"ZIP görüntüleme kopyası geçersiz: {e}") from e
        inv.images[k] = img.model_copy(update={
            "zip_import": {**meta, "entry": item["zip"], "identity": item["identity"], "quality": item["quality"],
                           "reference_index": item["reference_index"]},
            "display": display,
        })


def load_image_inventory(path: Path, monument_ids: set[str], commons_file: Optional[Path] = None,
                         candidates_file: Optional[Path] = None, holdout: HoldoutSet = EMPTY_HOLDOUT,
                         zip_overlay_file: Optional[Path] = None) -> ImageInventory:
    extra = []
    if commons_file is not None and Path(commons_file).exists():
        extra += commons_records(json.loads(Path(commons_file).read_text(encoding="utf-8")))
    if candidates_file is not None:
        data = json.loads(Path(candidates_file).read_text(encoding="utf-8"))
        extra += commons_records(data, candidate_batch=data.get("batch_id") or Path(candidates_file).name)
    inv = ImageInventory(json.loads(Path(path).read_text(encoding="utf-8")), monument_ids, extra or None)
    if zip_overlay_file is not None:
        apply_zip_overlay(inv, json.loads(Path(zip_overlay_file).read_text(encoding="utf-8")))
    leaked = [i.image_id for i in inv.images if holdout.contains(i)]
    if leaked:
        raise CatalogError(f"Test kümesindeki fotoğraflar envantere alınamaz: {', '.join(leaked[:5])}")
    return inv
