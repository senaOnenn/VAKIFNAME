"""Gerçek eserlerin kaynak ve konum araştırması (`data/real_catalog/monument_research.json`).

Bu dosya yalnızca **araştırma bulgularını** taşır: kaynak sayfaları, adres iddiaları, kaynaklar arası tutarsızlıklar ve
koordinat adayları. Hiçbir onay içermez:
- Koordinat adayı her zaman `unverified` durumundadır; `verified` yazılırsa dosya reddedilir. Doğrulama yalnızca inceleme
  veritabanındaki `location_verification` kararıyla olur (bkz. `decisions.py`).
- `reviewed_by` / `reviewed_at` boş olmalıdır; dosyaya incelemeci adı yazılamaz.
- Koordinat 0,0 olamaz ve Bursa ili sınırlayıcı kutusunun dışında olamaz (enlem/boylam yer değiştirmesini de yakalar).
"""

import json
from datetime import date
from pathlib import Path
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints, ValidationError, model_validator

from .catalog import CatalogError, MonumentId, NonEmpty, V20Catalog

# Bursa ili için kaba sınırlayıcı kutu (WGS84). Amaç doğrulama değil, bariz hataları (0,0, yer değiştirme) yakalamaktır.
BURSA_BBOX = {"lat": (39.5, 40.8), "lon": (28.0, 30.0)}

