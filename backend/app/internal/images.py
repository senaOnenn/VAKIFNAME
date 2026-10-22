"""Görsel envanteri: JPEG dosyalarını BUR-xxxx kimliklerine bağlar, yayın iznini ayrı tutar.

Bir görselin bir esere klasör üzerinden bağlanması, görselin o eseri gösterdiğinin doğrulandığı veya
yayımlanabileceği anlamına gelmez. Bu modül dosya içeriği sunmaz; yalnızca meta veri döndürür.
"""

import json
from pathlib import Path
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from .catalog import CatalogError, MonumentId


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

    @property
    def publishable(self) -> bool:
        return (
            self.public_serving_allowed
            and self.publication_status == "published"
            and self.license_status == "approved"
            and self.monument_link_status == "editor_confirmed"
        )


class ImageInventory:
    def __init__(self, manifest: dict, monument_ids: set[str]):
        try:
            self.images = [ImageRecord(**i) for i in manifest["images"]]
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


def load_image_inventory(path: Path, monument_ids: set[str]) -> ImageInventory:
    return ImageInventory(json.loads(Path(path).read_text(encoding="utf-8")), monument_ids)