SourceKind = Literal[
    "official_portal", "municipal_heritage", "vgm", "v20_source_pdf", "cadastral", "open_map_data", "open_knowledge_base"
]
SupportedClaim = Literal["identity", "alternative_names", "type", "address", "location", "dating"]
Represents = Literal["building_footprint_centroid", "area_centroid", "point_feature", "entrance", "parcel_centroid"]
SourceId = Annotated[str, StringConstraints(pattern=r"^S-\d{4}-[A-Z]+$")]
CandidateId = Annotated[str, StringConstraints(pattern=r"^LC-\d{4}-\d{2}$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ResearchSource(_Strict):
    source_id: SourceId
    kind: SourceKind
    publisher: NonEmpty
    title: NonEmpty
    url: Optional[HttpUrl] = None
    pdf_file: Optional[NonEmpty] = None
    # Fiziksel PDF sayfası (1 tabanlı), basılı sayfa numarası değil.
    pdf_physical_page: Optional[int] = Field(default=None, ge=1)
    accessed_at: date
    supports: tuple[SupportedClaim, ...] = Field(min_length=1)
    # Kaynağın neyi desteklediğinin kendi cümlelerimizle özeti; kaynak metni kopyalanmaz.
    summary: NonEmpty

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, data):
        # JSON'dan gelen URL ve tarih metinleri strict modda dönüştürülmez; burada açıkça çevrilir.
        if isinstance(data, dict):
            data = dict(data)
            if isinstance(data.get("accessed_at"), str):
                data["accessed_at"] = date.fromisoformat(data["accessed_at"])
            if isinstance(data.get("url"), str):
                data["url"] = HttpUrl(data["url"])
            if isinstance(data.get("supports"), list):
                data["supports"] = tuple(data["supports"])
        return data

    @model_validator(mode="after")
    def _locatable(self):
        if self.kind == "v20_source_pdf":
            if not (self.pdf_file and self.pdf_physical_page):
                raise ValueError(f"{self.source_id}: PDF kaynağında dosya adı ve fiziksel sayfa zorunlu.")
        elif self.url is None:
            raise ValueError(f"{self.source_id}: çevrim içi kaynakta URL zorunlu.")
        return self


class AddressClaim(_Strict):
    value: NonEmpty
    source_id: SourceId


class Discrepancy(_Strict):
    discrepancy_id: Annotated[str, StringConstraints(pattern=r"^D-\d{4}-\d{2}$")]
    topic: NonEmpty
    description: NonEmpty
    source_ids: tuple[SourceId, ...] = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def _tuple(cls, data):
        if isinstance(data, dict) and isinstance(data.get("source_ids"), list):
            data = {**data, "source_ids": tuple(data["source_ids"])}
        return data


class CoordinateCandidate(_Strict):
    """Bir kaynaktan toplanmış, henüz doğrulanmamış koordinat."""

    candidate_id: CandidateId
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    crs: Literal["EPSG:4326"]
    source_id: SourceId
    # Kaynaktaki nesne ve sürümü (ör. `osm:way/26434413@v21`); aynı koordinat yeniden üretilebilsin diye.
    source_object: NonEmpty
    represents: Represents
    estimated_accuracy_m: float = Field(gt=0, allow_inf_nan=False)
    collection_method: NonEmpty
    collected_by: NonEmpty
    collected_at: date
    # Araştırma dosyası incelemeci kaydedemez; inceleme kararları veritabanındadır.
    reviewed_by: None = None
    reviewed_at: None = None
    status: Literal["unverified"]
    notes: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _coerce(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            if isinstance(data.get("collected_at"), str):
                data["collected_at"] = date.fromisoformat(data["collected_at"])
            for key in ("latitude", "longitude", "estimated_accuracy_m"):
                if isinstance(data.get(key), int) and not isinstance(data.get(key), bool):
                    data[key] = float(data[key])
        return data

    @model_validator(mode="after")
    def _plausible(self):
        if self.latitude == 0 and self.longitude == 0:
            raise ValueError(f"{self.candidate_id}: 0,0 koordinatı geçerli bir aday değildir.")
        (lat_lo, lat_hi), (lon_lo, lon_hi) = BURSA_BBOX["lat"], BURSA_BBOX["lon"]
        if not (lat_lo <= self.latitude <= lat_hi and lon_lo <= self.longitude <= lon_hi):
            raise ValueError(f"{self.candidate_id}: koordinat Bursa ili sınırlayıcı kutusunun dışında.")
        return self


class SiteContext(_Strict):
    """Görev tasarımı için erişim ve saygı kısıtları. `None` = bilinmiyor."""

    active_place_of_worship: Optional[bool]
    burial_site: Optional[bool]
    access_notes: NonEmpty


class MonumentResearch(_Strict):
    monument_id: MonumentId
    v20_name: NonEmpty
    full_name: NonEmpty
    alternative_names: tuple[NonEmpty, ...]
    type: NonEmpty
    city: NonEmpty
    district: NonEmpty
    address_claims: tuple[AddressClaim, ...]
    sources: tuple[ResearchSource, ...] = Field(min_length=1)
    discrepancies: tuple[Discrepancy, ...]
    location_candidates: tuple[CoordinateCandidate, ...]
    location_status: Literal["missing", "unverified"]
    site_context: SiteContext
    vgm_search: NonEmpty
    review_status: Literal["research_collected_editor_review_pending"]

    @model_validator(mode="before")
    @classmethod
    def _tuples(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            for key in ("alternative_names", "address_claims", "sources", "discrepancies", "location_candidates"):
                if isinstance(data.get(key), list):
                    data[key] = tuple(data[key])
        return data

    @model_validator(mode="after")
    def _consistent(self):
        ids = [s.source_id for s in self.sources]
        if len(set(ids)) != len(ids):
            raise ValueError(f"{self.monument_id}: yinelenen kaynak kimliği.")
        prefix = f"S-{self.monument_id[4:]}-"
        if any(not i.startswith(prefix) for i in ids):
            raise ValueError(f"{self.monument_id}: kaynak kimliği başka bir esere ait.")
        known = set(ids)
        refs = [a.source_id for a in self.address_claims] + [c.source_id for c in self.location_candidates]
        refs += [s for d in self.discrepancies for s in d.source_ids]
        unknown = sorted(set(refs) - known)
        if unknown:
            raise ValueError(f"{self.monument_id}: bilinmeyen kaynak kimlikleri {unknown}.")
        cids = [c.candidate_id for c in self.location_candidates]
        if len(set(cids)) != len(cids) or any(not c.startswith(f"LC-{self.monument_id[4:]}-") for c in cids):
            raise ValueError(f"{self.monument_id}: koordinat adayı kimlikleri geçersiz.")
        expected = "unverified" if self.location_candidates else "missing"
        if self.location_status != expected:
            raise ValueError(f"{self.monument_id}: konum durumu '{expected}' olmalı.")
        return self

    def candidate(self, candidate_id: str) -> Optional[CoordinateCandidate]:
        return next((c for c in self.location_candidates if c.candidate_id == candidate_id), None)

    def source(self, source_id: str) -> ResearchSource:
        return next(s for s in self.sources if s.source_id == source_id)


class ResearchCatalog:
    def __init__(self, raw: dict, catalog: V20Catalog):
        if raw.get("schema_version") != "vakifname.monument_research/1":
            raise CatalogError(f"Beklenmeyen araştırma şeması: {raw.get('schema_version')!r}")
        if (raw.get("policy") or {}).get("coordinates_verified_in_file") is not False:
            raise CatalogError("Araştırma dosyası koordinat doğrulaması içeremez.")
        try:
            records = [MonumentResearch(**m) for m in raw["monuments"]]
        except (KeyError, TypeError, ValidationError) as e:
            raise CatalogError(f"Araştırma kaydı geçersiz: {e}") from e
        self.method = raw.get("method", "")
        self.attribution = raw.get("attribution", "")
        self.monuments: dict[str, MonumentResearch] = {}
        for r in records:
            if r.monument_id in self.monuments:
                raise CatalogError(f"{r.monument_id}: araştırmada yinelenen eser.")
            m = catalog.monuments.get(r.monument_id)
            if m is None:
                raise CatalogError(f"{r.monument_id}: V20'de olmayan eser araştırmada.")
            if m.name != r.v20_name:
                raise CatalogError(f"{r.monument_id}: araştırmadaki V20 adı ({r.v20_name!r}) katalogla uyuşmuyor.")
            self.monuments[r.monument_id] = r

    def get(self, monument_id: str) -> Optional[MonumentResearch]:
        return self.monuments.get(monument_id)


def load_research(path: Optional[Path], catalog: V20Catalog) -> ResearchCatalog:
    """Araştırma dosyasını yükler. Yol verilmezse araştırma boştur (tüm konumlar `missing`)."""
    if path is None:
        return ResearchCatalog({"schema_version": "vakifname.monument_research/1",
                                "policy": {"coordinates_verified_in_file": False}, "monuments": []}, catalog)
    return ResearchCatalog(json.loads(Path(path).read_text(encoding="utf-8")), catalog)
